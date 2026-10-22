import { Injectable, OnModuleInit } from '@nestjs/common';
import { applyBudgetCap, computeMonthlyBonus, DISPUTE_FINAL, type BonusRuleInput } from '@masterio/shared';
import { AppException } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import type { AuthUser } from '../common/auth';
import { InsuranceService } from '../compliance/insurance.service';
import type { Prisma } from '../generated/prisma/client';
import { JobsService } from '../jobs/jobs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { WalletService } from '../wallet/wallet.service';

const DONE = ['CONFIRMED', 'AUTO_CONFIRMED', 'CLOSED'] as const;

export interface AwardBreakdown {
  currency: string;
  ordersCount: number;
  commissionPaidCents: number;
  tier: string | null;
  percentBp: number;
  rawCents: number;
  scaleBp: number;
  reason: string;
  ratingX100: number;
  cancelRateBp: number;
  lostDisputes: number;
  documentsValid: boolean;
  pendingWindow: number;
}

function monthRange(period: string): { from: Date; to: Date } {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
}

export function previousMonth(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Ежемесячные бонусы (раздел 20.4). 1-го числа создаётся черновик за прошлый месяц и пересчитывается каждый день,
 * пока finance его не одобрит: заказы, у которых ещё не прошло окно споров, в базу не входят и видны как «ждут».
 * База — только подтверждённые заказы без открытых споров и возвратов комиссии, без подозрительных пар.
 * Бюджет BONUS_BUDGET_CAP пропорционально уменьшает все бонусы. Бонус идёт только в карман бонуса со сроком.
 */
@Injectable()
export class BonusesService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly wallet: WalletService,
    private readonly insurance: InsuranceService,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.jobs.register('bonus-monthly', () => this.monthlyTick());
  }

  async monthlyTick(now = new Date()): Promise<void> {
    const period = previousMonth(now);
    const run = await this.prisma.bonusRun.findUnique({ where: { period } });
    if (!run || run.status === 'DRAFT') await this.calculate(period, now);
  }

  // ───────────── Правила ─────────────

  rules() {
    return this.prisma.bonusRule.findMany({ orderBy: [{ isActive: 'desc' }, { minOrders: 'asc' }] });
  }

  async saveRule(admin: AuthUser, input: BonusRuleInput, id?: string) {
    const data = { ...input, minRating: input.minRating.toFixed(2) };
    const before = id ? await this.prisma.bonusRule.findUnique({ where: { id } }) : null;
    if (id && !before) throw new AppException('NOT_FOUND');
    const rule = id ? await this.prisma.bonusRule.update({ where: { id }, data }) : await this.prisma.bonusRule.create({ data });
    await this.audit.log({
      adminId: admin.id,
      action: id ? 'bonus_rule.update' : 'bonus_rule.create',
      entityType: 'BonusRule',
      entityId: rule.id,
      ...(before ? { before: JSON.parse(JSON.stringify(before)) as Prisma.InputJsonValue } : {}),
      after: input as unknown as Prisma.InputJsonValue,
    });
    return rule;
  }

  // ───────────── Расчёт ─────────────

  async calculate(period: string, now = new Date()) {
    const { from, to } = monthRange(period);
    if (to.getTime() > now.getTime()) throw new AppException('VALIDATION_FAILED', { period: 'month is not over yet' });
    const existing = await this.prisma.bonusRun.findUnique({ where: { period } });
    if (existing && existing.status !== 'DRAFT' && existing.status !== 'CANCELLED') throw new AppException('BONUS_RUN_LOCKED');

    const rules = await this.prisma.bonusRule.findMany({ where: { isActive: true }, orderBy: { minOrders: 'asc' } });
    const orders = await this.prisma.order.findMany({
      where: { status: { in: [...DONE] }, confirmedAt: { gte: from, lt: to }, workerId: { not: null } },
      select: { id: true, workerId: true, clientId: true, cityId: true, categoryId: true, currency: true, confirmedAt: true, commissionCents: true, bonusDiscountCents: true },
    });
    const pairs = await this.prisma.fraudFlag.findMany({ where: { type: 'SUSPICIOUS_PAIR', resolvedAt: null }, select: { userId: true, pairUserId: true } });
    const suspicious = new Set(pairs.flatMap((p) => (p.userId && p.pairUserId ? [`${p.userId}|${p.pairUserId}`, `${p.pairUserId}|${p.userId}`] : [])));
    const disputed = new Set(
      (await this.prisma.dispute.findMany({ where: { orderId: { in: orders.map((o) => o.id) }, status: { notIn: [...DISPUTE_FINAL] } }, select: { orderId: true } })).map((d) => d.orderId),
    );
    const refundedRows = await this.prisma.ledgerTransaction.findMany({ where: { kind: 'REVERSAL', orderId: { in: orders.map((o) => o.id) } }, select: { orderId: true } });
    const refunded = new Set(refundedRows.map((r) => r.orderId));

    type Acc = { currency: string; ordersCount: number; commissionPaidCents: number; excluded: string[]; pendingWindow: number };
    const byWorker = new Map<string, Acc>();
    for (const o of orders) {
      const wid = o.workerId as string;
      const acc = byWorker.get(wid) ?? { currency: o.currency, ordersCount: 0, commissionPaidCents: 0, excluded: [], pendingWindow: 0 };
      byWorker.set(wid, acc);
      const windowDays = this.settings.get('DISPUTE_OPEN_WINDOW_DAYS', { cityId: o.cityId, categoryId: o.categoryId });
      if (!o.confirmedAt || o.confirmedAt.getTime() + windowDays * 86_400_000 > now.getTime()) {
        acc.pendingWindow++;
        continue;
      }
      if (suspicious.has(`${wid}|${o.clientId}`) || disputed.has(o.id) || refunded.has(o.id)) {
        acc.excluded.push(o.id);
        continue;
      }
      acc.ordersCount++;
      acc.commissionPaidCents += Math.max(0, (o.commissionCents ?? 0) - (o.bonusDiscountCents ?? 0));
    }

    const lost = await this.prisma.dispute.findMany({
      where: { status: 'SETTLED', closedAt: { gte: from, lt: to }, againstId: { in: [...byWorker.keys()] } },
      select: { againstId: true, outcome: true },
    });
    const lostBy = new Map<string, number>();
    for (const d of lost) {
      if ((d.outcome as { resolution?: string } | null)?.resolution === 'in_favor_client' && d.againstId) lostBy.set(d.againstId, (lostBy.get(d.againstId) ?? 0) + 1);
    }
    const profiles = await this.prisma.workerProfile.findMany({ where: { userId: { in: [...byWorker.keys()] } } });
    const profileBy = new Map(profiles.map((p) => [p.userId, p]));

    const results: Array<{ workerId: string; ruleId: string | null; rawCents: number; breakdown: Omit<AwardBreakdown, 'scaleBp'>; excluded: string[] }> = [];
    for (const [workerId, acc] of byWorker) {
      const p = profileBy.get(workerId);
      const ratingX100 = Math.round(Number(p?.ratingAvg ?? 0) * 100);
      const cancelRateBp = Math.round(Number(p?.cancelRate ?? 0) * 10_000);
      const lostDisputes = lostBy.get(workerId) ?? 0;
      const documentsValid = await this.documentsValid(workerId);
      const rule = [...rules].reverse().find((r) => acc.ordersCount >= r.minOrders && (r.maxOrders === null || acc.ordersCount <= r.maxOrders)) ?? null;
      const res = rule
        ? computeMonthlyBonus(
            { workerId, ordersCount: acc.ordersCount, commissionPaidCents: acc.commissionPaidCents, ratingX100, cancelRateBp, lostDisputes, documentsValid },
            [{ id: rule.id, name: rule.name, minOrders: rule.minOrders, maxOrders: rule.maxOrders, percentBp: rule.percentBp }],
            { minRatingX100: Math.round(Number(rule.minRating) * 100), maxCancelRateBp: rule.maxCancelRateBp, maxLostDisputes: rule.maxLostDisputes },
          )
        : { workerId, tier: null, rawCents: 0, reason: 'no_tier' as const };
      results.push({
        workerId,
        ruleId: res.tier ? rule?.id ?? null : null,
        rawCents: res.rawCents,
        excluded: acc.excluded,
        breakdown: {
          currency: acc.currency,
          ordersCount: acc.ordersCount,
          commissionPaidCents: acc.commissionPaidCents,
          tier: rule?.name ?? null,
          percentBp: rule?.percentBp ?? 0,
          rawCents: res.rawCents,
          reason: res.reason,
          ratingX100,
          cancelRateBp,
          lostDisputes,
          documentsValid,
          pendingWindow: acc.pendingWindow,
        },
      });
    }

    // бюджет — отдельно по каждой валюте (лимит задан в минимальных единицах)
    const cap = this.settings.get('BONUS_BUDGET_CAP');
    const finalBy = new Map<string, { finalCents: number; scaleBp: number }>();
    for (const currency of new Set(results.map((r) => r.breakdown.currency))) {
      const group = results.filter((r) => r.breakdown.currency === currency && r.rawCents > 0);
      const capped = cap > 0 ? applyBudgetCap(group, cap) : { awards: group.map((g) => ({ ...g, finalCents: g.rawCents })), scaleBp: 10_000 };
      for (const a of capped.awards) finalBy.set(a.workerId, { finalCents: a.finalCents, scaleBp: capped.scaleBp });
    }
    const expiresAt = new Date(now.getTime() + this.settings.get('BONUS_EXPIRES_DAYS') * 86_400_000);
    const totalRaw = results.reduce((s, r) => s + r.rawCents, 0);
    const minScale = Math.min(10_000, ...[...finalBy.values()].map((f) => f.scaleBp));

    return this.prisma.$transaction(async (tx) => {
      const run = existing
        ? await tx.bonusRun.update({ where: { id: existing.id }, data: { status: 'DRAFT', budgetCapCents: cap, totalRawCents: totalRaw, scaleFactor: (minScale / 10_000).toFixed(5) } })
        : await tx.bonusRun.create({ data: { period, budgetCapCents: cap, totalRawCents: totalRaw, scaleFactor: (minScale / 10_000).toFixed(5) } });
      await tx.bonusAward.deleteMany({ where: { runId: run.id } });
      for (const r of results) {
        const f = finalBy.get(r.workerId);
        await tx.bonusAward.create({
          data: {
            runId: run.id,
            workerId: r.workerId,
            ruleId: r.ruleId,
            ordersCount: r.breakdown.ordersCount,
            commissionPaidCents: r.breakdown.commissionPaidCents,
            rawCents: r.rawCents,
            finalCents: f?.finalCents ?? 0,
            excludedOrders: r.excluded,
            expiresAt,
            breakdown: { ...r.breakdown, scaleBp: f?.scaleBp ?? 10_000 } as unknown as Prisma.InputJsonValue,
          },
        });
      }
      return run;
    });
  }

  /** Лицензии по услугам мастера, где они нужны, подтверждены и действуют; страховка — по правилам страны. */
  private async documentsValid(workerId: string): Promise<boolean> {
    const w = await this.prisma.workerProfile.findUnique({ where: { userId: workerId }, include: { categories: { include: { category: true } } } });
    if (!w) return false;
    for (const wc of w.categories) {
      if (!wc.category.requiresLicense) continue;
      const ok = await this.prisma.license.count({
        where: { categoryId: wc.categoryId, document: { ownerId: workerId, status: 'VERIFIED', OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }] } },
      });
      if (ok === 0) return false;
    }
    const ins = await this.insurance.forWorker(workerId);
    return ins.items.every((i) => i.satisfied);
  }

  // ───────────── Просмотр и одобрение ─────────────

  runs() {
    return this.prisma.bonusRun.findMany({ orderBy: { period: 'desc' }, take: 24, include: { _count: { select: { awards: true } } } });
  }

  async run(id: string) {
    const run = await this.prisma.bonusRun.findUnique({ where: { id }, include: { awards: { orderBy: [{ finalCents: 'desc' }, { ordersCount: 'desc' }] } } });
    if (!run) throw new AppException('NOT_FOUND');
    const users = await this.prisma.user.findMany({ where: { id: { in: run.awards.map((a) => a.workerId) } }, select: { id: true, phone: true } });
    const phone = new Map(users.map((u) => [u.id, u.phone]));
    const totals = new Map<string, { raw: number; final: number; workers: number }>();
    for (const a of run.awards) {
      const c = (a.breakdown as unknown as AwardBreakdown).currency;
      const t = totals.get(c) ?? { raw: 0, final: 0, workers: 0 };
      t.raw += a.rawCents;
      t.final += a.finalCents;
      if (a.finalCents > 0) t.workers++;
      totals.set(c, t);
    }
    return {
      ...run,
      scaleFactor: Number(run.scaleFactor),
      totals: [...totals.entries()].map(([currency, t]) => ({ currency, rawCents: t.raw, finalCents: t.final, workers: t.workers })),
      awards: run.awards.map((a) => ({ ...a, workerPhone: phone.get(a.workerId) ?? null })),
    };
  }

  async approve(admin: AuthUser, id: string) {
    const run = await this.prisma.bonusRun.findUnique({ where: { id }, include: { awards: true } });
    if (!run) throw new AppException('NOT_FOUND');
    if (run.status !== 'DRAFT') throw new AppException('BONUS_RUN_LOCKED');
    const pending = run.awards.reduce((s, a) => s + (a.breakdown as unknown as AwardBreakdown).pendingWindow, 0);
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.bonusRun.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'APPLIED', approvedById: admin.id, approvedAt: new Date() } });
      if (res.count === 0) throw new AppException('BONUS_RUN_LOCKED');
      for (const a of run.awards) {
        if (a.finalCents <= 0) continue;
        const currency = (a.breakdown as unknown as AwardBreakdown).currency;
        await this.wallet.creditBonus(tx, { workerId: a.workerId, currency, amountCents: a.finalCents, awardId: a.id, expiresAt: a.expiresAt, actorId: admin.id });
      }
      await this.audit.log({ adminId: admin.id, action: 'bonus_run.approve', entityType: 'BonusRun', entityId: id, after: { period: run.period, awards: run.awards.filter((a) => a.finalCents > 0).length, pendingWindow: pending } }, tx);
    });
    for (const a of run.awards) {
      if (a.finalCents <= 0) continue;
      const currency = (a.breakdown as unknown as AwardBreakdown).currency;
      await this.wallet.emitChanged(a.workerId, currency);
      await this.notifications.notify(a.workerId, { key: 'push.bonus_credited', params: { period: run.period } });
    }
    return this.run(id);
  }

  async cancel(admin: AuthUser, id: string) {
    const res = await this.prisma.bonusRun.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'CANCELLED' } });
    if (res.count === 0) throw new AppException('BONUS_RUN_LOCKED');
    await this.audit.log({ adminId: admin.id, action: 'bonus_run.cancel', entityType: 'BonusRun', entityId: id });
    return this.run(id);
  }

  /** Мастер видит свои начисления и формулу (раздел 20.4). */
  async forWorker(workerId: string) {
    const awards = await this.prisma.bonusAward.findMany({ where: { workerId, run: { status: 'APPLIED' } }, include: { run: { select: { period: true } } }, orderBy: { run: { period: 'desc' } }, take: 24 });
    return awards.map((a) => {
      const b = a.breakdown as unknown as AwardBreakdown;
      return { period: a.run.period, currency: b.currency, ordersCount: a.ordersCount, commissionPaidCents: a.commissionPaidCents, finalCents: a.finalCents, expiresAt: a.expiresAt, breakdown: b };
    });
  }
}
