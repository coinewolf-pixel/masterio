import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { TRANSLATIONS } from '@masterio/shared';
import en from './en.json';
import ru from './ru.json';

/** Интерфейс CRM — английский и русский (раздел 14). Ошибки API и статусы заказов берутся из общих переводов. */
export const ADMIN_LANGUAGES = ['en', 'ru'] as const;
export type AdminLanguage = (typeof ADMIN_LANGUAGES)[number];

const STORAGE_KEY = 'masterio.crm.lang';

type Dict = { [key: string]: string | Dict };
const pick = (dict: Dict, keys: string[]): Dict => Object.fromEntries(keys.filter((k) => k in dict).map((k) => [k, dict[k] as Dict]));
const SHARED_SECTIONS = ['errors', 'order', 'cancel'];

export const RESOURCES: Record<AdminLanguage, Dict> = {
  en: { ...pick(TRANSLATIONS.en, SHARED_SECTIONS), ...en },
  ru: { ...pick(TRANSLATIONS.ru, SHARED_SECTIONS), ...ru },
};

function initialLanguage(): AdminLanguage {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'ru') return saved;
  } catch {
    // хранилище недоступно (приватный режим) — берём язык браузера
  }
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

void i18n.use(initReactI18next).init({
  resources: Object.fromEntries(ADMIN_LANGUAGES.map((l) => [l, { translation: RESOURCES[l] }])),
  lng: initialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export function currentLanguage(): AdminLanguage {
  return i18n.language === 'ru' ? 'ru' : 'en';
}

export function setLanguage(lang: AdminLanguage): void {
  void i18n.changeLanguage(lang);
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // язык уже применён, сохранение не критично
  }
}

export { i18n };
