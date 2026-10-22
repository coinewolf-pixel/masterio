import { BP_DENOMINATOR, percentOf } from './money';

export interface BonusTier {
  id: string;
  name: string;
  minOrders: number;
  /** включительно; null — без верхней границы */
  maxOrders: number | null;
  /** процент от уплаченной комиссии, bp */
  percentBp: number;
}

export interface BonusConditions {
  /** минимальный рейтинг × 100 (4,70 → 470), чтобы не сравнивать float */
  minRatingX100: number;
  maxCancelRateBp: number;
  maxLostDisputes: number;
}

export interface WorkerMonthStats {
  workerId: string;
  /** завершённые, подтверждённые, прошедшие окно споров заказы без возвратов и без подозрительных пар */
  ordersCount: number;
  /** фактически удержанная комиссия по этим заказам, центы */
  commissionPaidCents: number;
  ratingX100: number;
  cancelRateBp: number;
  lostDisputes: number;
  /** лицензии и страховки действуют, если требуются */
  documentsValid: boolean;
}

export interface BonusResult {
  workerId: string;
  tier: BonusTier | null;
  rawCents: number;
  /** почему бонус не начислен, если tier = null */
  reason: 'ok' | 'no_tier' | 'rating' | 'cancel_rate' | 'disputes' | 'documents';
}

/** Расчёт бонуса за месяц по ступеням (раздел 20.4): ступень по числу заказов, размер — % от комиссии. */
export function computeMonthlyBonus(
  stats: WorkerMonthStats,
  tiers: readonly BonusTier[],
  conditions: BonusConditions,
): BonusResult {
  const base = { workerId: stats.workerId, tier: null, rawCents: 0 } as const;
  if (stats.ratingX100 < conditions.minRatingX100) return { ...base, reason: 'rating' };
  if (stats.cancelRateBp > conditions.maxCancelRateBp) return { ...base, reason: 'cancel_rate' };
  if (stats.lostDisputes > conditions.maxLostDisputes) return { ...base, reason: 'disputes' };
  if (!stats.documentsValid) return { ...base, reason: 'documents' };

  const tier = [...tiers]
    .sort((a, b) => b.minOrders - a.minOrders)
    .find((t) => stats.ordersCount >= t.minOrders && (t.maxOrders === null || stats.ordersCount <= t.maxOrders));
  if (!tier) return { ...base, reason: 'no_tier' };
  return { workerId: stats.workerId, tier, rawCents: percentOf(stats.commissionPaidCents, tier.percentBp), reason: 'ok' };
}

export interface CappedAward {
  workerId: string;
  rawCents: number;
  finalCents: number;
}

/**
 * Месячный бюджет бонусов (BONUS_BUDGET_CAP): если сумма превышает лимит, все бонусы уменьшаются
 * пропорционально. Округление вниз, поэтому итог никогда не превышает бюджет.
 */
export function applyBudgetCap(
  awards: readonly { workerId: string; rawCents: number }[],
  budgetCapCents: number,
): { awards: CappedAward[]; scaleBp: number; totalRawCents: number; totalFinalCents: number } {
  const totalRawCents = awards.reduce((sum, a) => sum + a.rawCents, 0);
  if (totalRawCents <= budgetCapCents || totalRawCents === 0) {
    return {
      awards: awards.map((a) => ({ ...a, finalCents: a.rawCents })),
      scaleBp: BP_DENOMINATOR,
      totalRawCents,
      totalFinalCents: totalRawCents,
    };
  }
  const capped = awards.map((a) => ({
    ...a,
    finalCents: Number((BigInt(a.rawCents) * BigInt(budgetCapCents)) / BigInt(totalRawCents)),
  }));
  return {
    awards: capped,
    scaleBp: Number((BigInt(budgetCapCents) * BigInt(BP_DENOMINATOR)) / BigInt(totalRawCents)),
    totalRawCents,
    totalFinalCents: capped.reduce((sum, a) => sum + a.finalCents, 0),
  };
}

/** Ступени по умолчанию (раздел 20.4). */
export const DEFAULT_BONUS_TIERS: readonly BonusTier[] = [
  { id: 'base', name: 'base', minOrders: 10, maxOrders: 19, percentBp: 300 },
  { id: 'silver', name: 'silver', minOrders: 20, maxOrders: 39, percentBp: 600 },
  { id: 'gold', name: 'gold', minOrders: 40, maxOrders: null, percentBp: 1000 },
];

export const DEFAULT_BONUS_CONDITIONS: BonusConditions = {
  minRatingX100: 470,
  maxCancelRateBp: 500,
  maxLostDisputes: 0,
};
