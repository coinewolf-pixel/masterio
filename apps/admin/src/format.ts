import { formatMoney } from '@masterio/shared';
import type { Names } from './api/types';
import { currentLanguage } from './i18n';

const intlLocale = () => (currentLanguage() === 'ru' ? 'ru-RU' : 'en-GB');

export function money(cents: number | null | undefined, currency: string): string {
  if (cents === null || cents === undefined) return '—';
  return formatMoney(cents, currency, currentLanguage());
}

/** Сумма в минимальных единицах без валюты — для общих настроек, которые действуют в валюте каждой страны. */
export function amount(cents: number): string {
  return new Intl.NumberFormat(intlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

export function time(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(intlLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(iso));
}

export function date(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium' }).format(new Date(iso));
}

export function percent(share: number): string {
  return new Intl.NumberFormat(intlLocale(), { style: 'percent', maximumFractionDigits: 1 }).format(share);
}

export function count(n: number): string {
  return new Intl.NumberFormat(intlLocale()).format(n);
}

/** Название справочника на языке CRM, иначе английское, иначе код. */
export function localized(names: Names | null | undefined, fallback = ''): string {
  if (!names) return fallback;
  return names[currentLanguage()] ?? names.en ?? fallback;
}

export function distance(meters: number): string {
  return meters < 1_000 ? `${Math.round(meters)} m` : `${(meters / 1_000).toFixed(1)} km`;
}

/** Сумма в центах из ввода «12,50» / «12.5»; null — некорректный ввод. */
export function parseAmount(input: string): number | null {
  const normalized = input.replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(normalized)) return null;
  const [whole, frac = ''] = normalized.split('.') as [string, string?];
  return Number(whole) * 100 + Number((frac ?? '').padEnd(2, '0'));
}

/** Начало дня и следующего дня в локальном времени браузера — для фильтров периода (ISO). */
export function dayRange(day: string): { from: string; to: string } {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const from = new Date(y, m - 1, d);
  const to = new Date(y, m - 1, d + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function toInputDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Период «с даты по дату включительно» → [from; to) в ISO. */
export function periodFromDates(fromDay: string, toDay: string): { from: string; to: string } {
  return { from: dayRange(fromDay).from, to: dayRange(toDay).to };
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}
