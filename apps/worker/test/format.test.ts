jest.mock('../src/i18n/locale', () => ({ currentLocale: () => 'ru' }));

import { distance, monthTitle, parseAmount, parseDay, secondsLeft, shiftMonth, thisMonth } from '../src/format';

describe('formatting helpers', () => {
  it('parses amounts typed with comma or dot into cents', () => {
    expect(parseAmount('45,50')).toBe(4_550);
    expect(parseAmount('45.5')).toBe(4_550);
    expect(parseAmount('100')).toBe(10_000);
    expect(parseAmount('1 200,05')).toBe(120_005);
    expect(parseAmount('12.345')).toBeNull();
    expect(parseAmount('-5')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });

  it('countdown follows server time, not the phone clock', () => {
    const now = Date.UTC(2026, 9, 21, 12, 0, 0);
    const expiresAt = new Date(now + 30_000).toISOString();
    expect(secondsLeft(expiresAt, 0, now)).toBe(30);
    // часы телефона отстают на 10 с: сервер уже на 10 с впереди
    expect(secondsLeft(expiresAt, 10_000, now)).toBe(20);
    expect(secondsLeft(expiresAt, 0, now + 31_000)).toBe(0);
  });

  it('months and distances', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(thisMonth(new Date(Date.UTC(2026, 9, 21)))).toBe('2026-10');
    expect(monthTitle('2026-10').toLowerCase()).toContain('2026');
    expect(distance(850, { m: 'м', km: 'км' })).toBe('850 м');
    expect(distance(1_450, { m: 'м', km: 'км' })).toBe('1,5 км');
  });
});

describe('parseDay (даты полиса)', () => {
  it('принимает ДД.ММ.ГГГГ и ГГГГ-ММ-ДД, полдень UTC', () => {
    expect(parseDay('31.12.2026')).toBe('2026-12-31T12:00:00.000Z');
    expect(parseDay(' 1/2/2027 ')).toBe('2027-02-01T12:00:00.000Z');
    expect(parseDay('2027-03-15')).toBe('2027-03-15T12:00:00.000Z');
  });
  it('отклоняет несуществующие и неполные даты', () => {
    expect(parseDay('31.02.2026')).toBeNull();
    expect(parseDay('2026-13-01')).toBeNull();
    expect(parseDay('12.2026')).toBeNull();
    expect(parseDay('')).toBeNull();
  });
});
