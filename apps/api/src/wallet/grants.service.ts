import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import type { grantSchema } from '@masterio/shared';
import { AppException } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import { isAdminWith, type AuthUser } from '../common/auth';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { WalletService } from './wallet.service';
import type { WalletGrant } from '../generated/prisma/client';
import { formatMoney } from '@masterio/shared';

/**
 * Приветственный/стартовый кредит мастеру (разделы 20.2, 21.6). Только в карман promo: не выводится,
 * засчитывается в порог доступа и покрывает комиссию. Лимиты, запрет начислять себе, 4 eyes выше порога.
 */
@Injectable()
export class GrantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(admin: AuthUser, input: z.infer<typeof grantSchema>): Promise<WalletGrant> {
    if (!isAdminWith(admin, 'FINANCE')) throw new AppException('FORBIDDEN');
    const worker = await this.prisma.user.findUnique({ where: { id: input.workerId }, include: { worker: true, devices: true } });
    if (!worker || worker.role !== 'WORKER' || !worker.worker) throw new AppException('NOT_FOUND');
    if (worker.status === 'BLOCKED' || worker.status === 'DELETED') throw new AppException('ACCOUNT_BLOCKED');
    await this.assertNotRelated(admin.id, worker.id, worker.phone, worker.devices.map((d) => d.fingerprint));

    const presets = this.settings.get('WELCOME_PRESETS');
    const amount = input.presetIndex !== undefined ? presets[input.presetIndex] : input.amountCents;
    if (amount === undefined || amount <= 0) throw new AppException('VALIDATION_FAILED', { presetIndex: 'unknown preset' });

    const perWorkerMax = this.settings.get('GRANT_MAX_PER_WORKER');
    const already = await this.prisma.walletGrant.aggregate({
      where: { workerId: worker.id, status: { in: ['APPROVED', 'PENDING_APPROVAL'] } },
      _sum: { amountCents: true },
    });
    if ((already._sum.amountCents ?? 0) + amount > perWorkerMax) {
      throw new AppException('GRANT_LIMIT_EXCEEDED', { perWorkerMax, alreadyGranted: already._sum.amountCents ?? 0 });
    }

    const isSuper = admin.subRoles.includes('SUPERADMIN');
    if (!isSuper) {
      const dayStart = new Date();
      dayStart.setUTCHours(0, 0, 0, 0);
      const today = await this.prisma.walletGrant.aggregate({
        where: { createdById: admin.id, createdAt: { gte: dayStart }, status: { in: ['APPROVED', 'PENDING_APPROVAL'] } },
        _sum: { amountCents: true },
      });
      if ((today._sum.amountCents ?? 0) + amount > this.settings.get('GRANT_FINANCE_DAILY_LIMIT')) {
        throw new AppException('GRANT_LIMIT_EXCEEDED', { reason: 'daily_limit' });
      }
    }

    const needsSecond = amount > this.settings.get('GRANT_SECOND_APPROVAL_ABOVE');
    const expiresAt = new Date(Date.now() + (input.expiresInDays ?? this.settings.get('PROMO_EXPIRES_DAYS')) * 86_400_000);
    const currency = await this.wallet.workerCurrency(this.prisma, worker.id);

