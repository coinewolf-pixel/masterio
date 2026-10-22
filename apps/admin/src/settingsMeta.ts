import { SETTING_KEYS, SETTINGS, type SettingKey } from '@masterio/shared';
import { amount, count, parseAmount } from './format';

/**
 * Как показывать и редактировать каждую настройку в CRM. Значения хранятся как в реестре @masterio/shared:
 * суммы — в минимальных единицах (центах), доли — в базисных пунктах (bp, 10 000 = 100 %).
 */
export type FieldKind = 'money' | 'int' | 'fraction';
export type SettingKind =
  | { type: 'bool' }
  | { type: 'enum'; options: readonly string[] }
  | { type: 'money' }
  | { type: 'moneyList' }
  | { type: 'int'; unit: 'm' | 's' | 'min' | 'h' | 'days' | 'count' }
  | { type: 'percent' }
  | { type: 'bp' }
  | { type: 'object'; fields: Record<string, FieldKind> };

export const SETTING_GROUPS = ['commission', 'payments', 'cash', 'dispatch', 'location', 'cancellations', 'teams', 'disputes', 'bonuses', 'grants'] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number];

export const SETTING_META: Record<SettingKey, { group: SettingGroup; kind: SettingKind }> = {
  COMMISSION_PERCENT: { group: 'commission', kind: { type: 'percent' } },
  COMMISSION_MODE: { group: 'commission', kind: { type: 'enum', options: ['from_wallet', 'from_payment'] } },

  CASH_ENABLED: { group: 'payments', kind: { type: 'bool' } },
  CARD_PAYMENTS_ENABLED: { group: 'payments', kind: { type: 'bool' } },
  PAYOUTS_ENABLED: { group: 'payments', kind: { type: 'bool' } },
  WORKER_TOPUP_ENABLED: { group: 'payments', kind: { type: 'bool' } },
  CLIENT_CARD_REQUIRED_FOR_CASH: { group: 'payments', kind: { type: 'bool' } },
  TOPUP_MIN_AMOUNT: { group: 'payments', kind: { type: 'money' } },
  TOPUP_MAX_AMOUNT: { group: 'payments', kind: { type: 'money' } },
  TOPUP_REFUND_POLICY: { group: 'payments', kind: { type: 'enum', options: ['none', 'on_account_closure', 'on_request'] } },

  CASH_MIN_BALANCE: { group: 'cash', kind: { type: 'money' } },
  CASH_COMMISSION_BUFFER_BP: { group: 'cash', kind: { type: 'bp' } },
  CASH_DEBT_LIMIT: { group: 'cash', kind: { type: 'money' } },
  CASH_MAX_ORDER_AMOUNT: { group: 'cash', kind: { type: 'money' } },
  CASH_MAX_ORDER_AMOUNT_NEW_WORKER: { group: 'cash', kind: { type: 'money' } },
  EXPECTED_ORDER_AMOUNT: { group: 'cash', kind: { type: 'money' } },

  OFFER_TTL_SECONDS: { group: 'dispatch', kind: { type: 'int', unit: 's' } },
  MAX_ROUNDS: { group: 'dispatch', kind: { type: 'int', unit: 'count' } },
  MAX_DISPATCH_MINUTES: { group: 'dispatch', kind: { type: 'int', unit: 'min' } },
  BATCH_SIZE: { group: 'dispatch', kind: { type: 'int', unit: 'count' } },
  SEARCH_RADIUS_M: { group: 'dispatch', kind: { type: 'int', unit: 'm' } },
  MAX_SEARCH_RADIUS_M: { group: 'dispatch', kind: { type: 'int', unit: 'm' } },
  QUEUE_WEIGHTS: { group: 'dispatch', kind: { type: 'object', fields: { distance: 'fraction', rating: 'fraction', acceptRate: 'fraction', cancelRate: 'fraction' } } },
  LOW_WORKERS_WARNING: { group: 'dispatch', kind: { type: 'int', unit: 'count' } },

  WORKER_ONLINE_STALE_SECONDS: { group: 'location', kind: { type: 'int', unit: 's' } },
  ARRIVAL_GEOFENCE_M: { group: 'location', kind: { type: 'int', unit: 'm' } },
  NEARBY_NOTIFY_M: { group: 'location', kind: { type: 'int', unit: 'm' } },
  LOCATION_RETENTION_DAYS: { group: 'location', kind: { type: 'int', unit: 'days' } },

  FREE_CANCEL_MINUTES: { group: 'cancellations', kind: { type: 'int', unit: 'min' } },
  CLIENT_CANCEL_PENALTY: { group: 'cancellations', kind: { type: 'object', fields: { ACCEPTED: 'money', EN_ROUTE: 'money', ARRIVED: 'money' } } },
  TRAVEL_COMPENSATION: { group: 'cancellations', kind: { type: 'money' } },
  CLIENT_CANCEL_THRESHOLDS: { group: 'cancellations', kind: { type: 'object', fields: { warn: 'int', prepay: 'int', block: 'int' } } },
  WORKER_CANCEL_THRESHOLDS: { group: 'cancellations', kind: { type: 'object', fields: { warn: 'int', block: 'int' } } },
  NO_SHOW_WAIT_MINUTES: { group: 'cancellations', kind: { type: 'int', unit: 'min' } },
  AUTO_CONFIRM_HOURS: { group: 'cancellations', kind: { type: 'int', unit: 'h' } },

  TEAMS_ENABLED: { group: 'teams', kind: { type: 'bool' } },
  TEAM_ASSIGN_TIMEOUT_MIN: { group: 'teams', kind: { type: 'int', unit: 'min' } },
  PERFORMER_CHANGE_CONSENT: { group: 'teams', kind: { type: 'bool' } },
  TEAM_MAX_MEMBERS: { group: 'teams', kind: { type: 'int', unit: 'count' } },
  TEAM_INVITE_TTL_HOURS: { group: 'teams', kind: { type: 'int', unit: 'h' } },

  DISPUTE_OPEN_WINDOW_DAYS: { group: 'disputes', kind: { type: 'int', unit: 'days' } },
  DISPUTE_RESPONSE_HOURS: { group: 'disputes', kind: { type: 'int', unit: 'h' } },
  DISPUTE_ESCALATE_HOURS: { group: 'disputes', kind: { type: 'int', unit: 'h' } },
  EVIDENCE_RETENTION_DAYS: { group: 'disputes', kind: { type: 'int', unit: 'days' } },

  BONUS_MAX_DISCOUNT_SHARE_BP: { group: 'bonuses', kind: { type: 'bp' } },
  BONUS_EXPIRES_DAYS: { group: 'bonuses', kind: { type: 'int', unit: 'days' } },
  BONUS_BUDGET_CAP: { group: 'bonuses', kind: { type: 'money' } },

  PROMO_EXPIRES_DAYS: { group: 'grants', kind: { type: 'int', unit: 'days' } },
  WELCOME_PRESETS: { group: 'grants', kind: { type: 'moneyList' } },
  AUTO_WELCOME_ENABLED: { group: 'grants', kind: { type: 'bool' } },
  AUTO_WELCOME_AMOUNT: { group: 'grants', kind: { type: 'money' } },
  GRANT_MAX_PER_WORKER: { group: 'grants', kind: { type: 'money' } },
  GRANT_SECOND_APPROVAL_ABOVE: { group: 'grants', kind: { type: 'money' } },
  GRANT_FINANCE_DAILY_LIMIT: { group: 'grants', kind: { type: 'money' } },
};

