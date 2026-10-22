import { describe, expect, it } from 'vitest';
import { ACTIONS, allowed, SECTIONS } from '../src/auth/permissions';
import { parseAmount, periodFromDates } from '../src/format';

describe('roles in the CRM (mirror of the server rules)', () => {
  it('superadmin sees everything', () => {
    for (const roles of Object.values(SECTIONS)) expect(allowed(['SUPERADMIN'], roles)).toBe(true);
    for (const roles of Object.values(ACTIONS)) expect(allowed(['SUPERADMIN'], roles)).toBe(true);
  });

  it('support does not see money and cannot change balances', () => {
    expect(allowed(['SUPPORT'], SECTIONS.finance)).toBe(false);
    expect(allowed(['SUPPORT'], SECTIONS.grants)).toBe(false);
    expect(allowed(['SUPPORT'], ACTIONS.viewWallet)).toBe(false);
    expect(allowed(['SUPPORT'], ACTIONS.createGrant)).toBe(false);
    expect(allowed(['SUPPORT'], ACTIONS.cancelOrder)).toBe(true);
  });

  it('finance sees money but cannot approve grants or manage admins', () => {
    expect(allowed(['FINANCE'], SECTIONS.finance)).toBe(true);
    expect(allowed(['FINANCE'], ACTIONS.createGrant)).toBe(true);
    expect(allowed(['FINANCE'], ACTIONS.approveGrant)).toBe(false);
    expect(allowed(['FINANCE'], SECTIONS.admins)).toBe(false);
    expect(allowed(['FINANCE'], ACTIONS.editSettings)).toBe(false);
    expect(allowed(['FINANCE'], ACTIONS.editFinanceSettings)).toBe(true);
  });

  it('moderator reviews documents and blocks, but has no finance', () => {
    expect(allowed(['MODERATOR'], ACTIONS.reviewDocuments)).toBe(true);
    expect(allowed(['MODERATOR'], ACTIONS.blockUsers)).toBe(true);
    expect(allowed(['MODERATOR'], SECTIONS.finance)).toBe(false);
  });
});

describe('form helpers', () => {
  it('parses amounts into cents', () => {
    expect(parseAmount('45,50')).toBe(4_550);
    expect(parseAmount('100')).toBe(10_000);
    expect(parseAmount('1.234')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });

  it('period includes the whole last day', () => {
    const p = periodFromDates('2026-06-01', '2026-06-21');
    expect(new Date(p.to).getTime() - new Date(p.from).getTime()).toBe(21 * 86_400_000);
  });
});
