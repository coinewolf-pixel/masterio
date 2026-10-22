import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { LOCALES, resolveLocale, TRANSLATIONS, type Locale } from '@masterio/shared';
import { setCurrentLocale } from './locale';

const STORAGE_KEY = 'masterio.locale';

/** Язык по умолчанию — язык телефона, иначе английский; выбор в настройках сохраняется. */
export async function initI18n(): Promise<Locale> {
  let saved: string | null = null;
  try {
    saved = await AsyncStorage.getItem(STORAGE_KEY);
  } catch {
    saved = null;
  }
  const device = getLocales()[0]?.languageCode ?? 'en';
  const locale = resolveLocale(saved ?? device);
  setCurrentLocale(locale);
  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      resources: Object.fromEntries(LOCALES.map((l) => [l, { translation: TRANSLATIONS[l] }])),
      lng: locale,
      fallbackLng: 'en',
      interpolation: { escapeValue: false, prefix: '{{', suffix: '}}' },
      returnNull: false,
    });
  } else {
    await i18n.changeLanguage(locale);
  }
  return locale;
}

/** Смена языка применяется сразу и сохраняется на устройстве. */
export async function changeLanguage(locale: Locale): Promise<void> {
  setCurrentLocale(locale);
  await i18n.changeLanguage(locale);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // сохранение не критично: язык уже применён
  }
}

export { i18n };
