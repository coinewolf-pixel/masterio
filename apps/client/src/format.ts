import { formatMoney } from '@masterio/shared';
import { currentLocale } from './i18n/locale';
import type { Names } from './api/types';

export function money(cents: number, currency: string): string {
  return formatMoney(cents, currency, currentLocale());
}

export function localized(names: Names | null | undefined, fallback = ''): string {
  if (!names) return fallback;
  return names[currentLocale()] ?? names.en ?? fallback;
}

export function distance(meters: number, units: { m: string; km: string }): string {
  if (meters < 1_000) return `${Math.round(meters)} ${units.m}`;
  return `${new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 1 }).format(meters / 1_000)} ${units.km}`;
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

export function date(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(currentLocale(), { dateStyle: 'medium' }).format(new Date(iso));
}

export function monthTitle(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat(currentLocale(), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function thisMonth(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Ввод суммы «12,50» / «12.5» → центы; null — если число некорректно. */
export function parseAmount(input: string): number | null {
  const normalized = input.replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(normalized)) return null;
  const [whole, frac = ''] = normalized.split('.') as [string, string?];
  return Number(whole) * 100 + Number((frac ?? '').padEnd(2, '0'));
}

/** Оставшиеся секунды по серверному времени: offset = serverNow − время устройства в момент получения. */
export function secondsLeft(expiresAtIso: string, serverOffsetMs: number, nowMs: number = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(expiresAtIso).getTime() - (nowMs + serverOffsetMs)) / 1_000));
}
