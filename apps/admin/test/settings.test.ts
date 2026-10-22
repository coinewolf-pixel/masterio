import { describe, expect, it } from 'vitest';
import { SETTING_KEYS, settingDefault } from '@masterio/shared';
import { formatSetting, fromDraft, toDraft } from '../src/settingsMeta';

const t = (key: string, opts?: Record<string, unknown>) => (opts?.defaultValue as string | undefined) ?? key;

describe('settings editor', () => {
  it.each(SETTING_KEYS)('%s: default value survives the form round trip', (key) => {
    const value = settingDefault(key);
    const back = fromDraft(key, toDraft(key, value));
    expect(back).toEqual({ ok: true, value });
  });

  it('money is typed in currency units and stored in cents', () => {
    expect(fromDraft('CASH_MIN_BALANCE', { value: '25,50' })).toEqual({ ok: true, value: 2_550 });
    expect(fromDraft('CASH_MIN_BALANCE', { value: '-1' })).toEqual({ ok: false });
    expect(fromDraft('WELCOME_PRESETS', { value: '50; 100; 150.5' })).toEqual({ ok: true, value: [5_000, 10_000, 15_050] });
  });

  it('commission can never be set above 20%', () => {
    expect(fromDraft('COMMISSION_PERCENT', { value: '20' })).toEqual({ ok: true, value: 20 });
    expect(fromDraft('COMMISSION_PERCENT', { value: '25' })).toEqual({ ok: false });
    expect(fromDraft('COMMISSION_PERCENT', { value: '' })).toEqual({ ok: false });
  });

  it('basis points are shown as percent', () => {
    expect(toDraft('BONUS_MAX_DISCOUNT_SHARE_BP', 5_000)).toEqual({ value: '50' });
    expect(fromDraft('BONUS_MAX_DISCOUNT_SHARE_BP', { value: '35' })).toEqual({ ok: true, value: 3_500 });
    expect(fromDraft('BONUS_MAX_DISCOUNT_SHARE_BP', { value: '150' })).toEqual({ ok: false });
  });

  it('objects are edited field by field', () => {
    expect(fromDraft('QUEUE_WEIGHTS', { distance: '40', rating: '30', acceptRate: '20', cancelRate: '10' })).toEqual({
      ok: true,
      value: { distance: 0.4, rating: 0.3, acceptRate: 0.2, cancelRate: 0.1 },
    });
    expect(fromDraft('CLIENT_CANCEL_PENALTY', { ACCEPTED: '3', EN_ROUTE: '7', ARRIVED: '' })).toEqual({ ok: false });
    expect(fromDraft('WORKER_CANCEL_THRESHOLDS', { warn: '3', block: '0' })).toEqual({ ok: false });
  });

  it('formats values for the table', () => {
    expect(formatSetting('CASH_ENABLED', true, t)).toBe('settings.on');
    expect(formatSetting('BATCH_SIZE', 2, t)).toBe('2');
    expect(formatSetting('BONUS_MAX_DISCOUNT_SHARE_BP', 5_000, t)).toBe('50%');
    expect(formatSetting('COMMISSION_PERCENT', 20, t)).toBe('20%');
    expect(formatSetting('OFFER_TTL_SECONDS', 30, t)).toBe('30 settings.unit.s');
  });
});
