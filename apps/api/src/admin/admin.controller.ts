import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { adminCancelOrderSchema, grantSchema, paginationSchema, resetSettingSchema, resolveFraudFlagSchema, updateSettingSchema } from '@masterio/shared';
import { AppException } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import { AdminRoles, CurrentUser, isAdminWith, type AuthUser } from '../common/auth';
import { ApiZodBody, ZBody, ZodPipe, ZQuery } from '../common/zod';
import type { OrderStatus, Prisma } from '../generated/prisma/client';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { GrantsService } from '../wallet/grants.service';
import { LedgerService } from '../wallet/ledger.service';
import { WalletService } from '../wallet/wallet.service';
import { AdminQueryService } from './admin-query.service';

const ORDER_STATUSES = [
  'DRAFT',
  'SEARCHING',
  'NO_WORKERS',
  'ACCEPTED',
  'EN_ROUTE',
  'ARRIVED',
  'IN_PROGRESS',
  'COMPLETED_BY_WORKER',
  'CONFIRMED',
  'AUTO_CONFIRMED',
  'CANCELLED_BY_CLIENT',
  'CANCELLED_BY_WORKER',
  'CANCELLED_BY_ADMIN',
  'DISPUTED',
  'CLOSED',
] as const satisfies readonly OrderStatus[];

const ordersQuery = paginationSchema.extend({
  status: z.enum(ORDER_STATUSES).optional(),
  cityId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  workerId: z.uuid().optional(),
  clientId: z.uuid().optional(),
  number: z.coerce.number().int().positive().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});

const timeZoneSchema = z
  .string()
  .max(60)
  .default('UTC')
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'unknown time zone');

const kycSchema = z.object({ status: z.enum(['VERIFIED', 'REJECTED', 'NOT_VERIFIED']), reason: z.string().max(500).optional() });

