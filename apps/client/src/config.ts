import Constants from 'expo-constants';
import { Platform } from 'react-native';

const extra = (Constants.expoConfig?.extra ?? {}) as {
  apiUrl?: string;
  googleMaps?: { android?: boolean; ios?: boolean };
  eas?: { projectId?: string };
};

export const API_URL = extra.apiUrl ?? 'http://localhost:3000/api/v1';
/** Socket.IO живёт на том же хосте без префикса /api/v1 */
export const SOCKET_URL = API_URL.replace(/\/api\/v1\/?$/, '');
export const EAS_PROJECT_ID = extra.eas?.projectId ?? Constants.easConfig?.projectId ?? '';
/** Google Maps, если ключ задан для платформы; иначе на iOS — Apple Maps */
export const USE_GOOGLE_MAPS = Platform.OS === 'android' ? true : (extra.googleMaps?.ios ?? false);
