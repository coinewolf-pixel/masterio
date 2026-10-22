import type { ConfigContext, ExpoConfig } from 'expo/config';
// имена и идентификаторы — из JSON общего пакета: конфиг читается на сервере EAS до сборки пакета
import BRAND from '@masterio/shared/src/brand.json';

/**
 * Сборки для людей (preview — тестерам, production — в магазины) не должны уходить с локальным адресом API или без
 * проекта EAS (без него не придут push). EAS задаёт EAS_BUILD_PROFILE на сервере сборки; переменные — в EAS Environment.
 */
const buildProfile = process.env.EAS_BUILD_PROFILE;
if (buildProfile === 'preview' || buildProfile === 'production') {
  const missing = [
    (process.env.EXPO_PUBLIC_API_URL ?? '').startsWith('https://') ? null : 'EXPO_PUBLIC_API_URL (https://…/api/v1)',
    process.env.EAS_PROJECT_ID ? null : 'EAS_PROJECT_ID',
    buildProfile === 'production' && !(process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '').startsWith('pk_live_') ? 'EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY (pk_live_…)' : null,
  ].filter(Boolean);
  if (missing.length > 0) throw new Error(`${buildProfile} build: set ${missing.join(', ')} in EAS environment variables`);
}

/**
 * Masterio Pro — приложение мастера. Имя и идентификаторы берутся из единого конфига BRAND.
 * Тексты разрешений (геопозиция в фоне, камера) — на 5 языках в native-locales/*.json.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: BRAND.workerApp.name,
  slug: 'masterio-pro',
  scheme: BRAND.workerApp.scheme,
  version: '0.3.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  ios: {
    bundleIdentifier: BRAND.workerApp.bundleId,
    supportsTablet: false,
    infoPlist: {
      UIBackgroundModes: ['location', 'remote-notification'],
      CFBundleAllowMixedLocalizations: true,
    },
  },
  android: {
    package: BRAND.workerApp.bundleId,
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#0E7C66' },
    permissions: [
      'ACCESS_COARSE_LOCATION',
      'ACCESS_FINE_LOCATION',
      'ACCESS_BACKGROUND_LOCATION',
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_LOCATION',
      'POST_NOTIFICATIONS',
      'CAMERA',
    ],
    ...(process.env.GOOGLE_MAPS_ANDROID_API_KEY ? { config: { googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY } } } : {}),
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
    ['expo-splash-screen', { image: './assets/splash.png', imageWidth: 180, resizeMode: 'contain', backgroundColor: '#0E7C66' }],
    'expo-secure-store',
    'expo-localization',
    [
      'expo-location',
      {
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
        isIosBackgroundLocationEnabled: true,
      },
    ],
    ['expo-notifications', { color: '#0E7C66', icon: './assets/notification-icon.png' }],
    'expo-image-picker',
    [
      '@stripe/stripe-react-native',
      {
        merchantIdentifier: process.env.EXPO_PUBLIC_APPLE_MERCHANT_ID ?? '',
        enableGooglePay: true,
      },
    ],
    ['expo-build-properties', { android: { minSdkVersion: 26 } }],
  ],
  experiments: { typedRoutes: false },
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1',
    stripePublishableKey: process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '',
    ...(process.env.EAS_PROJECT_ID ? { eas: { projectId: process.env.EAS_PROJECT_ID } } : {}),
  },
});
