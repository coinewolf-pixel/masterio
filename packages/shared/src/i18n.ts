import de from './locales/de.json';
import en from './locales/en.json';
import es from './locales/es.json';
import hy from './locales/hy.json';
import ru from './locales/ru.json';
import { LOCALES, type Locale } from './schemas';

type Dict = { [key: string]: string | Dict };

export const TRANSLATIONS: Record<Locale, Dict> = { en, ru, de, es, hy };
export const BASE_LOCALE: Locale = 'en';

function lookup(dict: Dict, key: string): string | undefined {
  let node: string | Dict | undefined = dict;
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** Перевод по ключу с подстановкой {{param}}; если ключа нет в языке — берётся английский. */
export function translate(locale: string, key: string, params: Record<string, string | number> = {}): string {
  const lang: Locale = (LOCALES as readonly string[]).includes(locale) ? (locale as Locale) : BASE_LOCALE;
  const template = lookup(TRANSLATIONS[lang], key) ?? lookup(TRANSLATIONS[BASE_LOCALE], key) ?? key;
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params[name] ?? `{{${name}}}`));
}

/** Плоский список ключей словаря (используется проверкой переводов в CI). */
export function flattenKeys(dict: Dict, prefix = ''): string[] {
  return Object.entries(dict).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : flattenKeys(v, `${prefix}${k}.`),
  );
}

/** Параметры {{...}} в строке — должны совпадать во всех языках. */
export function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1] ?? '').sort();
}

export function resolveLocale(candidate: string | null | undefined): Locale {
  const short = (candidate ?? '').slice(0, 2).toLowerCase();
  return (LOCALES as readonly string[]).includes(short) ? (short as Locale) : BASE_LOCALE;
}
