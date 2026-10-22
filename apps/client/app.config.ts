import type { ConfigContext, ExpoConfig } from 'expo/config';
// имена и идентификаторы — из JSON общего пакета: конфиг читается на сервере EAS до сборки пакета
import BRAND from '@masterio/shared/src/brand.json';

const androidMapsKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY ?? '';
const iosMapsKey = process.env.GOOGLE_MAPS_IOS_API_KEY ?? '';

/**
 * Сборки для людей (preview — тестерам, production — в магазины) не должны уходить с локальным адресом API или без
 * проекта EAS (без него не придут push). EAS задаёт EAS_BUILD_PROFILE на сервере сборки; переменные — в EAS Environment.
 */
const buildProfile = process.env.EAS_BUILD_PROFILE;
if (buildProfile === 'preview' || buildProfile === 'production') {
  const missing = [
    (process.env.EXPO_PUBLIC_API_URL ?? '').startsWith('https://') ? null : 'EXPO_PUBLIC_API_URL (https://…/api/v1)',
    process.env.EAS_PROJECT_ID ? null : 'EAS_PROJECT_ID',
  ].filter(Boolean);
  if (missing.length > 0) throw new Error(`${buildProfile} build: set ${missing.join(', ')} in EAS environment variables`);
}

/**
 * Masterio — приложение клиента. Имя и идентификаторы берутся из единого конфига BRAND.
 * Карта: Google Maps (ключи в .env); на iOS без ключа используется Apple Maps.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: BRAND.clientApp.name,
  slug: 'masterio',
  scheme: BRAND.clientApp.scheme,
  version: '0.4.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  ios: {
    bundleIdentifier: BRAND.clientApp.bundleId,
    supportsTablet: false,
    infoPlist: { CFBundleAllowMixedLocalizations: true },
  },
  android: {
    package: BRAND.clientApp.bundleId,
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#1F4E79' },
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'POST_NOTIFICATIONS', 'CAMERA'],
    blockedPermissions: ['android.permission.ACCESS_BACKGROUND_LOCATION'],
  },
  locales: {
    en: './native-locales/en.json',
    ru: './native-locales/ru.json',
    de: './native-locales/de.json',
    es: './native-locales/es.json',
    hy: './native-locales/hy.json',
  },
  plugins: [
    'expo-router',
    ['expo-splash-screen', { image: './assets/splash.png', imageWidth: 180, resizeMode: 'contain', backgroundColor: '#1F4E79' }],
    'expo-secure-store',
    'expo-localization',
    ['expo-location', { isAndroidBackgroundLocationEnabled: false, isIosBackgroundLocationEnabled: false }],
    ['expo-notifications', { color: '#1F4E79', icon: './assets/notification-icon.png' }],
    'expo-image-picker',
    ['react-native-maps', { androidGoogleMapsApiKey: androidMapsKey, iosGoogleMapsApiKey: iosMapsKey }],
    ['expo-build-properties', { android: { minSdkVersion: 26 } }],
  ],
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1',
    googleMaps: { android: androidMapsKey !== '', ios: iosMapsKey !== '' },
    ...(process.env.EAS_PROJECT_ID ? { eas: { projectId: process.env.EAS_PROJECT_ID } } : {}),
  },
});
