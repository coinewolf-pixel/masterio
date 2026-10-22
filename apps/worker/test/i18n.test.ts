/**
 * Ни одной захардкоженной строки: каждый ключ t('pro.…') из экранов есть в переводах всех 5 языков,
 * а тексты системных разрешений (native-locales) совпадают с общими переводами.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MEMBER_BLOCKERS, TEAM_EVENT_TYPES, TEAM_INVITE_ROLES, TEAM_MEMBER_ROLES, DISPUTE_REASONS, DISPUTE_RESOLUTIONS, DISPUTE_STATUSES, INCIDENT_TYPES, LEGAL_AUDIENCES, TICKET_STATUSES, flattenKeys, LOCALES, TRANSLATIONS } from '@masterio/shared';

const { build } = require('../scripts/gen-native-locales.js') as { build: (l: string) => unknown };

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|js)$/.test(name) ? [p] : [];
  });
}

const sources = [...files(join(__dirname, '../app')), ...files(join(__dirname, '../src'))].map((f) => readFileSync(f, 'utf8'));
const usedStatic = new Set<string>();
const usedDynamic = new Set<string>();
for (const src of sources) {
  for (const m of src.matchAll(/t\(\s*['`]((?:pro|case|errors|order|cancel|wallet|worker|units|chat|push)\.[A-Za-z0-9_.${}]+)['`]/g)) {
    const key = m[1] ?? '';
    if (key.includes('${')) usedDynamic.add(key.slice(0, key.indexOf('${')));
    else usedStatic.add(key);
  }
}

describe('translations used by Masterio Pro', () => {
  it('finds keys in the sources', () => {
    expect(usedStatic.size).toBeGreaterThan(150);
  });

  it.each(LOCALES)('every static key exists in %s', (locale) => {
    const keys = new Set(flattenKeys(TRANSLATIONS[locale]));
    const missing = [...usedStatic].filter((k) => !keys.has(k));
    expect(missing).toEqual([]);
  });

  it('dynamic key prefixes have translations for all their values', () => {
    const keys = new Set(flattenKeys(TRANSLATIONS.en));
    const expected: Record<string, readonly string[]> = {
      'pro.order.action.': ['EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'],
      'pro.estimate.type.': ['LABOR', 'MATERIAL', 'TRAVEL', 'OTHER'],
      'pro.documents.status.': ['NOT_VERIFIED', 'VERIFIED', 'EXPIRED', 'REJECTED'],
      'pro.bonus.tier.': ['base', 'silver', 'gold'],
      'pro.wallet.kind.': ['TOPUP', 'COMMISSION', 'PROMO_GRANT', 'PROMO_EXPIRY', 'BONUS_EXPIRY', 'CHARGEBACK'],
      'worker.ineligible.': ['kyc', 'blocked', 'balance', 'debt', 'active_order', 'offline', 'no_categories', 'no_cities', 'team_member'],
      'pro.team.role.': TEAM_MEMBER_ROLES,
      'pro.team.roleHint.': TEAM_INVITE_ROLES,
      'pro.team.blocker.': MEMBER_BLOCKERS,
      'pro.team.event.': TEAM_EVENT_TYPES,
      'order.status.': ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED_BY_WORKER', 'CONFIRMED'],
      'cancel.worker.': ['client_unreachable', 'cannot_arrive', 'other'],
      'wallet.pocket.': ['topup', 'promo', 'bonus', 'earnings', 'debt'],
      'case.reason.': DISPUTE_REASONS,
      'case.status.': DISPUTE_STATUSES,
      'case.event.': ['opened', 'response', 'client_no_show', 'assigned', 'request_response', 'proposal', 'escalated', 'note', 'settled', 'referred', 'automatic_signal', 'response_overdue'],
      'case.resolution.': DISPUTE_RESOLUTIONS,
      'case.legal.audience.': LEGAL_AUDIENCES,
      'case.incident.types.': INCIDENT_TYPES,
      'case.support.status.': TICKET_STATUSES,
    };
    for (const prefix of usedDynamic) {
      const values = expected[prefix];
      expect(values).toBeDefined();
      for (const v of values ?? []) expect(keys.has(`${prefix}${v}`)).toBe(true);
    }
  });

  it.each(LOCALES)('native permission texts for %s are up to date', (locale) => {
    const file = JSON.parse(readFileSync(join(__dirname, '../native-locales', `${locale}.json`), 'utf8')) as unknown;
    expect(file).toEqual(build(locale));
  });
});
