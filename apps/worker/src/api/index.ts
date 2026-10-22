import * as SecureStore from 'expo-secure-store';
import type { LatLng, LocationPointInput } from '@masterio/shared';
import { API_URL } from '../config';
import { currentLocale } from '../i18n/locale';
import { createApiClient, type TokenPair, type TokenStore } from '@masterio/shared';
import type {
  CategoryGroup,
  ChatMessage,
  City,
  DocumentItem,
  Eligibility,
  Estimate,
  EstimateItem,
  HistoryOrder,
  Me,
  Offer,
  OrderDetails,
  OrderListItem,
  Stats,
  UploadForm,
  Wallet,
  WalletTransaction,
} from './types';

const ACCESS = 'masterio.access';
const REFRESH = 'masterio.refresh';
// доступно после первой разблокировки — нужно фоновой задаче геопозиции на iOS
const STORE_OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

export const secureTokens: TokenStore = {
  async get() {
    const [accessToken, refreshToken] = await Promise.all([SecureStore.getItemAsync(ACCESS, STORE_OPTS), SecureStore.getItemAsync(REFRESH, STORE_OPTS)]);
    return accessToken && refreshToken ? { accessToken, refreshToken } : null;
  },
  async set(t: TokenPair) {
    await SecureStore.setItemAsync(ACCESS, t.accessToken, STORE_OPTS);
    await SecureStore.setItemAsync(REFRESH, t.refreshToken, STORE_OPTS);
  },
  async clear() {
    await SecureStore.deleteItemAsync(ACCESS, STORE_OPTS);
    await SecureStore.deleteItemAsync(REFRESH, STORE_OPTS);
  },
};

type Listener = () => void;
const expiredListeners = new Set<Listener>();
export function onSessionExpired(listener: Listener): () => void {
  expiredListeners.add(listener);
  return () => expiredListeners.delete(listener);
}

export const client = createApiClient({
  baseUrl: API_URL,
  tokens: secureTokens,
  locale: currentLocale,
  onSessionExpired: () => expiredListeners.forEach((l) => l()),
});

const r = client.request;

export const api = {
  auth: {
    requestOtp: (phone: string, deviceId: string) => r<{ sent: true }>('POST', '/auth/otp/request', { phone, appType: 'worker', deviceId }, { auth: false }),
    verifyOtp: (phone: string, code: string, deviceId: string, locale: string, countryCode: string) =>
      r<TokenPair & { userId: string; isNew: boolean }>('POST', '/auth/otp/verify', { phone, code, deviceId, appType: 'worker', locale, countryCode }, { auth: false }),
    logout: (refreshToken: string) => r<void>('POST', '/auth/logout', { refreshToken }, { auth: false }),
  },
  me: {
    get: () => r<Me>('GET', '/me'),
    update: (body: { firstName?: string; lastName?: string; locale?: string }) => r<Me>('PATCH', '/me', body),
    registerDevice: (body: { deviceId: string; platform: 'ios' | 'android'; pushToken?: string; appVersion?: string }) => r<void>('POST', '/me/devices', body),
  },
  catalog: {
    cities: () => r<City[]>('GET', '/cities', undefined, { auth: false }),
    categories: (cityId?: string) => r<CategoryGroup[]>('GET', '/categories', undefined, { auth: false, query: { cityId } }),
  },
  worker: {
    online: (location: LatLng) => r<Eligibility>('POST', '/worker/online', { location }),
    offline: () => r<Eligibility>('POST', '/worker/offline'),
    eligibility: () => r<Eligibility>('GET', '/worker/eligibility'),
    setCategories: (ids: string[]) => r<{ ids: string[] }>('PUT', '/worker/categories', { ids }),
    setCities: (ids: string[]) => r<{ ids: string[] }>('PUT', '/worker/cities', { ids }),
    updateProfile: (body: { type?: 'INDEPENDENT' | 'COMPANY'; companyName?: string; preferredRadiusM?: number | null; autoUseEarnings?: boolean }) =>
      r<unknown>('PATCH', '/worker/profile', body),
    history: (month: string) => r<HistoryOrder[]>('GET', '/worker/history', undefined, { query: { month } }),
    stats: (month: string) => r<Stats>('GET', '/worker/stats', undefined, { query: { month } }),
    exportCsv: (month: string) => r<string>('GET', '/worker/history/export', undefined, { query: { month }, text: true }),
  },
  offers: {
    current: () => r<{ offer: Offer | null; serverNow: string }>('GET', '/offers/current'),
    accept: (id: string) => r<{ orderId: string }>('POST', `/offers/${id}/accept`),
    decline: (id: string) => r<void>('POST', `/offers/${id}/decline`),
  },
  orders: {
    list: () => r<OrderListItem[]>('GET', '/orders', undefined, { query: { limit: 30 } }),
    get: (id: string) => r<OrderDetails>('GET', `/orders/${id}`),
    status: (id: string, status: 'EN_ROUTE' | 'ARRIVED' | 'IN_PROGRESS', location: LatLng) => r<{ status: string }>('POST', `/orders/${id}/status`, { status, location }),
    proposeEstimate: (id: string, items: EstimateItem[], note?: string) =>
      r<Estimate>('POST', `/orders/${id}/estimates`, { items: items.map(({ type, title, quantity, unitCents }) => ({ type, title, quantity, unitCents })), note }),
    complete: (id: string, cashReceivedCents: number, location: LatLng) =>
      r<{ status: string; commission: { commissionCents: number; bonusDiscountCents: number; chargedCents: number; toDebtCents: number } }>(
        'POST',
        `/orders/${id}/complete`,
        { cashReceivedCents, location },
      ),
    cancel: (id: string, reason: string, comment?: string) => r<{ status: string }>('POST', `/orders/${id}/worker-cancel`, { reason, comment }),
    messages: (id: string) => r<ChatMessage[]>('GET', `/orders/${id}/messages`, undefined, { query: { limit: 100 } }),
    send: (id: string, body: string) => r<ChatMessage & { warningKey: string | null }>('POST', `/orders/${id}/messages`, { body }),
  },
  tracking: {
    batch: (points: LocationPointInput[]) => r<{ orderId: string | null; accepted: number }>('POST', '/tracking/batch', { points }),
  },
  wallet: {
    get: () => r<Wallet>('GET', '/wallet'),
    transactions: () => r<{ items: WalletTransaction[]; nextCursor: string | null }>('GET', '/wallet/transactions', undefined, { query: { limit: 50 } }),
    topup: (amountCents: number, idempotencyKey: string) =>
      r<{ paymentId: string; clientSecret: string; amountCents: number; currency: string }>('POST', '/wallet/topups', { amountCents }, { idempotencyKey }),
  },
  documents: {
    list: () => r<DocumentItem[]>('GET', '/documents'),
    uploadForm: (contentType: string, sizeBytes: number) => r<UploadForm>('POST', '/uploads', { purpose: 'document', contentType, sizeBytes }),
    register: (body: { kind: DocumentItem['kind']; fileKey: string; categoryId?: string; number?: string; validUntil?: string }) =>
      r<DocumentItem>('POST', '/documents', body),
  },
};

/** Загрузка файла по подписанной форме прямо в хранилище (минуя сервер). */
export async function uploadToStorage(form: UploadForm, file: { uri: string; name: string; type: string }): Promise<void> {
  const body = new FormData();
  for (const [k, v] of Object.entries(form.fields)) body.append(k, v);
  // React Native FormData принимает объект { uri, name, type } как файл
  body.append('file', file as unknown as Blob);
  const res = await fetch(form.url, { method: 'POST', body });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
}
