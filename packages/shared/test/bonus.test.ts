import { applyBudgetCap, computeMonthlyBonus, DEFAULT_BONUS_CONDITIONS, DEFAULT_BONUS_TIERS } from '../src/bonus';

const good = { ratingX100: 490, cancelRateBp: 200, lostDisputes: 0, documentsValid: true };

describe('monthly bonus', () => {
  it('25 orders × 100 EUR → commission 500 EUR, silver 6% → 30 EUR (section 20.5)', () => {
    const r = computeMonthlyBonus({ workerId: 'w', ordersCount: 25, commissionPaidCents: 50_000, ...good }, DEFAULT_BONUS_TIERS, DEFAULT_BONUS_CONDITIONS);
    expect(r.tier?.id).toBe('silver');
    expect(r.rawCents).toBe(3_000);
  });

  it('tier boundaries', () => {
    const at = (n: number) =>
      computeMonthlyBonus({ workerId: 'w', ordersCount: n, commissionPaidCents: 10_000, ...good }, DEFAULT_BONUS_TIERS, DEFAULT_BONUS_CONDITIONS).tier?.id ?? null;
    expect(at(9)).toBeNull();
    expect(at(10)).toBe('base');
    expect(at(19)).toBe('base');
    expect(at(20)).toBe('silver');
    expect(at(39)).toBe('silver');
    expect(at(40)).toBe('gold');
    expect(at(400)).toBe('gold');
  });

  it('general conditions block the bonus', () => {
    const base = { workerId: 'w', ordersCount: 50, commissionPaidCents: 100_000 };
    const run = (o: Partial<typeof good>) => computeMonthlyBonus({ ...base, ...good, ...o }, DEFAULT_BONUS_TIERS, DEFAULT_BONUS_CONDITIONS);
    expect(run({ ratingX100: 469 }).reason).toBe('rating');
    expect(run({ cancelRateBp: 501 }).reason).toBe('cancel_rate');
    expect(run({ lostDisputes: 1 }).reason).toBe('disputes');
    expect(run({ documentsValid: false }).reason).toBe('documents');
    expect(run({}).rawCents).toBe(10_000);
  });

  it('budget cap scales proportionally and never exceeds the cap', () => {
    const r = applyBudgetCap(
      [
        { workerId: 'a', rawCents: 3_000 },
        { workerId: 'b', rawCents: 1_000 },
        { workerId: 'c', rawCents: 333 },
      ],
      2_000,
    );
    expect(r.totalRawCents).toBe(4_333);
    expect(r.totalFinalCents).toBeLessThanOrEqual(2_000);
    expect(r.awards.map((a) => a.finalCents)).toEqual([1_384, 461, 153]);
  });

  it('budget cap does nothing when under the limit', () => {
    const r = applyBudgetCap([{ workerId: 'a', rawCents: 500 }], 2_000);
    expect(r.awards[0]?.finalCents).toBe(500);
    expect(r.scaleBp).toBe(10_000);
  });
});
