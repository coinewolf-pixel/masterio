import { buildFinanceSummary, centsToDecimal, csvCell } from '../../src/admin/admin-query.service';

describe('finance summary', () => {
  const from = new Date('2026-10-01T00:00:00Z');
  const to = new Date('2026-11-01T00:00:00Z');

  it('splits commission by the pocket it was paid from and keeps currencies apart', () => {
    const rows = [
      { kind: 'COMMISSION', type: 'PLATFORM_REVENUE', currency: 'EUR', sum: 3_000n, txs: 2n },
      { kind: 'COMMISSION', type: 'WORKER_BONUS', currency: 'EUR', sum: -500n, txs: 1n },
      { kind: 'COMMISSION', type: 'WORKER_PROMO', currency: 'EUR', sum: -1_000n, txs: 1n },
      { kind: 'COMMISSION', type: 'WORKER_TOPUP', currency: 'EUR', sum: -1_200n, txs: 1n },
      { kind: 'COMMISSION', type: 'WORKER_DEBT', currency: 'EUR', sum: -300n, txs: 1n },
      { kind: 'TOPUP', type: 'STRIPE_CLEARING', currency: 'EUR', sum: -5_000n, txs: 2n },
      { kind: 'PROMO_GRANT', type: 'WORKER_PROMO', currency: 'AMD', sum: 10_000n, txs: 1n },
      { kind: 'PROMO_EXPIRY', type: 'WORKER_PROMO', currency: 'AMD', sum: -2_000n, txs: 1n },
    ];
    const turnover = [{ currency: 'EUR', orders: 2n, cents: 15_000n }];
    const liabilities = [
      { type: 'WORKER_TOPUP', currency: 'EUR', positive: 3_800n, negative: 0n },
      { type: 'WORKER_DEBT', currency: 'EUR', positive: 0n, negative: -300n },
    ];
    const s = buildFinanceSummary(from, to, rows, turnover, liabilities);
    expect(s.currencies.map((c) => c.currency)).toEqual(['AMD', 'EUR']);
    const eur = s.currencies[1]!;
    expect(eur).toMatchObject({
      ordersCompleted: 2,
      turnoverCents: 15_000,
      commissionCents: 3_000,
      commissionFromBonusCents: 500,
      commissionFromPromoCents: 1_000,
      commissionFromTopupCents: 1_200,
      commissionToDebtCents: 300,
      topupsCents: 5_000,
      topupsCount: 2,
      liabilities: { topupCents: 3_800, debtCents: 300, promoCents: 0, bonusCents: 0, earningsCents: 0 },
    });
    // комиссия = сумма источников: скидка бонуса + промо + пополнение + заработок + долг
    expect(eur.commissionFromBonusCents + eur.commissionFromPromoCents + eur.commissionFromTopupCents + eur.commissionFromEarningsCents + eur.commissionToDebtCents).toBe(eur.commissionCents);
    expect(s.currencies[0]).toMatchObject({ promoGrantedCents: 10_000, promoExpiredCents: 2_000, commissionCents: 0 });
  });
});

describe('CSV helpers', () => {
  it('formats cents exactly, including negatives', () => {
    expect(centsToDecimal(1_000n)).toBe('10.00');
    expect(centsToDecimal(-5n)).toBe('-0.05');
    expect(centsToDecimal(123_456_789n)).toBe('1234567.89');
  });

  it('quotes separators and neutralises spreadsheet formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('-0.05')).toBe('-0.05');
    expect(csvCell(-100)).toBe('-100');
  });
});
