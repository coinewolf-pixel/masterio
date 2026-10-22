import type { Locale } from '@masterio/shared';

/** Текущий язык без зависимости от i18next (нужен API-клиенту и фоновой задаче). */
let current: Locale = 'en';

export function currentLocale(): Locale {
  return current;
}

export function setCurrentLocale(locale: Locale): void {
  current = locale;
}