    const grant = await this.prisma.$transaction(async (tx) => {
      const g = await tx.walletGrant.create({
        data: {
          workerId: worker.id,
          amountCents: amount,
          reason: input.reason,
          expiresAt,
          createdById: admin.id,
          status: needsSecond ? 'PENDING_APPROVAL' : 'APPROVED',
          decidedAt: needsSecond ? null : new Date(),
        },
      });
      if (!needsSecond) {
        await this.wallet.creditPromo(tx, { workerId: worker.id, currency, amountCents: amount, grantId: g.id, expiresAt, actorId: admin.id });
      }
      await this.audit.log(
        { adminId: admin.id, action: 'grant.create', entityType: 'WalletGrant', entityId: g.id, after: { workerId: worker.id, amount, status: g.status, reason: input.reason } },
        tx,
      );
      return g;
    });
    if (!needsSecond) await this.afterCredit(grant, currency);
    return grant;
  }

  /** Подтверждение вторым админом (не тем, кто создал) — только superadmin. */
  async approve(admin: AuthUser, grantId: string): Promise<WalletGrant> {
    if (!admin.subRoles.includes('SUPERADMIN')) throw new AppException('FORBIDDEN');
    const grant = await this.prisma.walletGrant.findUnique({ where: { id: grantId } });
    if (!grant) throw new AppException('NOT_FOUND');
    if (grant.status !== 'PENDING_APPROVAL') throw new AppException('INVALID_STATUS_TRANSITION');
    if (grant.createdById === admin.id) throw new AppException('GRANT_SECOND_APPROVER_REQUIRED');
    const worker = await this.prisma.user.findUniqueOrThrow({ where: { id: grant.workerId }, include: { devices: true } });
    await this.assertNotRelated(admin.id, worker.id, worker.phone, worker.devices.map((d) => d.fingerprint));
    const currency = await this.wallet.workerCurrency(this.prisma, grant.workerId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const marked = await tx.walletGrant.updateMany({
        where: { id: grant.id, status: 'PENDING_APPROVAL' },
        data: { status: 'APPROVED', approvedById: admin.id, decidedAt: new Date() },
      });
      if (marked.count === 0) throw new AppException('INVALID_STATUS_TRANSITION');
      await this.wallet.creditPromo(tx, {
        workerId: grant.workerId,
        currency,
        amountCents: grant.amountCents,
        grantId: grant.id,
        expiresAt: grant.expiresAt,
        actorId: admin.id,
      });
      await this.audit.log({ adminId: admin.id, action: 'grant.approve', entityType: 'WalletGrant', entityId: grant.id }, tx);
      return tx.walletGrant.findUniqueOrThrow({ where: { id: grant.id } });
    });
    await this.afterCredit(updated, currency);
    return updated;
  }

  async reject(admin: AuthUser, grantId: string): Promise<WalletGrant> {
    if (!admin.subRoles.includes('SUPERADMIN')) throw new AppException('FORBIDDEN');
    const marked = await this.prisma.walletGrant.updateMany({
      where: { id: grantId, status: 'PENDING_APPROVAL' },
      data: { status: 'REJECTED', approvedById: null, decidedAt: new Date() },
    });
    if (marked.count === 0) throw new AppException('INVALID_STATUS_TRANSITION');
    await this.audit.log({ adminId: admin.id, action: 'grant.reject', entityType: 'WalletGrant', entityId: grantId });
    return this.prisma.walletGrant.findUniqueOrThrow({ where: { id: grantId } });
  }

  /** Нельзя начислять себе или связанному аккаунту: тот же телефон или общее устройство. */
  private async assertNotRelated(adminId: string, workerId: string, workerPhone: string | null, workerDevices: string[]): Promise<void> {
    if (adminId === workerId) throw new AppException('GRANT_SELF_FORBIDDEN');
    const admin = await this.prisma.user.findUniqueOrThrow({ where: { id: adminId }, include: { devices: true } });
    if (admin.phone && workerPhone && admin.phone === workerPhone) throw new AppException('GRANT_SELF_FORBIDDEN');
    const shared = admin.devices.some((d) => workerDevices.includes(d.fingerprint));
    if (shared) throw new AppException('GRANT_SELF_FORBIDDEN');
  }

  private async afterCredit(grant: WalletGrant, currency: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: grant.workerId }, select: { locale: true } });
    await this.notifications.notify(grant.workerId, {
      key: 'push.grant_received',
      params: {
        amount: formatMoney(grant.amountCents, currency, user.locale),
        date: grant.expiresAt.toISOString().slice(0, 10),
      },
    });
    await this.wallet.emitChanged(grant.workerId, currency);
  }
}
