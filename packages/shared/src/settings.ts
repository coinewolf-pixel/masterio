import { z } from 'zod';

/**
 * Реестр настроек, которые админ меняет без релиза. Суммы — в центах.
 * Значение ищется от самой узкой области к общей: CITY_CATEGORY → CATEGORY → CITY → COUNTRY → GLOBAL → default.
 */
const cents = z.number().int().nonnegative();
const positiveInt = z.number().int().positive();
const bp = z.number().int().min(0).max(10_000);

export const SETTINGS = {
  COMMISSION_PERCENT: { schema: z.number().min(0).max(20), default: 20, finance: true },
  COMMISSION_MODE: { schema: z.enum(['from_wallet', 'from_payment']), default: 'from_wallet', finance: true },

  CASH_ENABLED: { schema: z.boolean(), default: true, finance: false },
  CARD_PAYMENTS_ENABLED: { schema: z.boolean(), default: false, finance: true },
  PAYOUTS_ENABLED: { schema: z.boolean(), default: false, finance: true },
  WORKER_TOPUP_ENABLED: { schema: z.boolean(), default: true, finance: true },
  CLIENT_CARD_REQUIRED_FOR_CASH: { schema: z.boolean(), default: false, finance: false },

  CASH_MIN_BALANCE: { schema: cents, default: 2_000, finance: true },
  /** запас сверх комиссии заказа, bp от ожидаемой комиссии */
  CASH_COMMISSION_BUFFER_BP: { schema: bp, default: 2_000, finance: true },
  CASH_DEBT_LIMIT: { schema: cents, default: 3_000, finance: true },
  CASH_MAX_ORDER_AMOUNT: { schema: cents, default: 50_000, finance: true },
  CASH_MAX_ORDER_AMOUNT_NEW_WORKER: { schema: cents, default: 20_000, finance: true },
  /** ориентировочная сумма заказа для проверки баланса до сметы */
  EXPECTED_ORDER_AMOUNT: { schema: cents, default: 8_000, finance: true },

  OFFER_TTL_SECONDS: { schema: positiveInt.max(600), default: 30, finance: false },
  MAX_ROUNDS: { schema: positiveInt.max(10), default: 3, finance: false },
  MAX_DISPATCH_MINUTES: { schema: positiveInt.max(120), default: 10, finance: false },
  BATCH_SIZE: { schema: positiveInt.max(3), default: 1, finance: false },
  SEARCH_RADIUS_M: { schema: positiveInt.max(100_000), default: 10_000, finance: false },
  MAX_SEARCH_RADIUS_M: { schema: positiveInt.max(200_000), default: 30_000, finance: false },
  QUEUE_WEIGHTS: {
    schema: z.object({
      distance: z.number().min(0).max(1),
      rating: z.number().min(0).max(1),
      acceptRate: z.number().min(0).max(1),
      cancelRate: z.number().min(0).max(1),
    }),
    default: { distance: 0.5, rating: 0.25, acceptRate: 0.15, cancelRate: 0.1 },
    finance: false,
  },
  WORKER_ONLINE_STALE_SECONDS: { schema: positiveInt, default: 180, finance: false },
  /** предупреждение в CRM, если в городе онлайн меньше мастеров */
  LOW_WORKERS_WARNING: { schema: z.number().int().min(0).max(1_000), default: 3, finance: false },

  ARRIVAL_GEOFENCE_M: { schema: positiveInt.max(2_000), default: 150, finance: false },
  NEARBY_NOTIFY_M: { schema: positiveInt.max(5_000), default: 500, finance: false },
  LOCATION_RETENTION_DAYS: { schema: positiveInt.max(3_650), default: 90, finance: false },

  FREE_CANCEL_MINUTES: { schema: z.number().int().min(0).max(120), default: 3, finance: false },
  CLIENT_CANCEL_PENALTY: {
    schema: z.object({ ACCEPTED: cents, EN_ROUTE: cents, ARRIVED: cents }),
    default: { ACCEPTED: 300, EN_ROUTE: 700, ARRIVED: 0 },
    finance: true,
  },
  TRAVEL_COMPENSATION: { schema: cents, default: 1_500, finance: true },
  CLIENT_CANCEL_THRESHOLDS: {
    schema: z.object({ warn: positiveInt, prepay: positiveInt, block: positiveInt }),
    default: { warn: 2, prepay: 4, block: 6 },
    finance: false,
  },
  WORKER_CANCEL_THRESHOLDS: {
    schema: z.object({ warn: positiveInt, block: positiveInt }),
    default: { warn: 3, block: 6 },
    finance: false,
  },
  NO_SHOW_WAIT_MINUTES: { schema: positiveInt.max(120), default: 15, finance: false },
  AUTO_CONFIRM_HOURS: { schema: positiveInt.max(720), default: 24, finance: false },
  TEAM_ASSIGN_TIMEOUT_MIN: { schema: positiveInt.max(240), default: 10, finance: false },
  /** команды разрешены в стране (раздел 18.2: «если это разрешено законодательством страны») */
  TEAMS_ENABLED: { schema: z.boolean(), default: true, finance: false },
  /** замена исполнителя после первого назначения требует согласия клиента */
  PERFORMER_CHANGE_CONSENT: { schema: z.boolean(), default: true, finance: false },
  TEAM_MAX_MEMBERS: { schema: positiveInt.max(200), default: 20, finance: false },
  TEAM_INVITE_TTL_HOURS: { schema: positiveInt.max(720), default: 72, finance: false },

  /** сколько дней после завершения заказа можно открыть спор */
  DISPUTE_OPEN_WINDOW_DAYS: { schema: positiveInt.max(365), default: 14, finance: false },
  /** срок ответа второй стороны на спор */
  DISPUTE_RESPONSE_HOURS: { schema: positiveInt.max(720), default: 48, finance: false },
  /** через сколько часов без решения спор автоматически эскалируется */
  DISPUTE_ESCALATE_HOURS: { schema: positiveInt.max(2_160), default: 120, finance: false },
  /** хранение доказательств по спорам и инцидентам (с учётом законных сроков страны) */
  EVIDENCE_RETENTION_DAYS: { schema: positiveInt.max(3_650), default: 1_095, finance: false },

  BONUS_MAX_DISCOUNT_SHARE_BP: { schema: bp, default: 5_000, finance: true },
  BONUS_BUDGET_CAP: { schema: cents, default: 0, finance: true },
  /** бонус сгорает через столько дней после начисления */
  BONUS_EXPIRES_DAYS: { schema: positiveInt.max(3_650), default: 60, finance: true },
  PROMO_EXPIRES_DAYS: { schema: positiveInt.max(3_650), default: 60, finance: true },
  WELCOME_PRESETS: { schema: z.array(cents).max(10), default: [5_000, 10_000], finance: true },
  AUTO_WELCOME_ENABLED: { schema: z.boolean(), default: false, finance: true },
  AUTO_WELCOME_AMOUNT: { schema: cents, default: 0, finance: true },
  GRANT_MAX_PER_WORKER: { schema: cents, default: 10_000, finance: true },
  GRANT_SECOND_APPROVAL_ABOVE: { schema: cents, default: 10_000, finance: true },
  GRANT_FINANCE_DAILY_LIMIT: { schema: cents, default: 50_000, finance: true },
  TOPUP_MIN_AMOUNT: { schema: cents, default: 1_000, finance: true },
  TOPUP_MAX_AMOUNT: { schema: cents, default: 50_000, finance: true },
  TOPUP_REFUND_POLICY: {
    schema: z.enum(['none', 'on_account_closure', 'on_request']),
    default: 'on_account_closure',
    finance: true,
  },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]['schema']>;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTINGS, key);
}

export function parseSettingValue<K extends SettingKey>(key: K, value: unknown): SettingValue<K> {
  return SETTINGS[key].schema.parse(value) as SettingValue<K>;
}

export function settingDefault<K extends SettingKey>(key: K): SettingValue<K> {
  return SETTINGS[key].default as SettingValue<K>;
}
