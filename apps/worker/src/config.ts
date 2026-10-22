import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string; stripePublishableKey?: string; eas?: { projectId?: string } };

export const API_URL = extra.apiUrl ?? 'http://localhost:3000/api/v1';
/** Socket.IO живёт на том же хосте без префикса /api/v1 */
export const SOCKET_URL = API_URL.replace(/\/api\/v1\/?$/, '');
export const STRIPE_PUBLISHABLE_KEY = extra.stripePublishableKey ?? '';
export const EAS_PROJECT_ID = extra.eas?.projectId ?? Constants.easConfig?.projectId ?? '';
