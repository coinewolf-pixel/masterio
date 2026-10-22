import { Injectable } from '@nestjs/common';
import { planCommissionCharge, type CommissionChargePlan, type WalletChangedPayload } from '@masterio/shared';
import { RT_EVENTS } from '@masterio/shared';
import type { LedgerAccountType } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SettingsService } from '../settings/settings.service';
import { currencyForCountry } from './currency';
import { LedgerService } from './ledger.service';
import { AppException } from '../common/app-exception';

export interface Pockets {
  currency: string;
  topupCents: number;
  promoCents: number;
  bonusCents: number;
  earningsCents: number;
  pendingCents: number;
  /** сколько мастер должен платформе (положительное число) */
  debtCents: number;
}

/** Кошелёк мастера: карманы, списание комиссии, пополнение, сгорание промо и бонусов. */
@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Валюта кошелька мастера: валюта его первого города, иначе по стране. */
  async workerCurrency(tx: Tx | PrismaService, workerId: string): Promise<string> {
    const city = await tx.workerCity.findFirst({ where: { workerId }, include: { city: true } });
    if (city) return city.city.currency;
    const user = await tx.user.findUniqueOrThrow({ where: { id: workerId }, select: { countryCode: true } });
    return currencyForCountry(user.countryCode);
  }

  /** Блокировка кошелька мастера до конца транзакции: операции с одним кошельком идут строго по очереди. */
  async lock(tx: Tx, workerId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wallet:${workerId}`}))`;
  }

  async pockets(tx: Tx | PrismaService, workerId: string, currency: string): Promise<Pockets> {
    const b = await this.ledger.balances(tx as Tx, workerId, currency);
    return {
      currency,
      topupCents: b.WORKER_TOPUP ?? 0,
      promoCents: b.WORKER_PROMO ?? 0,
      bonusCents: b.WORKER_BONUS ?? 0,
      earningsCents: b.WORKER_EARNINGS ?? 0,
      pendingCents: b.WORKER_PENDING ?? 0,
      debtCents: 0 - (b.WORKER_DEBT ?? 0),
    };
  }

  /**
   * Списание комиссии по заказу (раздел 21.4, 22): бонус (до BONUS_MAX_DISCOUNT_SHARE) → приветственный →
   * пополнение → заработок (если мастер включил зачёт) → остаток в долг. Повторный вызов по тому же заказу ничего не меняет.
   */
  async chargeCommission(
    tx: Tx,
    input: { orderId: string; workerId: string; currency: string; commissionCents: number; ctx: { countryCode: string; cityId: string; categoryId: string } },
  ): Promise<CommissionChargePlan & { replayed: boolean }> {
    await this.lock(tx, input.workerId);
    await this.burnExpiredLots(tx, input.workerId, input.currency);
    const worker = await tx.workerProfile.findUniqueOrThrow({ where: { userId: input.workerId } });
    const pockets = await this.pockets(tx, input.workerId, input.currency);
    const plan = planCommissionCharge(
      input.commissionCents,
      pockets,
      this.settings.get('BONUS_MAX_DISCOUNT_SHARE_BP', input.ctx),
      worker.autoUseEarnings,
    );
    const w = input.workerId;
    const result = await this.ledger.post(tx, {
      kind: 'COMMISSION',
      idempotencyKey: `commission:${input.orderId}`,
      currency: input.currency,
      orderId: input.orderId,
      legs: [
        { type: 'PLATFORM_REVENUE', ownerId: null, amountCents: plan.commissionCents },
        { type: 'WORKER_BONUS', ownerId: w, amountCents: -plan.fromBonus },
        { type: 'WORKER_PROMO', ownerId: w, amountCents: -plan.fromPromo },
        { type: 'WORKER_TOPUP', ownerId: w, amountCents: -plan.fromTopup },
        { type: 'WORKER_EARNINGS', ownerId: w, amountCents: -plan.fromEarnings },
        { type: 'WORKER_DEBT', ownerId: w, amountCents: -plan.toDebt },
      ],
      memo: `bonus ${plan.fromBonus}, promo ${plan.fromPromo}, topup ${plan.fromTopup}, earnings ${plan.fromEarnings}, debt ${plan.toDebt}`,
    });
    if (!result.replayed) {
      await this.consumeLots(tx, w, 'WORKER_BONUS', input.currency, plan.fromBonus);
      await this.consumeLots(tx, w, 'WORKER_PROMO', input.currency, plan.fromPromo);
    }
    return { ...plan, replayed: result.replayed };
  }

  /** Пополнение картой: сначала гасится долг, остаток идёт в карман пополнения (не выводится). */
  async creditTopup(
    tx: Tx,
    input: { workerId: string; currency: string; amountCents: number; paymentId: string; providerRef: string },
  ): Promise<{ toDebt: number; toTopup: number; replayed: boolean }> {
    await this.lock(tx, input.workerId);
    const pockets = await this.pockets(tx, input.workerId, input.currency);
    const toDebt = Math.min(pockets.debtCents, input.amountCents);
    const toTopup = input.amountCents - toDebt;
    const r = await this.ledger.post(tx, {
      kind: 'TOPUP',
      idempotencyKey: `topup:${input.providerRef}`,
      currency: input.currency,
      paymentId: input.paymentId,
      legs: [
        { type: 'STRIPE_CLEARING', ownerId: null, amountCents: -input.amountCents },
        { type: 'WORKER_DEBT', ownerId: input.workerId, amountCents: toDebt },
        { type: 'WORKER_TOPUP', ownerId: input.workerId, amountCents: toTopup },
      ],
    });
    return { toDebt, toTopup, replayed: r.replayed };
  }

  /** Chargeback по пополнению: деньги забираются из кармана пополнения, недостача — в долг. */
  async reverseTopup(
    tx: Tx,
    input: { workerId: string; currency: string; amountCents: number; paymentId: string; providerRef: string },
  ): Promise<void> {
    await this.lock(tx, input.workerId);
    const pockets = await this.pockets(tx, input.workerId, input.currency);
    const fromTopup = Math.min(pockets.topupCents, input.amountCents);
    await this.ledger.post(tx, {
      kind: 'CHARGEBACK',
      idempotencyKey: `chargeback:${input.providerRef}`,
      currency: input.currency,
      paymentId: input.paymentId,
      legs: [
        { type: 'STRIPE_CLEARING', ownerId: null, amountCents: input.amountCents },
        { type: 'WORKER_TOPUP', ownerId: input.workerId, amountCents: -fromTopup },
        { type: 'WORKER_DEBT', ownerId: input.workerId, amountCents: -(input.amountCents - fromTopup) },
      ],
    });
  }

  /** Приветственный кредит (виртуальный кредит платформы): только в карман promo, со сроком действия. */
  async creditPromo(
    tx: Tx,
    input: { workerId: string; currency: string; amountCents: number; grantId: string; expiresAt: Date; actorId: string | null },
  ): Promise<void> {
    await this.lock(tx, input.workerId);
    const r = await this.ledger.post(tx, {
      kind: 'PROMO_GRANT',
      idempotencyKey: `grant:${input.grantId}`,
      currency: input.currency,
      grantId: input.grantId,
      actorId: input.actorId ?? undefined,
      legs: [
        { type: 'PROMO_EXPENSE', ownerId: null, amountCents: -input.amountCents },
        { type: 'WORKER_PROMO', ownerId: input.workerId, amountCents: input.amountCents },
      ],
    });
    if (!r.replayed) {
      const accountId = await this.ledger.ensureAccount(tx, 'WORKER_PROMO', input.workerId, input.currency);
      await tx.balanceLot.create({
        data: {
          accountId,
          originTxId: r.transactionId,
          amountCents: BigInt(input.amountCents),
          remainingCents: BigInt(input.amountCents),
          expiresAt: input.expiresAt,
        },
      });
    }
  }

  /** Месячный бонус (раздел 20.4): только в карман бонуса, со сроком; идёт на скидку по комиссии, не выводится. */
  async creditBonus(
    tx: Tx,
    input: { workerId: string; currency: string; amountCents: number; awardId: string; expiresAt: Date; actorId: string },
  ): Promise<void> {
    if (input.amountCents <= 0) return;
    await this.lock(tx, input.workerId);
    const r = await this.ledger.post(tx, {
      kind: 'BONUS_ACCRUAL',
      idempotencyKey: `bonus:${input.awardId}`,
      currency: input.currency,
      actorId: input.actorId,
      legs: [
        { type: 'BONUS_EXPENSE', ownerId: null, amountCents: -input.amountCents },
        { type: 'WORKER_BONUS', ownerId: input.workerId, amountCents: input.amountCents },
      ],
    });
    if (!r.replayed) {
      const accountId = await this.ledger.ensureAccount(tx, 'WORKER_BONUS', input.workerId, input.currency);
      await tx.balanceLot.create({
        data: { accountId, originTxId: r.transactionId, amountCents: BigInt(input.amountCents), remainingCents: BigInt(input.amountCents), expiresAt: input.expiresAt },
      });
    }
  }

  /** Сколько комиссии по заказу уже возвращено решениями по спорам. */
  async refundedCommission(tx: Tx | PrismaService, orderId: string): Promise<number> {
    const rows = await tx.ledgerEntry.findMany({
      where: { transaction: { kind: 'REVERSAL', orderId }, account: { type: 'PLATFORM_REVENUE' } },
      select: { amountCents: true },
    });
    return rows.reduce((sum, r) => sum - Number(r.amountCents), 0);
  }

  /**
   * Возврат комиссии мастеру по решению спора: из дохода платформы — сначала в погашение долга, остаток в карман
   * пополнения (не выводится). Не больше фактически удержанной комиссии (без скидки бонусом) за вычетом прошлых возвратов.
   */
  async refundCommission(
    tx: Tx,
    input: { orderId: string; workerId: string; currency: string; amountCents: number; disputeId: string; actorId: string },
  ): Promise<{ toDebt: number; toTopup: number }> {
    await this.lock(tx, input.workerId);
    const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId } });
    const charged = (order.commissionCents ?? 0) - (order.bonusDiscountCents ?? 0);
    const available = charged - (await this.refundedCommission(tx, input.orderId));
    if (input.amountCents > available) throw new AppException('VALIDATION_FAILED', { commissionRefundCents: `max ${Math.max(0, available)}` });
    const pockets = await this.pockets(tx, input.workerId, input.currency);
    const toDebt = Math.min(pockets.debtCents, input.amountCents);
    const toTopup = input.amountCents - toDebt;
    await this.ledger.post(tx, {
      kind: 'REVERSAL',
      idempotencyKey: `commission-refund:${input.disputeId}`,
      currency: input.currency,
      orderId: input.orderId,
      actorId: input.actorId,
      memo: `dispute ${input.disputeId}`,
      legs: [
        { type: 'PLATFORM_REVENUE', ownerId: null, amountCents: -input.amountCents },
        { type: 'WORKER_DEBT', ownerId: input.workerId, amountCents: toDebt },
        { type: 'WORKER_TOPUP', ownerId: input.workerId, amountCents: toTopup },
      ],
    });
    return { toDebt, toTopup };
  }

  /** Сжигание просроченных партий промо и бонусов (вызывается перед списанием и ежедневной задачей). */
  async burnExpiredLots(tx: Tx, workerId: string, currency: string): Promise<number> {
    let burned = 0;
    for (const [pocket, expiredAccount, kind] of [
      ['WORKER_PROMO', 'PROMO_EXPIRED', 'PROMO_EXPIRY'],
      ['WORKER_BONUS', 'BONUS_EXPIRED', 'BONUS_EXPIRY'],
    ] as const) {
      const accountId = await this.ledger.findAccount(tx, pocket, workerId, currency);
      if (!accountId) continue;
      const lots = await tx.balanceLot.findMany({
        where: { accountId, remainingCents: { gt: 0 }, expiresAt: { lte: new Date() } },
      });
      for (const lot of lots) {
        const amount = Number(lot.remainingCents);
        await this.ledger.post(tx, {
          kind,
          idempotencyKey: `expire:${lot.id}`,
          currency,
          legs: [
            { type: pocket, ownerId: workerId, amountCents: -amount },
            { type: expiredAccount, ownerId: null, amountCents: amount },
          ],
        });
        await tx.balanceLot.update({ where: { id: lot.id }, data: { remainingCents: 0n } });
        burned += amount;
      }
    }
    return burned;
  }

  /** Сгорание всего промо при блокировке мастера за нарушение (раздел 20.2). */
  async burnAllPromo(tx: Tx, workerId: string, currency: string, reason: string): Promise<number> {
    await this.lock(tx, workerId);
    const pockets = await this.pockets(tx, workerId, currency);
    if (pockets.promoCents === 0) return 0;
    const accountId = await this.ledger.ensureAccount(tx, 'WORKER_PROMO', workerId, currency);
    const r = await this.ledger.post(tx, {
      kind: 'PROMO_EXPIRY',
      idempotencyKey: `promo-burn:${workerId}:${Date.now()}`,
      currency,
      memo: reason,
      legs: [
        { type: 'WORKER_PROMO', ownerId: workerId, amountCents: -pockets.promoCents },
        { type: 'PROMO_EXPIRED', ownerId: null, amountCents: pockets.promoCents },
      ],
    });
    if (!r.replayed) await tx.balanceLot.updateMany({ where: { accountId }, data: { remainingCents: 0n } });
    return pockets.promoCents;
  }

  private async consumeLots(tx: Tx, workerId: string, pocket: LedgerAccountType, currency: string, amount: number): Promise<void> {
    if (amount <= 0) return;
    const accountId = await this.ledger.ensureAccount(tx, pocket, workerId, currency);
    const lots = await tx.balanceLot.findMany({
      where: { accountId, remainingCents: { gt: 0 } },
      orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
    });
    let rest = BigInt(amount);
    for (const lot of lots) {
      if (rest === 0n) break;
      const take = lot.remainingCents < rest ? lot.remainingCents : rest;
      await tx.balanceLot.update({ where: { id: lot.id }, data: { remainingCents: lot.remainingCents - take } });
      rest -= take;
    }
  }

  async emitChanged(workerId: string, currency: string): Promise<void> {
    const p = await this.pockets(this.prisma, workerId, currency);
    const payload: WalletChangedPayload = {
      topupCents: p.topupCents,
      promoCents: p.promoCents,
      bonusCents: p.bonusCents,
      earningsCents: p.earningsCents,
      debtCents: p.debtCents,
    };
    this.realtime.toUser(workerId, RT_EVENTS.walletChanged, payload);
  }
}