export function keysOf(group: SettingGroup): SettingKey[] {
  return SETTING_KEYS.filter((k) => SETTING_META[k].group === group);
}

export function isFinanceKey(key: SettingKey): boolean {
  return SETTINGS[key].finance;
}

type T = (key: string, opts?: Record<string, unknown>) => string;

function fieldText(kind: FieldKind, v: unknown): string {
  if (typeof v !== 'number') return '—';
  if (kind === 'money') return amount(v);
  if (kind === 'fraction') return `${Math.round(v * 100)}%`;
  return String(v);
}

/** Значение настройки для показа в таблице. */
export function formatSetting(key: SettingKey, value: unknown, t: T): string {
  const kind = SETTING_META[key].kind;
  if (value === null || value === undefined) return '—';
  switch (kind.type) {
    case 'bool':
      return value === true ? t('settings.on') : t('settings.off');
    case 'enum':
      return t(`settings.enum.${String(value)}`, { defaultValue: String(value) });
    case 'money':
      return typeof value === 'number' ? amount(value) : '—';
    case 'moneyList':
      return Array.isArray(value) ? value.map((v) => (typeof v === 'number' ? amount(v) : '?')).join(' · ') : '—';
    case 'int':
      {
      const n = typeof value === 'number' ? count(value) : String(value);
      return kind.unit === 'count' ? n : `${n} ${t(`settings.unit.${kind.unit}`)}`;
    }
    case 'percent':
      return `${String(value)}%`;
    case 'bp':
      return typeof value === 'number' ? `${value / 100}%` : '—';
    case 'object': {
      const obj = (value ?? {}) as Record<string, unknown>;
      return Object.entries(kind.fields)
        .map(([f, fk]) => `${t(`settings.field.${f}`, { defaultValue: f })}: ${fieldText(fk, obj[f])}`)
        .join(' · ');
    }
  }
}

