import {
  accessBalance,
  bonusDiscountFor,
  commissionFor,
  mulDivHalfEven,
  percentToBp,
  planCommissionCharge,
} from '../src/money';

describe('money', () => {
  it('order 100 EUR with 20% commission: platform 20 EUR, worker 80 EUR (section 20.5)', () => {
    const commission = commissionFor(10_000, percentToBp(20));
    expect(commission).toBe(2_000);
    expect(10_000 - commission).toBe(8_000);
  });

  it('rejects commission above 20%', () => {
    expect(() => commissionFor(10_000, 2_001)).toThrow(RangeError);
    expect(() => commissionFor(10_000, percentToBp(25))).toThrow(RangeError);
  });

  it('rejects fractional and negative cents', () => {
    expect(() => commissionFor(10.5, 2_000)).toThrow(RangeError);
    expect(() => commissionFor(-1, 2_000)).toThrow(RangeError);
  });

  it('rounds half to even', () => {
    expect(mulDivHalfEven(25, 1, 10)).toBe(2); // 2.5 → 2
    expect(mulDivHalfEven(35, 1, 10)).toBe(4); // 3.5 → 4
    expect(mulDivHalfEven(26, 1, 10)).toBe(3);
    expect(commissionFor(1_234, 2_000)).toBe(247); // 246.8
    expect(commissionFor(1_237, 2_000)).toBe(247); // 247.4
  });

  it('percentToBp handles decimal percents without float drift', () => {
    expect(percentToBp(12.5)).toBe(1_250);
    expect(percentToBp(0.1 + 0.2)).toBe(30);
  });

  it('bonus discount = min(remaining, commission × share)', () => {
    expect(bonusDiscountFor(600, 2_000, 5_000)).toBe(600);
    expect(bonusDiscountFor(5_000, 2_000, 5_000)).toBe(1_000);
    expect(bonusDiscountFor(0, 2_000, 5_000)).toBe(0);
  });

  it('example from 21.1: commission 20,00, bonus discount 6,00, charged 14,00', () => {
    const plan = planCommissionCharge(2_000, { bonusCents: 600, promoCents: 0, topupCents: 5_000, earningsCents: 0 }, 5_000, false);
    expect(plan.fromBonus).toBe(600);
    expect(plan.fromTopup).toBe(1_400);
    expect(plan.toDebt).toBe(0);
  });

  it('charges in order bonus → promo → topup → earnings (if enabled) → debt', () => {
    const pockets = { bonusCents: 10_000, promoCents: 300, topupCents: 200, earningsCents: 1_000 };
    const noEarnings = planCommissionCharge(2_000, pockets, 5_000, false);
    expect(noEarnings).toEqual({ commissionCents: 2_000, fromBonus: 1_000, fromPromo: 300, fromTopup: 200, fromEarnings: 0, toDebt: 500 });
    const withEarnings = planCommissionCharge(2_000, pockets, 5_000, true);
    expect(withEarnings.fromEarnings).toBe(500);
    expect(withEarnings.toDebt).toBe(0);
    const sum = (p: typeof withEarnings) => p.fromBonus + p.fromPromo + p.fromTopup + p.fromEarnings + p.toDebt;
    expect(sum(noEarnings)).toBe(2_000);
    expect(sum(withEarnings)).toBe(2_000);
  });

  it('access balance counts topup and promo only, not bonus', () => {
    expect(accessBalance({ promoCents: 10_000, topupCents: 500 })).toBe(10_500);
  });
});
