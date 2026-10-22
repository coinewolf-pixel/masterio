/**
 * Деньги: только целые центы. Проценты — в базисных пунктах (1 bp = 0,01%, 2000 bp = 20%).
 * Никаких float в расчётах: деление выполняется в целых числах с банковским округлением.
 */

export const BP_DENOMINATOR = 10_000;
/** Комиссия платформы не может быть больше 20% (раздел 7). */
export const MAX_COMMISSION_BP = 2_000;

function assertCents(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer (cents), got ${value}`);
  }
}

/** a × b / d с округлением до ближайшего целого, половина — к чётному. */
export function mulDivHalfEven(a: number, b: number, d: number): number {
  assertCents(a, 'a');
  assertCents(b, 'b');
  if (!Number.isSafeInteger(d) || d <= 0) throw new RangeError('d must be a positive integer');
  const product = BigInt(a) * BigInt(b);
  const divisor = BigInt(d);
  let quotient = product / divisor;
  const remainder = product - quotient * divisor;
  const twice = remainder * 2n;
  if (twice > divisor || (twice === divisor && quotient % 2n === 1n)) quotient += 1n;
  return Number(quotient);
}

/** Доля в базисных пунктах от суммы в центах. */
export function percentOf(amountCents: number, bp: number): number {
  return mulDivHalfEven(amountCents, bp, BP_DENOMINATOR);
}

/** Перевод процента из настроек (20 или 12.5) в базисные пункты без float-ошибок. */
export function percentToBp(percent: number): number {
  const bp = Math.round(percent * 100);
  if (bp < 0 || bp > BP_DENOMINATOR) throw new RangeError(`percent out of range: ${percent}`);
  return bp;
}

/** Комиссия платформы с заказа. Ставка выше 20% отклоняется. */
export function commissionFor(amountCents: number, commissionBp: number): number {
  assertCents(amountCents, 'amountCents');
  if (!Number.isInteger(commissionBp) || commissionBp < 0 || commissionBp > MAX_COMMISSION_BP) {
    throw new RangeError(`commission must be 0..${MAX_COMMISSION_BP} bp, got ${commissionBp}`);
  }
  return percentOf(amountCents, commissionBp);
}

/** Скидка бонуса по заказу = min(остаток бонуса, комиссия × доля) (раздел 21.1). */
export function bonusDiscountFor(remainingBonusCents: number, commissionCents: number, maxShareBp: number): number {
  assertCents(remainingBonusCents, 'remainingBonusCents');
  assertCents(commissionCents, 'commissionCents');
  const cap = Math.floor((commissionCents * maxShareBp) / BP_DENOMINATOR);
  return Math.min(remainingBonusCents, cap);
}

export interface WorkerPockets {
  bonusCents: number;
  promoCents: number;
  topupCents: number;
  earningsCents: number;
}

export interface CommissionChargePlan {
  commissionCents: number;
  fromBonus: number;
  fromPromo: number;
  fromTopup: number;
  fromEarnings: number;
  toDebt: number;
}

/**
 * Порядок списания комиссии (раздел 21.4): бонус (в пределах доли) → приветственный → пополнение →
 * заработок (только если включён зачёт) → остаток уходит в долг мастера.
 */
export function planCommissionCharge(
  commissionCents: number,
  pockets: WorkerPockets,
  bonusMaxShareBp: number,
  useEarnings: boolean,
): CommissionChargePlan {
  assertCents(commissionCents, 'commissionCents');
  const fromBonus = bonusDiscountFor(pockets.bonusCents, commissionCents, bonusMaxShareBp);
  let rest = commissionCents - fromBonus;
  const fromPromo = Math.min(pockets.promoCents, rest);
  rest -= fromPromo;
  const fromTopup = Math.min(pockets.topupCents, rest);
  rest -= fromTopup;
  const fromEarnings = useEarnings ? Math.min(pockets.earningsCents, rest) : 0;
  rest -= fromEarnings;
  return { commissionCents, fromBonus, fromPromo, fromTopup, fromEarnings, toDebt: rest };
}

/** Баланс, который засчитывается в порог доступа к заказам: пополнение + приветственный (раздел 22.3). */
export function accessBalance(pockets: Pick<WorkerPockets, 'promoCents' | 'topupCents'>): number {
  return pockets.promoCents + pockets.topupCents;
}

/** Формат суммы по локали пользователя. Используется только для отображения. */
export function formatMoney(cents: number, currency: string, locale: string): string {
  const minorDigits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
    .maximumFractionDigits ?? 2;
  const value = cents / 10 ** minorDigits;
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
}
