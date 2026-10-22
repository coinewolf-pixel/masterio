import * as SecureStore from 'expo-secure-store';
import { createApiClient, type AddressInput, type CreateOrderInput, type LatLng, type TokenPair, type TokenStore } from '@masterio/shared';
import { API_URL } from '../config';
import { currentLocale } from '../i18n/locale';
import type {
  AppConfig,
  Availability,
  CancelFee,
  CategoryGroup,
  ChatMessage,
  City,
  ClientHistory,
  Me,
  OrderDetails,
  PlaceSuggestion,
  SavedAddress,
  TrackPoint,
  UploadForm,
} from './types';

const ACCESS = 'masterio.client.access';
const REFRESH = 'masterio.client.refresh';

export const secureTokens: TokenStore = {
  async get() {
    const [accessToken, refreshToken] = await Promise.all([SecureStore.getItemAsync(ACCESS), SecureStore.getItemAsync(REFRESH)]);
    return accessToken && refreshToken ? { accessToken, refreshToken } : null;
  },
  async set(t: TokenPair) {
    await SecureStore.setItemAsync(ACCESS, t.accessToken);
    await SecureStore.setItemAsync(REFRESH, t.refreshToken);
  },
  async clear() {
    await SecureStore.deleteItemAsync(ACCESS);
    await SecureStore.deleteItemAsync(REFRESH);
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
    requestOtp: (phone: string, deviceId: string) => r<{ sent: true }>('POST', '/auth/otp/request', { phone, appType: 'client', deviceId }, { auth: false }),
    verifyOtp: (phone: string, code: string, deviceId: string, locale: string, countryCode: string) =>
      r<TokenPair & { userId: string; isNew: boolean }>('POST', '/auth/otp/verify', { phone, code, deviceId, appType: 'client', locale, countryCode }, { auth: false }),
    logout: (refreshToken: string) => r<void>('POST', '/auth/logout', { refreshToken }, { auth: false }),
  },
  me: {
    get: () => r<Me>('GET', '/me'),
    update: (body: { firstName?: string; lastName?: string; locale?: string }) => r<Me>('PATCH', '/me', body),
    registerDevice: (body: { deviceId: string; platform: 'ios' | 'android'; pushToken?: string; appVersion?: string }) => r<void>('POST', '/me/devices', body),
    addresses: () => r<SavedAddress[]>('GET', '/me/addresses'),
    addAddress: (body: AddressInput) => r<{ id: string }>('POST', '/me/addresses', body),
    deleteAddress: (id: string) => r<void>('DELETE', `/me/addresses/${id}`),
    blacklist: () => r<Array<{ workerId: string; createdAt: string }>>('GET', '/me/blacklist'),
    block: (workerId: string) => r<void>('POST', `/me/blacklist/${workerId}`),
    unblock: (workerId: string) => r<void>('DELETE', `/me/blacklist/${workerId}`),
  },
  catalog: {
    cities: () => r<City[]>('GET', '/cities', undefined, { auth: false }),
    categories: (cityId?: string) => r<CategoryGroup[]>('GET', '/categories', undefined, { auth: false, query: { cityId } }),
    availability: (cityId: string, categoryId: string, at: LatLng) =>
      r<Availability>('GET', '/availability', undefined, { query: { cityId, categoryId, lat: at.lat, lng: at.lng } }),
    config: (cityId?: string) => r<AppConfig>('GET', '/app-config', undefined, { query: { cityId } }),
  },
  geo: {
    autocomplete: (q: string, near: LatLng | null, session: string) =>
      r<PlaceSuggestion[]>('GET', '/geo/autocomplete', undefined, { query: { q, lat: near?.lat, lng: near?.lng, session } }),
    place: (placeId: string, session: string) => r<{ placeId: string; formatted: string; location: LatLng }>('GET', `/geo/place/${placeId}`, undefined, { query: { session } }),
    reverse: (at: LatLng) => r<{ formatted: string; placeId: string | null }>('GET', '/geo/reverse', undefined, { query: { lat: at.lat, lng: at.lng } }),
  },
  orders: {
    create: (body: CreateOrderInput) => r<OrderDetails>('POST', '/orders', body),
    get: (id: string) => r<OrderDetails>('GET', `/orders/${id}`),
    active: () => r<Array<{ id: string; status: string; createdAt: string; categoryId: string }>>('GET', '/orders', undefined, { query: { limit: 10 } }),
    history: (month: string) => r<ClientHistory>('GET', '/client/history', undefined, { query: { month } }),
    cancelPreview: (id: string, reason: string) => r<CancelFee>('GET', `/orders/${id}/cancel-preview`, undefined, { query: { reason } }),
    cancel: (id: string, reason: string, comment?: string) => r<CancelFee & { status: string }>('POST', `/orders/${id}/cancel`, { reason, comment }),
    restartSearch: (id: string, radiusM?: number) => r<OrderDetails>('POST', `/orders/${id}/restart-search`, radiusM ? { radiusM } : {}),
    approveEstimate: (id: string, version: number) => r<unknown>('POST', `/orders/${id}/estimates/${version}/approve`),
    rejectEstimate: (id: string, version: number) => r<unknown>('POST', `/orders/${id}/estimates/${version}/reject`),
    confirmPayment: (id: string, cashPaidCents: number) => r<{ status: string }>('POST', `/orders/${id}/confirm-payment`, { cashPaidCents }),
    review: (id: string, rating: number, text?: string) => r<{ ok: true }>('POST', `/orders/${id}/review`, { rating, text }),
    track: (id: string) => r<TrackPoint[]>('GET', `/orders/${id}/track`),
    messages: (id: string) => r<ChatMessage[]>('GET', `/orders/${id}/messages`, undefined, { query: { limit: 100 } }),
    send: (id: string, body: string) => r<ChatMessage & { warningKey: string | null }>('POST', `/orders/${id}/messages`, { body }),
    decidePerformerChange: (id: string, approve: boolean) => r<{ approved: boolean }>('POST', `/orders/${id}/performer-change`, { approve }),
    performerMismatch: (id: string, description?: string) => r<{ id: string }>('POST', `/orders/${id}/performer-mismatch`, description ? { description } : {}),
  },
  uploads: {
    orderPhotoForm: (contentType: string, sizeBytes: number) => r<UploadForm>('POST', '/uploads', { purpose: 'order_photo', contentType, sizeBytes }),
  },
};

/** Загрузка файла по подписанной форме прямо в хранилище (минуя сервер). */
export async function uploadToStorage(form: UploadForm, file: { uri: string; name: string; type: string }): Promise<void> {
  const body = new FormData();
  for (const [k, v] of Object.entries(form.fields)) body.append(k, v);
  body.append('file', file as unknown as Blob);
  const res = await fetch(form.url, { method: 'POST', body });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
}