/** Значение → текст в поле ввода (суммы в единицах валюты, доли в процентах). */
export function toDraft(key: SettingKey, value: unknown): Record<string, string> {
  const kind = SETTING_META[key].kind;
  const one = (s: string) => ({ value: s });
  switch (kind.type) {
    case 'bool':
      return one(value === true ? 'true' : 'false');
    case 'enum':
      return one(String(value ?? kind.options[0]));
    case 'money':
      return one(typeof value === 'number' ? (value / 100).toFixed(2) : '');
    case 'moneyList':
      return one(Array.isArray(value) ? value.map((v) => (typeof v === 'number' ? (v / 100).toFixed(2) : '')).join('; ') : '');
    case 'int':
    case 'percent':
      return one(value === undefined || value === null ? '' : String(value));
    case 'bp':
      return one(typeof value === 'number' ? String(value / 100) : '');
    case 'object': {
      const obj = (value ?? {}) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(kind.fields).map(([f, fk]) => {
          const v = obj[f];
          if (typeof v !== 'number') return [f, ''];
          return [f, fk === 'money' ? (v / 100).toFixed(2) : fk === 'fraction' ? String(Math.round(v * 100)) : String(v)];
        }),
      );
    }
  }
}

const num = (s: string): number | null => {
  const n = Number(s.trim().replace(',', '.'));
  return s.trim() === '' || !Number.isFinite(n) ? null : n;
};

/** Текст из формы → значение реестра; затем проверка той же zod-схемой, что на сервере. */
export function fromDraft(key: SettingKey, draft: Record<string, string>): { ok: true; value: unknown } | { ok: false } {
  const kind = SETTING_META[key].kind;
  const v = draft.value ?? '';
  let value: unknown;
  switch (kind.type) {
    case 'bool':
      value = v === 'true';
      break;
    case 'enum':
      value = v;
      break;
    case 'money':
      value = parseAmount(v);
      break;
    case 'moneyList':
      value = v.trim() === '' ? [] : v.split(/[;\s]+/).filter(Boolean).map((p) => parseAmount(p));
      break;
    case 'int':
    case 'percent':
      value = num(v);
      break;
    case 'bp': {
      const p = num(v);
      value = p === null ? null : Math.round(p * 100);
      break;
    }
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const [f, fk] of Object.entries(kind.fields)) {
        const s = draft[f] ?? '';
        if (fk === 'money') out[f] = parseAmount(s);
        else if (fk === 'fraction') {
          const p = num(s);
          out[f] = p === null ? null : Math.round(p) / 100;
        } else out[f] = num(s);
      }
      value = out;
      break;
    }
  }
  const parsed = SETTINGS[key].schema.safeParse(value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}
