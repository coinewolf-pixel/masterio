/**
 * Интерфейс CRM на en и ru (раздел 14): каждый ключ t('…') из страниц есть в обоих языках,
 * у динамических ключей (статусы, типы, роли) переведено каждое значение, пустых строк нет.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADMIN_SUB_ROLES, CLIENT_CANCEL_REASONS, DISPUTE_REASONS, DISPUTE_RESOLUTIONS, DISPUTE_STATUSES, INCIDENT_TYPES, LEGAL_AUDIENCES, SETTING_KEYS, TICKET_STATUSES } from '@masterio/shared';
import { ORDER_STATUSES } from '../src/api/types';
import { ADMIN_LANGUAGES, RESOURCES } from '../src/i18n';
import { SETTING_GROUPS, SETTING_META } from '../src/settingsMeta';

type Dict = { [k: string]: string | Dict };
function flatten(d: Dict, prefix = ''): Record<string, string> {
  return Object.entries(d).reduce<Record<string, string>>((acc, [k, v]) => {
    if (typeof v === 'string') acc[prefix + k] = v;
    else Object.assign(acc, flatten(v, `${prefix}${k}.`));
    return acc;
  }, {});
}
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}

const sources = files(join(__dirname, '../src')).map((f) => readFileSync(f, 'utf8'));
const usedStatic = new Set<string>();
const usedDynamic = new Set<string>();
for (const src of sources) {
  for (const m of src.matchAll(/\bt\(\s*['`]([a-zA-Z][A-Za-z0-9_.${}]+)['`]/g)) {
    const key = m[1] ?? '';
    if (key.includes('${')) usedDynamic.add(key.slice(0, key.indexOf('${')));
    else usedStatic.add(key);
  }
}
const dict = Object.fromEntries(ADMIN_LANGUAGES.map((l) => [l, flatten(RESOURCES[l])])) as Record<(typeof ADMIN_LANGUAGES)[number], Record<string, string>>;

const DYNAMIC: Record<string, readonly string[]> = {
  'order.status.': ORDER_STATUSES,
  'cancel.client.': CLIENT_CANCEL_REASONS,
  'roles.': ADMIN_SUB_ROLES,
  'admins.roleHelp.': ADMIN_SUB_ROLES,
  'userStatus.': ['ACTIVE', 'WARNED', 'PREPAY_REQUIRED', 'SUSPENDED', 'BLOCKED', 'DELETED'],
  'verification.': ['NOT_VERIFIED', 'VERIFIED', 'REJECTED', 'EXPIRED'],
  'documents.tab.': ['NOT_VERIFIED', 'VERIFIED', 'REJECTED', 'EXPIRED'],
  'documents.kinds.': ['ID_DOCUMENT', 'SELFIE', 'LICENSE', 'INSURANCE', 'COMPANY_REGISTRATION', 'QUALIFICATION', 'OTHER'],
  'eligibility.': ['kyc', 'blocked', 'balance', 'debt', 'active_order', 'offline', 'no_categories', 'no_cities'],
  'grants.status.': ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'],
  'finance.kinds.': ['TOPUP', 'COMMISSION', 'BONUS_ACCRUAL', 'BONUS_EXPIRY', 'PROMO_GRANT', 'PROMO_EXPIRY', 'PENALTY', 'COMPENSATION', 'REFUND', 'CHARGEBACK', 'CARD_CAPTURE', 'PAYOUT', 'TOPUP_REFUND', 'REVERSAL'],
  'finance.accounts.': ['CLIENT_PAYMENT', 'PLATFORM_REVENUE', 'WORKER_EARNINGS', 'WORKER_TOPUP', 'WORKER_PENDING', 'WORKER_BONUS', 'WORKER_PROMO', 'WORKER_DEBT', 'BONUS_EXPENSE', 'PROMO_EXPENSE', 'REFUNDS', 'COMPENSATION', 'STRIPE_CLEARING', 'PENALTIES'],
  'fraud.type.': ['HIGH_CANCEL_RATE', 'HIGH_DISPUTE_RATE', 'GPS_MISMATCH', 'SUSPICIOUS_PAIR', 'OFF_PLATFORM_ATTEMPT', 'MULTI_ACCOUNT', 'CASH_HIDDEN_ORDER', 'LARGE_GRANT', 'REFUND_SPIKE', 'TOPUP_SPIKE'],
  'fraud.explain.': ['HIGH_CANCEL_RATE', 'GPS_MISMATCH', 'OFF_PLATFORM_ATTEMPT', 'REFUND_SPIKE'],
  'fraud.role.': ['WORKER', 'CLIENT'],
  'dispute.reason.': DISPUTE_REASONS,
  'dispute.status.': DISPUTE_STATUSES,
  'orderCard.actor.': ['CLIENT', 'WORKER', 'ADMIN', 'SYSTEM'],
  'orderCard.method.': ['CASH', 'CARD'],
  'orderCard.offer.': ['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'TAKEN_BY_OTHER', 'CANCELLED'],
  'orderCard.estimateStatus.': ['PROPOSED', 'APPROVED', 'REJECTED', 'SUPERSEDED'],
  'orderCard.photoPurpose.': ['problem', 'estimate', 'completion'],
  'orderCard.filterHit.': ['phone', 'link', 'email', 'messenger', 'iban'],
  'orderCard.event.': ['created', 'dispatch_started', 'offer_accepted', 'status_en_route', 'status_arrived', 'status_in_progress', 'completed_by_worker', 'payment_confirmed', 'performer_assigned', 'performer_replaced', 'performer_mismatch'],
  'audit.actions.': ['setting_update', 'grant_create', 'user_block', 'order_cancel', 'document_approve'],
  'audit.entity.': ['User', 'Order', 'Setting', 'WalletGrant'],
  'settings.group.': SETTING_GROUPS,
  'settings.scope.': ['GLOBAL', 'COUNTRY', 'CITY', 'CATEGORY', 'CITY_CATEGORY'],
  'settings.unit.': ['m', 's', 'min', 'h', 'days', 'money', 'moneyList'],
  'settings.enum.': ['from_wallet', 'from_payment', 'none', 'on_account_closure', 'on_request'],
  'settings.field.': ['distance', 'rating', 'acceptRate', 'cancelRate', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'warn', 'prepay', 'block'],
  'settings.key.': SETTING_KEYS.flatMap((k) => [`${k}.label`, `${k}.help`]),
  'disputes.do.': ['proposal', 'request_response', 'note', 'escalate', 'settle', 'refer'],
  'disputes.doHint.': ['proposal', 'request_response', 'note', 'escalate', 'settle', 'refer'],
  'disputes.resolution.': [...DISPUTE_RESOLUTIONS, 'referred'],
  'disputes.event.': ['opened', 'response', 'proposal', 'settled', 'referred', 'escalated', 'note'],
  'disputes.snapshot.': ['chat_export', 'estimate_snapshot', 'timeline_snapshot', 'gps_snapshot', 'order_snapshot'],
  'support.status.': TICKET_STATUSES,
  'support.kinds.': ['general', 'dispute', 'incident'],
  'incidents.types.': INCIDENT_TYPES,
  'incidents.reporters.': ['client', 'worker'],
  'legal.audience.': LEGAL_AUDIENCES,
  'insurance.type.': ['INDEPENDENT', 'COMPANY'],
  'bonuses.status.': ['DRAFT', 'APPROVED', 'APPLIED', 'CANCELLED'],
  'bonuses.reason.': ['ok', 'no_tier', 'rating', 'cancel_rate', 'disputes', 'documents'],
  'privacy.types.': ['export', 'delete'],
  'privacy.status.': ['done', 'partially_retained'],
  'privacy.kept.': ['orders', 'ledger', 'dispute_evidence', 'incidents', 'documents', 'consents'],
  'teams.role.': ['LEADER', 'MASTER', 'HELPER', 'EMPLOYEE'],
  'teams.state.': ['ACTIVE', 'PENDING_CONSENT', 'ENDED', 'DECLINED', 'CANCELLED'],
  'teams.inviteStatus.': ['PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED'],
  'teams.event.': ['created', 'invited', 'joined', 'removed', 'left', 'assigned', 'auto_assigned', 'replaced', 'change_requested', 'change_approved', 'change_declined', 'change_cancelled', 'performer_mismatch'],
};

describe('CRM translations', () => {
  it('finds keys in the pages', () => {
    expect(usedStatic.size).toBeGreaterThan(300);
  });

  it.each(ADMIN_LANGUAGES)('every static key exists in %s', (lang) => {
    expect([...usedStatic].filter((k) => !(k in dict[lang]))).toEqual([]);
  });

  it('en and ru have the same keys and no empty texts', () => {
    expect(Object.keys(dict.ru).sort()).toEqual(Object.keys(dict.en).sort());
    for (const lang of ADMIN_LANGUAGES) expect(Object.entries(dict[lang]).filter(([, v]) => v.trim() === '').map(([k]) => k)).toEqual([]);
  });

  it('every dynamic prefix is known and translated for all its values', () => {
    for (const prefix of usedDynamic) {
      const values = DYNAMIC[prefix];
      expect(values, `unknown dynamic prefix ${prefix}`).toBeDefined();
      for (const lang of ADMIN_LANGUAGES) {
        for (const v of values ?? []) expect(dict[lang][`${prefix}${v}`], `${lang}: ${prefix}${v}`).toBeTruthy();
      }
    }
  });

  it('every setting has a group and a UI kind', () => {
    for (const key of SETTING_KEYS) expect(SETTING_META[key]).toBeDefined();
  });
});
