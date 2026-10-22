import { Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { z } from 'zod';
import { adminCreateSchema, adminUpdateSchema, blockUserSchema, paginationSchema } from '@masterio/shared';
import { AppException } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import { AdminRoles, CurrentUser, type AuthUser } from '../common/auth';
import { PII_CIPHER, PiiCipher } from '../common/crypto';
import { ApiZodBody, ZBody, ZQuery } from '../common/zod';
import type { AdminSubRole, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { AdminQueryService } from './admin-query.service';

const peopleQuery = paginationSchema.extend({
  q: z.string().trim().max(60).optional(),
  status: z.enum(['ACTIVE', 'WARNED', 'PREPAY_REQUIRED', 'SUSPENDED', 'BLOCKED']).optional(),
});
const workersQuery = peopleQuery.extend({
  kyc: z.enum(['NOT_VERIFIED', 'VERIFIED', 'REJECTED', 'EXPIRED']).optional(),
  online: z.enum(['true', 'false']).optional(),
  cityId: z.uuid().optional(),
});

const TOTP_ISSUER = 'Masterio CRM';

/** Люди в CRM: мастера, клиенты, блокировка; управление админами (только superadmin). */
@ApiTags('admin')
@ApiBearerAuth()
@AdminRoles('SUPPORT', 'MODERATOR', 'FINANCE')
@Controller('admin')
export class AdminPeopleController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly query: AdminQueryService,
    private readonly wallet: WalletService,
    private readonly audit: AuditService,
    @Inject(PII_CIPHER) private readonly pii: PiiCipher,
  ) {}

  // ── Мастера и клиенты ──
  @Get('workers')
  workers(@ZQuery(workersQuery) q: z.infer<typeof workersQuery>) {
    return this.query.workers({ ...q, online: q.online === undefined ? undefined : q.online === 'true' });
  }

  @Get('workers/:id')
  worker(@Param('id', ParseUUIDPipe) id: string) {
    return this.query.worker(id);
  }

  @Get('clients')
  clients(@ZQuery(peopleQuery) q: z.infer<typeof peopleQuery>) {
    return this.query.clients(q);
  }

  @Get('clients/:id')
  client(@Param('id', ParseUUIDPipe) id: string) {
    return this.query.client(id);
  }

  /** Блокировка за нарушение: доступ закрыт, сессии отозваны, приветственный кредит сгорает (раздел 20.2). */
  @Post('users/:id/block')
  @HttpCode(200)
  @AdminRoles('MODERATOR', 'SUPERADMIN')
  @ApiZodBody(blockUserSchema)
  async block(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ZBody(blockUserSchema) body: z.infer<typeof blockUserSchema>) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || user.role === 'ADMIN') throw new AppException('NOT_FOUND');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { status: 'BLOCKED' } });
      await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      if (user.role === 'WORKER') {
        await tx.workerProfile.update({ where: { userId: id }, data: { isOnline: false } });
        const currency = await this.wallet.workerCurrency(tx, id);
        await this.wallet.burnAllPromo(tx, id, currency, `blocked: ${body.reason}`);
      }
      await this.audit.log(
        { adminId: admin.id, action: 'user.block', entityType: 'User', entityId: id, before: { status: user.status }, after: { status: 'BLOCKED', reason: body.reason } },
        tx,
      );
    });
    return { id, status: 'BLOCKED' };
  }

  /** Снятие блокировки или ограничения. Сгоревший приветственный кредит не возвращается — при необходимости новое начисление. */
  @Post('users/:id/unblock')
  @HttpCode(200)
  @AdminRoles('MODERATOR', 'SUPERADMIN')
  @ApiZodBody(blockUserSchema)
  async unblock(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ZBody(blockUserSchema) body: z.infer<typeof blockUserSchema>) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || user.role === 'ADMIN' || user.status === 'DELETED') throw new AppException('NOT_FOUND');
    if (user.status === 'ACTIVE') return { id, status: 'ACTIVE' };
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { status: 'ACTIVE' } });
      await this.audit.log(
        { adminId: admin.id, action: 'user.unblock', entityType: 'User', entityId: id, before: { status: user.status }, after: { status: 'ACTIVE', reason: body.reason } },
        tx,
      );
    });
    return { id, status: 'ACTIVE' };
  }

  // ── Админы (роли и права) ──
  @Get('admins')
  @AdminRoles('SUPERADMIN')
  async admins() {
    const rows = await this.prisma.user.findMany({ where: { role: 'ADMIN' }, include: { admin: true }, orderBy: { createdAt: 'asc' } });
    return rows.map((u) => ({
      id: u.id,
      email: u.email,
      subRoles: u.admin?.subRoles ?? [],
      dailyGrantLimitCents: u.admin?.dailyGrantLimitCents ?? 0,
      status: u.status,
      createdAt: u.createdAt,
    }));
  }

  /** Новый админ. Секрет TOTP возвращается один раз — его нужно добавить в приложение-аутентификатор. */
  @Post('admins')
  @AdminRoles('SUPERADMIN')
  @ApiZodBody(adminCreateSchema)
  async createAdmin(@CurrentUser() admin: AuthUser, @ZBody(adminCreateSchema) body: z.infer<typeof adminCreateSchema>) {
    const email = body.email.toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) throw new AppException('ALREADY_EXISTS');
    const secret = authenticator.generateSecret();
    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          role: 'ADMIN',
          email,
          countryCode: body.countryCode,
          admin: {
            create: {
              subRoles: [...new Set(body.subRoles)] as AdminSubRole[],
              passwordHash: await bcrypt.hash(body.password, 12),
              totpSecretEnc: this.pii.encrypt(secret),
              dailyGrantLimitCents: body.dailyGrantLimitCents,
            },
          },
        },
      });
      await this.audit.log({ adminId: admin.id, action: 'admin.create', entityType: 'User', entityId: user.id, after: { email, subRoles: body.subRoles } }, tx);
      return user;
    });
    return { id: created.id, email, totpSecret: secret, totpUri: authenticator.keyuri(email, TOTP_ISSUER, secret) };
  }

  @Patch('admins/:id')
  @AdminRoles('SUPERADMIN')
  @ApiZodBody(adminUpdateSchema)
  async updateAdmin(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ZBody(adminUpdateSchema) body: z.infer<typeof adminUpdateSchema>) {
    const target = await this.prisma.user.findUnique({ where: { id }, include: { admin: true } });
    if (!target || target.role !== 'ADMIN' || !target.admin) throw new AppException('NOT_FOUND');
    const nextRoles = body.subRoles ? ([...new Set(body.subRoles)] as AdminSubRole[]) : target.admin.subRoles;
    const nextActive = body.active ?? target.status === 'ACTIVE';
    const losesSuper = target.admin.subRoles.includes('SUPERADMIN') && target.status === 'ACTIVE' && (!nextRoles.includes('SUPERADMIN') || !nextActive);
    if (losesSuper) {
      const others = await this.prisma.user.count({ where: { role: 'ADMIN', status: 'ACTIVE', id: { not: id }, admin: { subRoles: { has: 'SUPERADMIN' } } } });
      if (others === 0) throw new AppException('LAST_SUPERADMIN');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.adminProfile.update({
        where: { userId: id },
        data: { subRoles: nextRoles, ...(body.dailyGrantLimitCents !== undefined ? { dailyGrantLimitCents: body.dailyGrantLimitCents } : {}) },
      });
      await tx.user.update({ where: { id }, data: { status: nextActive ? 'ACTIVE' : 'BLOCKED' } });
      // права меняются сразу: старые токены с прежними ролями отзываются
      await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log(
        {
          adminId: admin.id,
          action: 'admin.update',
          entityType: 'User',
          entityId: id,
          before: { subRoles: target.admin?.subRoles ?? [], status: target.status, dailyGrantLimitCents: target.admin?.dailyGrantLimitCents ?? 0 } as Prisma.InputJsonValue,
          after: { subRoles: nextRoles, status: nextActive ? 'ACTIVE' : 'BLOCKED', dailyGrantLimitCents: body.dailyGrantLimitCents ?? target.admin?.dailyGrantLimitCents ?? 0 },
        },
        tx,
      );
    });
    return { id, subRoles: nextRoles, status: nextActive ? 'ACTIVE' : 'BLOCKED' };
  }

  /** Потерян телефон с аутентификатором: новый секрет TOTP, все сессии этого админа закрываются. */
  @Post('admins/:id/reset-totp')
  @HttpCode(200)
  @AdminRoles('SUPERADMIN')
  async resetTotp(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const target = await this.prisma.user.findUnique({ where: { id }, include: { admin: true } });
    if (!target || target.role !== 'ADMIN' || !target.admin || !target.email) throw new AppException('NOT_FOUND');
    const secret = authenticator.generateSecret();
    await this.prisma.$transaction(async (tx) => {
      await tx.adminProfile.update({ where: { userId: id }, data: { totpSecretEnc: this.pii.encrypt(secret) } });
      await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log({ adminId: admin.id, action: 'admin.reset_totp', entityType: 'User', entityId: id }, tx);
    });
    return { id, totpSecret: secret, totpUri: authenticator.keyuri(target.email, TOTP_ISSUER, secret) };
  }
}
