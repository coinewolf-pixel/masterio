import { ApiError, createApiClient, isExpiringSoon, type TokenPair, type TokenStore } from '../src/api-client';

function memoryTokens(initial: TokenPair | null): TokenStore & { value: TokenPair | null } {
  const store = {
    value: initial,
    async get() {
      return store.value;
    },
    async set(t: TokenPair) {
      store.value = t;
    },
    async clear() {
      store.value = null;
    },
  };
  return store;
}

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function jwt(expSecondsFromNow: number): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expSecondsFromNow })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `h.${payload}.s`;
}

describe('API client', () => {
  it('sends the token and language, parses JSON', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createApiClient({
      baseUrl: 'https://api.test/api/v1',
      tokens: memoryTokens({ accessToken: 'A1', refreshToken: 'R1' }),
      locale: () => 'hy',
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return json(200, { ok: true });
      },
    });
    await expect(client.request('GET', '/me', undefined, { query: { month: '2026-10', skip: undefined } })).resolves.toEqual({ ok: true });
    expect(calls[0]?.url).toBe('https://api.test/api/v1/me?month=2026-10');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer A1');
    expect(headers['Accept-Language']).toBe('hy');
  });

  it('refreshes once on 401 for parallel requests and retries them', async () => {
    const tokens = memoryTokens({ accessToken: 'old', refreshToken: 'R1' });
    let refreshCalls = 0;
    const client = createApiClient({
      baseUrl: 'https://api.test',
      tokens,
      fetchImpl: async (url, init) => {
        const auth = (init?.headers as Record<string, string>).Authorization;
        if (String(url).endsWith('/auth/refresh')) {
          refreshCalls += 1;
          await new Promise((r) => setTimeout(r, 20));
          return json(200, { accessToken: 'new', refreshToken: 'R2' });
        }
        return auth === 'Bearer new' ? json(200, { ok: 1 }) : json(401, { code: 'UNAUTHORIZED', messageKey: 'errors.UNAUTHORIZED' });
      },
    });
    const results = await Promise.all([client.request('GET', '/a'), client.request('GET', '/b'), client.request('GET', '/c')]);
    expect(results).toEqual([{ ok: 1 }, { ok: 1 }, { ok: 1 }]);
    expect(refreshCalls).toBe(1);
    expect(tokens.value).toEqual({ accessToken: 'new', refreshToken: 'R2' });
  });

  it('clears the session when refresh is rejected (e.g. token reused)', async () => {
    const tokens = memoryTokens({ accessToken: 'old', refreshToken: 'stolen' });
    let expired = 0;
    const client = createApiClient({
      baseUrl: 'https://api.test',
      tokens,
      onSessionExpired: () => (expired += 1),
      fetchImpl: async (url) =>
        String(url).endsWith('/auth/refresh')
          ? json(401, { code: 'TOKEN_REUSED', messageKey: 'errors.TOKEN_REUSED' })
          : json(401, { code: 'UNAUTHORIZED', messageKey: 'errors.UNAUTHORIZED' }),
    });
    await expect(client.request('GET', '/me')).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect(tokens.value).toBeNull();
    expect(expired).toBe(1);
  });

  it('turns API errors and network failures into ApiError with an i18n key', async () => {
    const client = createApiClient({
      baseUrl: 'https://api.test',
      tokens: memoryTokens(null),
      fetchImpl: async () => json(409, { code: 'ORDER_ALREADY_TAKEN', messageKey: 'errors.ORDER_ALREADY_TAKEN' }),
    });
    const err = await client.request('POST', '/offers/x/accept').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'ORDER_ALREADY_TAKEN', messageKey: 'errors.ORDER_ALREADY_TAKEN' });

    const offline = createApiClient({
      baseUrl: 'https://api.test',
      tokens: memoryTokens(null),
      fetchImpl: async () => {
        throw new TypeError('Network request failed');
      },
    });
    await expect(offline.request('GET', '/me')).rejects.toMatchObject({ code: 'NETWORK', messageKey: 'pro.errors.network' });
  });

  it('a network error during refresh keeps the session', async () => {
    const tokens = memoryTokens({ accessToken: 'old', refreshToken: 'R1' });
    const client = createApiClient({
      baseUrl: 'https://api.test',
      tokens,
      fetchImpl: async (url) => {
        if (String(url).endsWith('/auth/refresh')) throw new TypeError('offline');
        return json(401, { code: 'UNAUTHORIZED', messageKey: 'errors.UNAUTHORIZED' });
      },
    });
    await expect(client.request('GET', '/me')).rejects.toMatchObject({ status: 401 });
    expect(tokens.value).not.toBeNull();
  });

  it('access token for the socket is refreshed when it is about to expire', async () => {
    const tokens = memoryTokens({ accessToken: jwt(20), refreshToken: 'R1' });
    const fresh = jwt(900);
    const client = createApiClient({
      baseUrl: 'https://api.test',
      tokens,
      fetchImpl: async () => json(200, { accessToken: fresh, refreshToken: 'R2' }),
    });
    expect(isExpiringSoon(jwt(20))).toBe(true);
    expect(isExpiringSoon(jwt(900))).toBe(false);
    expect(isExpiringSoon('garbage')).toBe(true);
    await expect(client.accessToken()).resolves.toBe(fresh);
  });
});
