import { clientCancelFee, distanceMeters, locationIntervalSeconds } from '../src/rules';
import { filterChatMessage } from '../src/chat-filter';
import { translate, resolveLocale } from '../src/i18n';
import { parseSettingValue, settingDefault } from '../src/settings';

const base = {
  freeMinutes: 3,
  penalties: { ACCEPTED: 300, EN_ROUTE: 700, ARRIVED: 0 },
  travelCompensationCents: 1_500,
};

describe('client cancellation fee', () => {
  it('is free before acceptance', () => {
    expect(clientCancelFee({ ...base, status: 'SEARCHING', minutesSinceAccept: 0, reason: 'changed_mind' }).penaltyCents).toBe(0);
  });
  it('is free inside the free window', () => {
    expect(clientCancelFee({ ...base, status: 'EN_ROUTE', minutesSinceAccept: 2, reason: 'changed_mind' }).penaltyCents).toBe(0);
  });
  it('grows with status after the window', () => {
    expect(clientCancelFee({ ...base, status: 'ACCEPTED', minutesSinceAccept: 5, reason: 'changed_mind' }).penaltyCents).toBe(300);
    expect(clientCancelFee({ ...base, status: 'EN_ROUTE', minutesSinceAccept: 5, reason: 'changed_mind' }).penaltyCents).toBe(700);
  });
  it('charges travel compensation when the pro has arrived', () => {
    const fee = clientCancelFee({ ...base, status: 'ARRIVED', minutesSinceAccept: 1, reason: 'changed_mind' });
    expect(fee.compensationCents).toBe(1_500);
  });
  it('complaint reasons create a review instead of a penalty', () => {
    const fee = clientCancelFee({ ...base, status: 'ARRIVED', minutesSinceAccept: 30, reason: 'off_platform_payment' });
    expect(fee).toEqual({ penaltyCents: 0, compensationCents: 0, createsReview: true });
  });
});

describe('geo', () => {
  it('distance Yerevan Republic Square → Cascade ≈ 1.4 km', () => {
    const d = distanceMeters({ lat: 40.1776, lng: 44.5126 }, { lat: 40.1913, lng: 44.5152 });
    expect(d).toBeGreaterThan(1_400);
    expect(d).toBeLessThan(1_600);
  });
  it('update interval depends on speed', () => {
    expect(locationIntervalSeconds(null)).toBe(15);
    expect(locationIntervalSeconds(15)).toBe(3);
  });
});

describe('chat filter', () => {
  it('masks phones, links, emails, messengers and IBAN', () => {
    const r = filterChatMessage('Call me +374 91 23-45-67 or write to a@b.com, my WhatsApp, t.me/x, IBAN DE89 3704 0044 0532 0130 00, www.site.de');
    expect(r.text).not.toMatch(/\d{5}/);
    expect(r.text).not.toContain('a@b.com');
    expect(r.hits.sort()).toEqual(['email', 'iban', 'link', 'messenger', 'phone']);
  });
  it('catches Russian messenger names', () => {
    expect(filterChatMessage('напиши в телеграм').hits).toContain('messenger');
  });
  it('keeps normal messages intact', () => {
    const r = filterChatMessage('I will be there in 10 minutes, flat 25');
    expect(r.hits).toEqual([]);
    expect(r.text).toBe('I will be there in 10 minutes, flat 25');
  });
});

describe('i18n and settings', () => {
  it('translates with params and falls back to English', () => {
    expect(translate('ru', 'push.order_cancelled.body', { number: 42 })).toBe('Заказ №42 отменён.');
    expect(translate('xx', 'errors.NOT_FOUND')).toBe('Not found.');
    expect(resolveLocale('hy-AM')).toBe('hy');
    expect(resolveLocale('fr-FR')).toBe('en');
  });
  it('validates setting values and defaults', () => {
    expect(settingDefault('OFFER_TTL_SECONDS')).toBe(30);
    expect(settingDefault('COMMISSION_PERCENT')).toBe(20);
    expect(() => parseSettingValue('COMMISSION_PERCENT', 25)).toThrow();
    expect(() => parseSettingValue('BATCH_SIZE', 4)).toThrow();
    expect(parseSettingValue('CASH_ENABLED', false)).toBe(false);
  });
});