@ApiTags('admin')
@ApiBearerAuth()
@AdminRoles('SUPPORT', 'MODERATOR', 'FINANCE')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly grants: GrantsService,
    private readonly ledger: LedgerService,
    private readonly wallet: WalletService,
    private readonly audit: AuditService,
    private readonly query: AdminQueryService,
    private readonly orders: OrdersService,
  ) {}

  /** Кто вошёл: подроли определяют разделы CRM. */
  @Get('me')
  async me(@CurrentUser() admin: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: admin.id }, include: { admin: true } });
    return { id: u.id, email: u.email, subRoles: admin.subRoles, countryCode: u.countryCode, dailyGrantLimitCents: u.admin?.dailyGrantLimitCents ?? 0 };
  }

  @Get('dashboard')
  dashboard(@CurrentUser() admin: AuthUser, @Query('tz', new ZodPipe(timeZoneSchema)) tz: string) {
    return this.query.dashboard(admin, tz);
  }

  // ── Настройки без релиза ──
  @Get('settings')
  listSettings() {
    return { effective: this.settings.listGlobal(), overrides: this.settings.listOverrides() };
  }

  @Put('settings/:key')
  @AdminRoles('FINANCE', 'SUPERADMIN')
  @ApiZodBody(updateSettingSchema)
  async setSetting(@CurrentUser() admin: AuthUser, @Param('key') key: string, @ZBody(updateSettingSchema) body: z.infer<typeof updateSettingSchema>) {
    this.assertCanEditSetting(admin, key);
    await this.settings.set(key, body.value, body.scope, body.scopeRef, admin.id, body.comment);
    await this.audit.log({
      adminId: admin.id,
      action: 'setting.update',
      entityType: 'Setting',
      entityId: `${key}|${body.scope}|${body.scopeRef}`,
      after: body.value as Prisma.InputJsonValue,
    });
    return { key, scope: body.scope, scopeRef: body.scopeRef, value: body.value };
  }

  /** Снять переопределение для города, страны или категории — начнёт действовать значение уровнем выше. */
  @Post('settings/:key/reset')
  @HttpCode(200)
  @AdminRoles('FINANCE', 'SUPERADMIN')
  @ApiZodBody(resetSettingSchema)
  async resetSetting(@CurrentUser() admin: AuthUser, @Param('key') key: string, @ZBody(resetSettingSchema) body: z.infer<typeof resetSettingSchema>) {
    this.assertCanEditSetting(admin, key);
    const changed = await this.settings.reset(key, body.scope, body.scopeRef, admin.id, body.comment);
    if (!changed) throw new AppException('NOT_FOUND');
    await this.audit.log({ adminId: admin.id, action: 'setting.reset', entityType: 'Setting', entityId: `${key}|${body.scope}|${body.scopeRef}` });
    return { key, scope: body.scope, scopeRef: body.scopeRef, value: null };
  }

  @Get('settings/:key/history')
  history(@Param('key') key: string) {
    return this.prisma.settingHistory.findMany({ where: { setting: { key } }, orderBy: { createdAt: 'desc' }, take: 100, include: { setting: true } });
  }

  /** Финансовые ключи меняет finance или superadmin, остальные — только superadmin. */
  private assertCanEditSetting(admin: AuthUser, key: string): void {
    const isSuper = admin.subRoles.includes('SUPERADMIN');
    if (!isSuper && !(this.settings.isFinanceKey(key) && admin.subRoles.includes('FINANCE'))) throw new AppException('FORBIDDEN');
  }

  // ── Стартовый баланс (приветственный кредит) ──
  @Post('grants')
  @AdminRoles('FINANCE', 'SUPERADMIN')
  @ApiZodBody(grantSchema)
  createGrant(@CurrentUser() admin: AuthUser, @ZBody(grantSchema) body: z.infer<typeof grantSchema>) {
    return this.grants.create(admin, body);
  }

  @Post('grants/:id/approve')
  @HttpCode(200)
  @AdminRoles('SUPERADMIN')
  approveGrant(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.grants.approve(admin, id);
  }

  @Post('grants/:id/reject')
  @HttpCode(200)
  @AdminRoles('SUPERADMIN')
  rejectGrant(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.grants.reject(admin, id);
  }

  @Get('grants')
  @AdminRoles('FINANCE', 'SUPERADMIN')
  async listGrants(
    @Query('status', new ZodPipe(z.enum(['PENDING_APPROVAL', 'APPROVED', 'REJECTED']).optional())) status?: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED',
    @Query('workerId', new ZodPipe(z.uuid().optional())) workerId?: string,
  ) {
    const grants = await this.prisma.walletGrant.findMany({
      where: { ...(status ? { status } : {}), ...(workerId ? { workerId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const ids = [...new Set(grants.flatMap((g) => [g.workerId, g.createdById, g.approvedById]).filter((x): x is string => x !== null))];
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true, phone: true, firstNameEnc: true, lastNameEnc: true } });
    const label = new Map(users.map((u) => [u.id, u.email ?? this.query.name(u) ?? u.phone ?? u.id]));
    const workerIds = [...new Set(grants.map((g) => g.workerId))];
    const currencies = new Map(await Promise.all(workerIds.map(async (w) => [w, await this.wallet.workerCurrency(this.prisma, w)] as const)));
    return grants.map((g) => ({
      ...g,
      currency: currencies.get(g.workerId) ?? null,
      workerLabel: label.get(g.workerId) ?? g.workerId,
      createdByLabel: label.get(g.createdById) ?? g.createdById,
      approvedByLabel: g.approvedById ? (label.get(g.approvedById) ?? g.approvedById) : null,
    }));
  }

  // ── Заказы ──
  @Get('orders')
  listOrders(@ZQuery(ordersQuery) q: z.infer<typeof ordersQuery>) {
    return this.query.orders(q);
  }

  /** Карточка заказа: таймлайн, журнал рассылки (кому, когда, итог), сметы, назначения, чат, трек, проводки. */
  @Get('orders/:id')
  order(@Param('id', ParseUUIDPipe) id: string) {
    return this.query.order(id);
  }

  @Post('orders/:id/cancel')
  @HttpCode(200)
  @AdminRoles('SUPPORT', 'SUPERADMIN')
  @ApiZodBody(adminCancelOrderSchema)
  cancelOrder(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ZBody(adminCancelOrderSchema) body: z.infer<typeof adminCancelOrderSchema>) {
    return this.orders.cancelByAdmin(admin.id, id, body.reason);
  }

  /** Живая карта: онлайн-мастера и активные заказы (дальше — дельты через сокет admin:map). */
  @Get('map/snapshot')
  map() {
    return this.query.mapSnapshot();
  }

  // ── Мастера: KYC и кошелёк ──
  @Post('workers/:id/kyc')
  @HttpCode(200)
  @AdminRoles('MODERATOR', 'SUPERADMIN')
  @ApiZodBody(kycSchema)
  async kyc(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ZBody(kycSchema) body: z.infer<typeof kycSchema>) {
    const before = await this.prisma.workerProfile.findUnique({ where: { userId: id } });
    if (!before) throw new AppException('NOT_FOUND');
    if (body.status === 'REJECTED' && !body.reason) throw new AppException('VALIDATION_FAILED', { reason: 'required when rejecting' });
    const updated = await this.prisma.workerProfile.update({ where: { userId: id }, data: { kycStatus: body.status } });
    await this.audit.log({
      adminId: admin.id,
      action: 'worker.kyc',
      entityType: 'WorkerProfile',
      entityId: id,
      before: { kycStatus: before.kycStatus },
      after: { kycStatus: body.status, reason: body.reason ?? null },
    });
    return { userId: id, kycStatus: updated.kycStatus };
  }

  @Get('workers/:id/wallet')
  @AdminRoles('FINANCE', 'SUPERADMIN')
  async workerWallet(@Param('id', ParseUUIDPipe) id: string) {
    const exists = await this.prisma.workerProfile.findUnique({ where: { userId: id }, select: { userId: true } });
    if (!exists) throw new AppException('NOT_FOUND');
    const currency = await this.wallet.workerCurrency(this.prisma, id);
    return this.wallet.pockets(this.prisma, id, currency);
  }

  // ── Финансы ──
  @Get('finance/ledger-integrity')
  @AdminRoles('FINANCE', 'SUPERADMIN')
  integrity(@CurrentUser() admin: AuthUser) {
    if (!isAdminWith(admin, 'FINANCE')) throw new AppException('FORBIDDEN');
    return this.prisma.$transaction((tx) => this.ledger.verifyIntegrity(tx));
  }

  @Get('audit-log')
  @AdminRoles('SUPERADMIN')
  async auditLog(
    @ZQuery(paginationSchema.extend({ adminId: z.uuid().optional(), entityType: z.string().max(60).optional(), entityId: z.string().max(200).optional() }))
    q: z.infer<typeof paginationSchema> & { adminId?: string; entityType?: string; entityId?: string },
  ) {
    const rows = await this.prisma.adminAuditLog.findMany({
      where: { ...(q.adminId ? { adminId: q.adminId } : {}), ...(q.entityType ? { entityType: q.entityType } : {}), ...(q.entityId ? { entityId: q.entityId } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
    });
    const admins = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.adminId))] } }, select: { id: true, email: true } });
    const email = new Map(admins.map((a) => [a.id, a.email]));
    return { items: rows.map((r) => ({ ...r, adminEmail: email.get(r.adminId) ?? null })), nextCursor: rows.length === q.limit ? (rows[rows.length - 1]?.id ?? null) : null };
  }

  // ── Подозрительные действия ──
  @Get('fraud-flags')
  @AdminRoles('MODERATOR', 'SUPERADMIN')
  fraudFlags(@Query('resolved', new ZodPipe(z.enum(['true', 'false']).default('false'))) resolved: 'true' | 'false') {
    return this.query.fraudFlags(resolved === 'true');
  }

  @Post('fraud-flags/:id/resolve')
  @HttpCode(200)
  @AdminRoles('MODERATOR', 'SUPERADMIN')
  @ApiZodBody(resolveFraudFlagSchema)
  async resolveFlag(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ZBody(resolveFraudFlagSchema) body: z.infer<typeof resolveFraudFlagSchema>) {
    const res = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.fraudFlag.updateMany({ where: { id, resolvedAt: null }, data: { resolvedAt: new Date(), resolvedById: admin.id } });
      if (updated.count === 0) throw new AppException('NOT_FOUND');
      await this.audit.log({ adminId: admin.id, action: 'fraud_flag.resolve', entityType: 'FraudFlag', entityId: id, after: { note: body.note } }, tx);
      return { id, resolved: true };
    });
    return res;
  }
}
