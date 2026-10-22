import { Injectable } from '@nestjs/common';
import { DEFAULT_BONUS_CONDITIONS, type BonusTier } from '@masterio/shared';
import { PrismaService } from '../prisma/prisma.service';

const DONE = ['CONFIRMED', 'AUTO_CONFIRMED', 'CLOSED', 'COMPLETED_BY_WORKER', 'DISPUTED'] as const;

export interface MonthSummary {
  month: string;
  currency: string | null;
  ordersCount: number;
  grossCents: number;
  commissionCents: number;
  bonusUsedCents: number;
  netCents: number;
  cashCount: number;
  cardCount: number;
  avgRating: number | null;
  cancelRateBp: number;
}

/** История заказов и заработок за месяц (раздел 21.5). Месяц — календарный, по UTC. */
@Injectable()
export class HistoryService {
  constructor(private readonly prisma: PrismaService) {}

  monthRange(month: string): { from: Date; to: Date; prev: string } {
    const [y, m] = month.split('-').map(Number) as [number, number];
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 1));
    const prevDate = new Date(Date.UTC(y, m - 2, 1));
    const prev = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, '0')}`;
    return { from, to, prev };
  }

  async workerOrders(workerId: string, month: string) {
    const { from, to } = this.monthRange(month);
    const orders = await this.prisma.order.findMany({
      where: { workerId, completedAt: { gte: from, lt: to }, status: { in: [...DONE] } },
      orderBy: { completedAt: 'desc' },
      include: { category: { select: { code: true, names: true } } },
    });
    return orders.map((o) => {
      const amount = o.confirmedAmountCents ?? 0;
      const commission = o.commissionCents ?? 0;
      const bonus = o.bonusDiscountCents ?? 0;
      return {
        id: o.id,
        number: o.number,
        completedAt: o.completedAt,
        status: o.status,
        category: o.category,
        paymentMethod: o.paymentMethod,
        currency: o.currency,
        amountCents: amount,
        commissionCents: commission,
        bonusDiscountCents: bonus,
        // мастер получил всю сумму наличными и отдал платформе комиссию минус скидку бонуса
        netCents: amount - commission + bonus,
        clientUnconfirmed: o.clientUnconfirmed,
      };
    });
  }

  async workerSummary(workerId: string, month: string): Promise<MonthSummary> {
    const { from, to } = this.monthRange(month);
    const orders = await this.workerOrders(workerId, month);
    const reviews = await this.prisma.review.aggregate({
      where: { targetId: workerId, createdAt: { gte: from, lt: to }, isHidden: false },
      _avg: { rating: true },
    });
    const [accepted, cancelled] = await Promise.all([
      this.prisma.offer.count({ where: { workerId, status: 'ACCEPTED', respondedAt: { gte: from, lt: to } } }),
      this.prisma.orderEvent.count({ where: { type: 'worker_cancelled', actorId: workerId, createdAt: { gte: from, lt: to } } }),
    ]);
    const sum = (f: (o: (typeof orders)[number]) => number) => orders.reduce((s, o) => s + f(o), 0);
    return {
      month,
      currency: orders[0]?.currency ?? null,
      ordersCount: orders.length,
      grossCents: sum((o) => o.amountCents),
      commissionCents: sum((o) => o.commissionCents),
      bonusUsedCents: sum((o) => o.bonusDiscountCents),
      netCents: sum((o) => o.netCents),
      cashCount: orders.filter((o) => o.paymentMethod === 'CASH').length,
      cardCount: orders.filter((o) => o.paymentMethod === 'CARD').length,
      avgRating: reviews._avg.rating === null ? null : Math.round(reviews._avg.rating * 100) / 100,
      cancelRateBp: accepted > 0 ? Math.round((cancelled / accepted) * 10_000) : 0,
    };
  }

  /** Сводка + сравнение с прошлым месяцем + прогресс до следующей ступени бонуса. */
  async workerStats(workerId: string, month: string) {
    const { prev } = this.monthRange(month);
    const [current, previous, rules] = await Promise.all([
      this.workerSummary(workerId, month),
      this.workerSummary(workerId, prev),
      this.prisma.bonusRule.findMany({ where: { isActive: true }, orderBy: { minOrders: 'asc' } }),
    ]);
    const tiers: BonusTier[] = rules.map((r) => ({ id: r.id, name: r.name, minOrders: r.minOrders, maxOrders: r.maxOrders, percentBp: r.percentBp }));
    const currentTier = [...tiers].reverse().find((t) => current.ordersCount >= t.minOrders) ?? null;
    const nextTier = tiers.find((t) => t.minOrders > current.ordersCount) ?? null;
    return {
      current,
      previous,
      bonus: {
        currentTier,
        nextTier,
        ordersToNext: nextTier ? nextTier.minOrders - current.ordersCount : 0,
        conditions: {
          minRating: DEFAULT_BONUS_CONDITIONS.minRatingX100 / 100,
          maxCancelRatePercent: DEFAULT_BONUS_CONDITIONS.maxCancelRateBp / 100,
          maxLostDisputes: DEFAULT_BONUS_CONDITIONS.maxLostDisputes,
        },
      },
    };
  }

  /** CSV для налогов: разделитель «;», суммы в обычных единицах валюты с точкой. */
  async workerCsv(workerId: string, month: string): Promise<string> {
    const orders = await this.workerOrders(workerId, month);
    const money = (c: number) => (c / 100).toFixed(2);
    const header = 'number;completed_at;category;payment_method;currency;amount;commission;bonus_discount;net';
    const rows = orders.map((o) =>
      [o.number, o.completedAt?.toISOString() ?? '', o.category.code, o.paymentMethod, o.currency, money(o.amountCents), money(o.commissionCents), money(o.bonusDiscountCents), money(o.netCents)].join(';'),
    );
    return [header, ...rows].join('\n') + '\n';
  }
}
