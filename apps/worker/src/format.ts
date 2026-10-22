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

/** Дата «ДД.ММ.ГГГГ» или «ГГГГ-ММ-ДД» → ISO (полдень UTC, чтобы не сдвигалась из-за часового пояса). */
export function parseDay(input: string): string | null {
  const s = input.trim();
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s) ?? null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const [y, mo, d] = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : m ? [Number(m[3]), Number(m[2]), Number(m[1])] : [0, 0, 0];
  if (!y) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d, 12));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString();
}
