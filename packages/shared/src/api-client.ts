/**
 * Общий HTTP-клиент для приложений Masterio и Masterio Pro (и CRM).
 * HTTP-клиент API без зависимостей от React Native (тестируется в Node).
 * - подставляет access-токен и язык;
 * - при 401 один раз обновляет пару токенов (одновременные запросы ждут одно обновление) и повторяет запрос;
 * - если обновить нельзя (TOKEN_REUSED, истёк refresh) — очищает сессию и сообщает приложению;
 * - ошибки приводит к ApiError с кодом и ключом перевода.
 */

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface TokenStore {
  get(): Promise<TokenPair | null>;
  set(tokens: TokenPair): Promise<void>;
  clear(): Promise<void>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly messageKey: string,
    readonly details?: unknown,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  tokens: TokenStore;
  fetchImpl?: typeof fetch;
  locale?: () => string;
  onSessionExpired?: () => void;
  timeoutMs?: number;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  auth?: boolean;
  idempotencyKey?: string;
  /** вернуть тело как текст (CSV) */
  text?: boolean;
}

export interface ApiClient {
  request<T>(method: Method, path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  /** действующий access-токен (с обновлением, если просрочен) — для Socket.IO */
  accessToken(): Promise<string | null>;
  refresh(): Promise<boolean>;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const doFetch = options.fetchImpl ?? fetch;
  let refreshing: Promise<boolean> | null = null;

  async function raw(method: Method, path: string, body: unknown, opts: RequestOptions, token: string | null): Promise<Response> {
    const url = new URL(options.baseUrl.replace(/\/$/, '') + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { Accept: opts.text ? 'text/csv' : 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.locale) headers['Accept-Language'] = options.locale();
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
    try {
      return await doFetch(url.toString(), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      throw new ApiError(0, 'NETWORK', 'pro.errors.network');
    } finally {
      clearTimeout(timer);
    }
  }

  async function parse<T>(res: Response, text: boolean): Promise<T> {
    if (res.status === 204) return undefined as T;
    if (res.ok) return (text ? await res.text() : await res.json()) as T;
    let payload: { code?: string; messageKey?: string; details?: unknown } = {};
    try {
      payload = (await res.json()) as typeof payload;
    } catch {
      // тело не JSON — оставляем общий код
    }
    throw new ApiError(res.status, payload.code ?? 'INTERNAL', payload.messageKey ?? 'errors.INTERNAL', payload.details);
  }

  async function refresh(): Promise<boolean> {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const current = await options.tokens.get();
      if (!current) return false;
      try {
        const res = await raw('POST', '/auth/refresh', { refreshToken: current.refreshToken }, {}, null);
        if (!res.ok) {
          await options.tokens.clear();
          options.onSessionExpired?.();
          return false;
        }
        const pair = (await res.json()) as TokenPair;
        await options.tokens.set({ accessToken: pair.accessToken, refreshToken: pair.refreshToken });
        return true;
      } catch (error) {
        // нет сети — сессию не сбрасываем, просто не обновили
        if (error instanceof ApiError && error.code === 'NETWORK') return false;
        throw error;
      }
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function request<T>(method: Method, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
    const useAuth = opts.auth !== false;
    const token = useAuth ? ((await options.tokens.get())?.accessToken ?? null) : null;
    let res = await raw(method, path, body, opts, token);
    if (res.status === 401 && useAuth && token) {
      const ok = await refresh();
      if (!ok) return parse<T>(res, false);
      res = await raw(method, path, body, opts, (await options.tokens.get())?.accessToken ?? null);
    }
    return parse<T>(res, opts.text === true);
  }

  async function accessToken(): Promise<string | null> {
    const pair = await options.tokens.get();
    if (!pair) return null;
    if (isExpiringSoon(pair.accessToken)) await refresh();
    return (await options.tokens.get())?.accessToken ?? null;
  }

  return { request, accessToken, refresh };
}

/** true, если до истечения JWT меньше минуты (токен не проверяется — только чтение exp). */
export function isExpiringSoon(jwt: string, nowMs: number = Date.now()): boolean {
  const part = jwt.split('.')[1];
  if (!part) return true;
  try {
    const json = JSON.parse(decodeBase64Url(part)) as { exp?: number };
    return !json.exp || json.exp * 1_000 - nowMs < 60_000;
  } catch {
    return true;
  }
}

function decodeBase64Url(input: string): string {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  // atob есть в Hermes и в Node 16+
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
