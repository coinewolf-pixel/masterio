import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  ACTIVE_ORDER_STATUSES,
  clientCancelFee,
  commissionFor,
  distanceMeters,
  formatMoney,
  percentToBp,
  RT_EVENTS,
  WORKER_STATUS_TRANSITIONS,
  type CancellableStatus,
  type CreateOrderInput,
  type LatLng,
  type OrderStatusPayload,
} from '@masterio/shared';
import { AppException } from '../common/app-exception';
import { DisputesService } from '../disputes/disputes.service';
import { AuditService } from '../common/audit.service';
import { isAdminWith, type AuthUser } from '../common/auth';
import { PII_CIPHER, PiiCipher } from '../common/crypto';
import { geoPoint } from '../common/geo';
import { DispatchService } from '../dispatch/dispatch.service';
import type { Order, OrderStatus, Prisma } from '../generated/prisma/client';
import { JobsService, jobId } from '../jobs/jobs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { TeamsService } from '../teams/teams.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SettingsService } from '../settings/settings.service';
import { WalletService } from '../wallet/wallet.service';
import { StorageService } from '../storage/storage.service';

const JOB_AUTO_CONFIRM = 'auto-confirm';
const FINAL_STATUSES: OrderStatus[] = ['CONFIRMED', 'AUTO_CONFIRMED', 'CANCELLED_BY_CLIENT', 'CANCELLED_BY_WORKER', 'CANCELLED_BY_ADMIN', 'CLOSED'];

@Injectable()
export class OrdersService implements OnModuleInit {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatch: DispatchService,
    private readonly settings: SettingsService,
    private readonly wallet: WalletService,
    private readonly jobs: JobsService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
    @Inject(PII_CIPHER) private readonly pii: PiiCipher,
    private readonly audit: AuditService,
    private readonly disputes: DisputesService,
    private readonly teams: TeamsService,
  ) {}

  onModuleInit(): void {
    this.jobs.register(JOB_AUTO_CONFIRM, async (data) => this.autoConfirm(data.orderId ?? ''));
  }

  // ───────────── Создание и просмотр ─────────────

  async create(clientId: string, input: CreateOrderInput): Promise<Order> {
    const cc = await this.prisma.cityCategory.findUnique({
      where: { cityId_categoryId: { cityId: input.cityId, categoryId: input.categoryId } },
      include: { city: true, category: true },
    });
    if (!cc || !cc.isActive || !cc.city.isActive || !cc.category.isActive) throw new AppException('CITY_OR_CATEGORY_UNAVAILABLE');
    const ctx = { countryCode: cc.city.countryCode, cityId: input.cityId, categoryId: input.categoryId };
    const client = await this.prisma.user.findUniqueOrThrow({ where: { id: clientId }, include: { paymentMethods: true } });

    if (input.paymentMethod === 'CARD' && !this.settings.get('CARD_PAYMENTS_ENABLED', ctx)) throw new AppException('FEATURE_DISABLED');
    if (input.paymentMethod === 'CASH') {
      if (!this.settings.get('CASH_ENABLED', ctx)) throw new AppException('FEATURE_DISABLED');
      const cardRequired = this.settings.get('CLIENT_CARD_REQUIRED_FOR_CASH', ctx) || client.status === 'PREPAY_REQUIRED';
      if (cardRequired && client.paymentMethods.length === 0) throw new AppException('CARD_REQUIRED');
    }
    // фото проблемы — только свои файлы, загруженные через /uploads
    if (input.photoKeys.some((k) => !this.storage.isOwnedKey(k, 'order_photo', clientId))) {
      throw new AppException('FORBIDDEN', { reason: 'foreign_file' });
    }
    if (input.timing === 'SCHEDULED' && input.scheduledAt && new Date(input.scheduledAt).getTime() < Date.now()) {
      throw new AppException('VALIDATION_FAILED', { scheduledAt: 'must be in the future' });
    }

    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          clientId,
          categoryId: input.categoryId,
          cityId: input.cityId,
          description: input.description,
          addressFormatted: input.address.formatted,
          addressDetails: input.address.details ?? null,
          timing: input.timing,
          scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
          paymentMethod: input.paymentMethod,
          currency: cc.city.currency,
          searchRadiusM: this.settings.get('SEARCH_RADIUS_M', ctx),
        },
      });
      await tx.$executeRaw`UPDATE "Order" SET "location" = ${geoPoint(input.address.location)} WHERE "id" = ${created.id}::uuid`;
      if (input.photoKeys.length > 0) {
        await tx.orderPhoto.createMany({
          data: input.photoKeys.map((fileKey) => ({ orderId: created.id, uploaderId: clientId, fileKey, purpose: 'problem' })),
        });
      }
      await tx.orderEvent.create({ data: { orderId: created.id, type: 'created', actorId: clientId } });
      return created;
    });

    await this.dispatch.start(order.id);
    return this.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  }

  async list(user: AuthUser, limit = 30, cursor?: string) {
    const where: Prisma.OrderWhereInput =
      user.role === 'CLIENT'
        ? { clientId: user.id }
        : user.role === 'WORKER'
          ? { OR: [{ workerId: user.id }, { assignments: { some: { teamMember: { userId: user.id }, state: { in: ['ACTIVE', 'ENDED'] } } } }] }
          : {};
    return this.prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      include: { category: { select: { code: true, names: true } } },
    });
  }

  /** Карточка заказа с защитой от IDOR: только клиент, исполнитель или админ. */
  async get(user: AuthUser, orderId: string) {
    const order = await this.loadForUser(user, orderId);
    const [geo] = await this.prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
      SELECT ST_Y("location"::geometry) AS lat, ST_X("location"::geometry) AS lng FROM "Order" WHERE "id" = ${orderId}::uuid`;
    const estimates = await this.prisma.estimate.findMany({ where: { orderId }, include: { items: true }, orderBy: { version: 'desc' } });
    // фото проблемы и работы — ссылки на 5 минут из закрытого хранилища
    const photoRows = await this.prisma.orderPhoto.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
    const photos = this.storage.configured
      ? await Promise.all(photoRows.map(async (p) => ({ id: p.id, purpose: p.purpose, url: (await this.storage.viewUrl(p.fileKey)).url })))
      : [];
    const isClient = order.clientId === user.id;
    const showContacts = order.workerId !== null && (ACTIVE_ORDER_STATUSES as readonly string[]).includes(order.status);
    const performer = order.workerId ? await this.performerCard(order.id, order.workerId) : null;
    const reviewedByMe = (await this.prisma.review.count({ where: { orderId, authorId: user.id } })) > 0;
    const lastDispute = await this.prisma.dispute.findFirst({ where: { orderId }, orderBy: { createdAt: 'desc' }, select: { id: true, status: true, reason: true } });
    const active = (ACTIVE_ORDER_STATUSES as readonly string[]).includes(order.status);
    const isOwner = order.workerId === user.id;
    return {
      viewer: isClient ? ('client' as const) : isOwner ? ('owner' as const) : user.role === 'WORKER' ? ('performer' as const) : ('admin' as const),
      // руководитель команды: кто исполнитель, ждёт ли замена согласия, нужно ли назначить
      team: isOwner ? await this.teams.orderTeamInfo(order) : null,
      // клиент: замена исполнителя, ожидающая его согласия (экран 19)
      pendingPerformerChange: isClient && active ? await this.teams.pendingChangeForClient(order.id) : null,
      ...order,
      location: geo ?? null,
      estimates,
      photos,
      performer,
      reviewedByMe,
      dispute: lastDispute,
      // Телефоны скрыты до принятия заказа (раздел 12)
      contacts: showContacts
        ? isClient
          ? { workerPhone: performer?.phone ?? null }
          : { clientPhone: (await this.prisma.user.findUniqueOrThrow({ where: { id: order.clientId } })).phone }
        : null,
    };
  }

  // ───────────── Отмена ─────────────

  async cancelPreview(clientId: string, orderId: string, reason: string) {
    const order = await this.loadOwned(clientId, orderId);
    return this.computeClientFee(order, reason);
  }

  async cancelByClient(clientId: string, orderId: string, reason: string, comment?: string) {
    const order = await this.loadOwned(clientId, orderId);
    const fee = this.computeClientFee(order, reason);
    const statusAtCancel = order.status;
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.order.updateMany({
        where: { id: orderId, status: order.status, version: order.version },
        data: { status: 'CANCELLED_BY_CLIENT', cancelledAt: new Date(), version: { increment: 1 } },
      });
      if (res.count === 0) throw new AppException('ORDER_NOT_CANCELLABLE');
      await tx.cancellation.create({
        data: {
          orderId,
          actor: 'CLIENT',
          actorId: clientId,
          reasonCode: reason,
          comment: comment ?? null,
          statusAtCancel,
          penaltyCents: fee.penaltyCents,
          compensationCents: fee.compensationCents,
          createsReview: fee.createsReview,
        },
      });
      await tx.orderEvent.create({ data: { orderId, type: 'cancelled_by_client', actorId: clientId, payload: { reason, ...fee } } });
      if (fee.createsReview) {
        await tx.fraudFlag.create({
          data: {
            type: reason === 'off_platform_payment' || reason === 'worker_asked_to_cancel' ? 'OFF_PLATFORM_ATTEMPT' : 'HIGH_CANCEL_RATE',
            userId: order.workerId,
            orderId,
            details: { source: 'client_cancel_reason', reason },
          },
        });
      }
    });
    await this.dispatch.cancelOffers(orderId);
    if (statusAtCancel !== 'SEARCHING' && statusAtCancel !== 'NO_WORKERS' && statusAtCancel !== 'DRAFT' && !fee.createsReview) {
      await this.applyClientCancelCounters(clientId, order);
    }
    this.afterFinal(order, 'CANCELLED_BY_CLIENT');
    if (order.workerId) {
      await this.notifications.notify(order.workerId, { key: 'push.order_cancelled', orderId, params: { number: order.number }, priority: 'high' });
    }
    return { status: 'CANCELLED_BY_CLIENT', ...fee };
  }

  /** Отмена мастером после принятия: заказ возвращается в поиск, мастеру — учёт отмены (раздел 12). */
  async cancelByWorker(workerId: string, orderId: string, reason: string, comment?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.workerId !== workerId) throw new AppException('NOT_FOUND');
    if (!['ACCEPTED', 'EN_ROUTE', 'ARRIVED'].includes(order.status)) throw new AppException('ORDER_NOT_CANCELLABLE');
    // участник команды, который уже едет на заказ, узнаёт об отмене сразу
    const performer = await this.prisma.orderAssignment.findFirst({ where: { orderId, isCurrent: true, NOT: { teamMember: { userId: workerId } } }, select: { teamMember: { select: { userId: true } } } });
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.order.updateMany({
        where: { id: orderId, status: order.status, version: order.version },
        data: { status: 'NO_WORKERS', workerId: null, acceptedAt: null, enRouteAt: null, arrivedAt: null, version: { increment: 1 } },
      });
      if (res.count === 0) throw new AppException('ORDER_NOT_CANCELLABLE');
      await this.endAssignments(tx, orderId);
      await tx.orderEvent.create({
        data: { orderId, type: 'worker_cancelled', actorId: workerId, payload: { reason, comment: comment ?? null, statusAtCancel: order.status } },
      });
    });
    await this.applyWorkerCancelCounters(workerId);
    if (performer) {
      this.realtime.toUser(performer.teamMember.userId, RT_EVENTS.orderAssignment, { orderId, kind: 'cancelled', at: new Date().toISOString() });
      await this.notifications.notify(performer.teamMember.userId, { key: 'push.team_unassigned', orderId, params: { number: order.number } });
    }
    this.realtime.closeOrderRoom(orderId);
    await this.notifications.notify(order.clientId, { key: 'push.order_cancelled', orderId, params: { number: order.number } });
    await this.dispatch.start(orderId);
    return { status: 'CANCELLED_BY_WORKER' };
  }

  // ───────────── Статусы исполнителя ─────────────

  async updateStatus(userId: string, orderId: string, status: 'EN_ROUTE' | 'ARRIVED' | 'IN_PROGRESS', location: LatLng) {
    const order = await this.loadForPerformer(userId, orderId);
    const allowed = WORKER_STATUS_TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(status)) throw new AppException('INVALID_STATUS_TRANSITION');
    const ctx = await this.ctx(order);
    const orderLoc = await this.orderLocation(orderId);

    if (status === 'ARRIVED') {
      const geofence = this.settings.get('ARRIVAL_GEOFENCE_M', ctx);
      const distance = distanceMeters(location, orderLoc);
      if (distance > geofence) throw new AppException('OUTSIDE_GEOFENCE', { distanceM: distance, geofenceM: geofence });
      await this.checkGpsConsistency(order, userId, geofence);
    }

    const field = status === 'EN_ROUTE' ? 'enRouteAt' : status === 'ARRIVED' ? 'arrivedAt' : 'startedAt';
    const res = await this.prisma.order.updateMany({
      where: { id: orderId, status: order.status, version: order.version },
      data: { status, [field]: new Date(), version: { increment: 1 } },
    });
    if (res.count === 0) throw new AppException('INVALID_STATUS_TRANSITION');
    await this.prisma.$executeRaw`
      INSERT INTO "OrderEvent" ("id", "orderId", "type", "actorId", "payload", "location", "createdAt")
      VALUES (gen_random_uuid(), ${orderId}::uuid, ${`status_${status.toLowerCase()}`}, ${userId}::uuid,
              ${JSON.stringify({ distanceM: distanceMeters(location, orderLoc) })}::jsonb, ${geoPoint(location)}, now())`;

    this.emitStatus(order, status);
    const name = await this.performerName(order.id, userId);
    if (status === 'EN_ROUTE') await this.notifications.notify(order.clientId, { key: 'push.worker_en_route', orderId, params: { name }, priority: 'high' });
    if (status === 'ARRIVED') await this.notifications.notify(order.clientId, { key: 'push.worker_arrived', orderId, params: { name }, priority: 'high' });
    return { status };
  }

  // ───────────── Смета ─────────────

  async proposeEstimate(
    userId: string,
    orderId: string,
    input: { note?: string; items: Array<{ type: 'LABOR' | 'MATERIAL' | 'TRAVEL' | 'OTHER'; title: string; quantity: number; unitCents: number; photoKeys: string[] }> },
  ) {
    const order = await this.loadForPerformer(userId, orderId);
    if (!['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'].includes(order.status)) throw new AppException('ESTIMATE_LOCKED');
    const items = input.items.map((i) => ({ ...i, totalCents: i.quantity * i.unitCents }));
    const total = items.reduce((s, i) => s + i.totalCents, 0);
    if (!Number.isSafeInteger(total)) throw new AppException('VALIDATION_FAILED');
    if (order.paymentMethod === 'CASH') await this.assertCashLimit(order, total);

    const estimate = await this.prisma.$transaction(async (tx) => {
      const last = await tx.estimate.findFirst({ where: { orderId }, orderBy: { version: 'desc' } });
      await tx.estimate.updateMany({ where: { orderId, status: 'PROPOSED' }, data: { status: 'SUPERSEDED' } });
      const created = await tx.estimate.create({
        data: {
          orderId,
          version: (last?.version ?? 0) + 1,
          totalCents: total,
          note: input.note ?? null,
          createdById: userId,
          items: { create: items },
        },
        include: { items: true },
      });
      await tx.orderEvent.create({ data: { orderId, type: 'estimate_proposed', actorId: userId, payload: { version: created.version, totalCents: total } } });
      return created;
    });
    this.realtime.toUser(order.clientId, RT_EVENTS.orderEstimate, { orderId, version: estimate.version, totalCents: total });
    const client = await this.prisma.user.findUniqueOrThrow({ where: { id: order.clientId } });
    await this.notifications.notify(order.clientId, {
      key: 'push.estimate_new',
      orderId,
      params: { amount: formatMoney(total, order.currency, client.locale) },
      priority: 'high',
    });
    return estimate;
  }

  /** Клиент подтверждает или отклоняет смету. Изменение суммы после начала работ — только так. */
  async decideEstimate(clientId: string, orderId: string, version: number, approve: boolean) {
    const order = await this.loadOwned(clientId, orderId);
    if (!['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'].includes(order.status)) throw new AppException('ESTIMATE_LOCKED');
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.estimate.updateMany({
        where: { orderId, version, status: 'PROPOSED' },
        data: { status: approve ? 'APPROVED' : 'REJECTED', decidedAt: new Date() },
      });
      if (res.count === 0) throw new AppException('ESTIMATE_LOCKED');
      if (approve) {
        const est = await tx.estimate.findUniqueOrThrow({ where: { orderId_version: { orderId, version } } });
        await tx.estimate.updateMany({ where: { orderId, status: 'APPROVED', NOT: { version } }, data: { status: 'SUPERSEDED' } });
        await tx.order.update({ where: { id: orderId }, data: { confirmedAmountCents: est.totalCents } });
      }
      await tx.orderEvent.create({ data: { orderId, type: approve ? 'estimate_approved' : 'estimate_rejected', actorId: clientId, payload: { version } } });
    });
    if (order.workerId) this.realtime.toUser(order.workerId, RT_EVENTS.orderEstimate, { orderId, version, decision: approve ? 'APPROVED' : 'REJECTED' });
    return { version, status: approve ? 'APPROVED' : 'REJECTED' };
  }

  // ───────────── Завершение и оплата наличными ─────────────

  /**
   * «Завершил, получил наличными X»: комиссия считается от подтверждённой сметы (не от слов мастера)
   * и сразу списывается с баланса мастера в порядке бонус → промо → пополнение → (заработок) → долг.
   */
  async complete(userId: string, orderId: string, cashReceivedCents: number, location: LatLng) {
    const order = await this.loadForPerformer(userId, orderId);
    if (order.status !== 'IN_PROGRESS') throw new AppException('INVALID_STATUS_TRANSITION');
    if (order.paymentMethod !== 'CASH') throw new AppException('FEATURE_DISABLED');
    if (order.confirmedAmountCents === null) throw new AppException('NO_APPROVED_ESTIMATE');
    const workerId = order.workerId as string;
    const ctx = await this.ctx(order);
    const commissionBp = percentToBp(this.settings.get('COMMISSION_PERCENT', ctx));
    const commissionCents = commissionFor(order.confirmedAmountCents, commissionBp);

    const plan = await this.prisma.$transaction(async (tx) => {
      const res = await tx.order.updateMany({
        where: { id: orderId, status: 'IN_PROGRESS', version: order.version },
        data: {
          status: 'COMPLETED_BY_WORKER',
          completedAt: new Date(),
          cashReportedByWorkerCents: cashReceivedCents,
          commissionPercentBp: commissionBp,
          commissionCents,
          version: { increment: 1 },
        },
      });
      if (res.count === 0) throw new AppException('INVALID_STATUS_TRANSITION');
      const charged = await this.wallet.chargeCommission(tx, { orderId, workerId, currency: order.currency, commissionCents, ctx });
      await tx.order.update({ where: { id: orderId }, data: { bonusDiscountCents: charged.fromBonus } });
      await tx.orderEvent.create({
        data: {
          orderId,
          type: 'completed_by_worker',
          actorId: userId,
          payload: { cashReceivedCents, confirmedAmountCents: order.confirmedAmountCents, commissionCents, location, plan: { ...charged } },
        },
      });
      return charged;
    });

    await this.jobs.schedule(JOB_AUTO_CONFIRM, { orderId }, {
      delayMs: this.settings.get('AUTO_CONFIRM_HOURS', ctx) * 3_600_000,
      jobId: jobId('autoconfirm', orderId),
    });
    this.emitStatus(order, 'COMPLETED_BY_WORKER');
    this.realtime.closeOrderRoom(orderId);
    const [client, worker] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: order.clientId } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: workerId } }),
    ]);
    await this.notifications.notify(order.clientId, {
      key: 'push.payment_confirm_request',
      orderId,
      params: { amount: formatMoney(cashReceivedCents, order.currency, client.locale) },
      priority: 'high',
    });
    const fmt = (c: number) => formatMoney(c, order.currency, worker.locale);
    const charged = plan.commissionCents - plan.fromBonus;
    await this.notifications.notify(workerId, {
      key: 'push.commission_charged',
      orderId,
      params: { commission: fmt(plan.commissionCents), discount: fmt(plan.fromBonus), charged: fmt(charged) },
    });
    await this.wallet.emitChanged(workerId, order.currency);
    return {
      status: 'COMPLETED_BY_WORKER',
      commission: { commissionCents: plan.commissionCents, bonusDiscountCents: plan.fromBonus, chargedCents: charged, toDebtCents: plan.toDebt },
    };
  }

  /** Клиент подтверждает «Оплатил наличными X». Расхождение сумм автоматически открывает спор. */
  async confirmPayment(clientId: string, orderId: string, cashPaidCents: number) {
    const order = await this.loadOwned(clientId, orderId);
    if (order.status !== 'COMPLETED_BY_WORKER') throw new AppException('INVALID_STATUS_TRANSITION');
    const matches = order.cashReportedByWorkerCents === cashPaidCents;
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.order.updateMany({
        where: { id: orderId, status: 'COMPLETED_BY_WORKER', version: order.version },
        data: {
          status: matches ? 'CONFIRMED' : 'DISPUTED',
          cashReportedByClientCents: cashPaidCents,
          confirmedAt: matches ? new Date() : null,
          version: { increment: 1 },
        },
      });
      if (res.count === 0) throw new AppException('INVALID_STATUS_TRANSITION');
      if (!matches) {
        await this.disputes.openInternal(
          {
            order,
            reason: 'CASH_AMOUNT_MISMATCH',
            openedById: clientId,
            againstId: order.workerId,
            description: `worker reported ${order.cashReportedByWorkerCents}, client reported ${cashPaidCents}`,
            isAutomatic: true,
          },
          tx,
        );
      }
      await tx.orderEvent.create({
        data: { orderId, type: matches ? 'payment_confirmed' : 'cash_mismatch_dispute', actorId: clientId, payload: { cashPaidCents } },
      });
    });
    await this.jobs.cancel(jobId('autoconfirm', orderId));
    this.emitStatus(order, matches ? 'CONFIRMED' : 'DISPUTED');
    // при расхождении уведомления о споре отправил DisputesService
    if (matches) await this.notifications.notify(order.clientId, { key: 'push.order_completed', orderId, params: { number: order.number } });
    return { status: matches ? 'CONFIRMED' : 'DISPUTED' };
  }

  async autoConfirm(orderId: string): Promise<void> {
    if (!orderId) return;
    const res = await this.prisma.order.updateMany({
      where: { id: orderId, status: 'COMPLETED_BY_WORKER' },
      data: { status: 'AUTO_CONFIRMED', confirmedAt: new Date(), clientUnconfirmed: true, version: { increment: 1 } },
    });
    if (res.count === 0) return;
    await this.prisma.orderEvent.create({ data: { orderId, type: 'auto_confirmed' } });
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    this.emitStatus(order, 'AUTO_CONFIRMED');
  }

  // ───────────── Отзывы, повтор поиска ─────────────

  async review(user: AuthUser, orderId: string, rating: number, text?: string) {
    const order = await this.loadForUser(user, orderId);
    if (!['CONFIRMED', 'AUTO_CONFIRMED', 'CLOSED'].includes(order.status) || !order.workerId) throw new AppException('REVIEW_NOT_ALLOWED');
    const isClient = user.id === order.clientId;
    if (!isClient && user.id !== order.workerId) throw new AppException('REVIEW_NOT_ALLOWED');
    const targetId = isClient ? order.workerId : order.clientId;
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.review.create({ data: { orderId, authorId: user.id, targetId, rating, text: text ?? null } });
        if (isClient) await this.recomputeRating(tx, targetId);
      });
    } catch (error) {
      if (String(error).includes('Unique') || String(error).includes('P2002')) throw new AppException('REVIEW_NOT_ALLOWED', { reason: 'already_reviewed' });
      throw error;
    }
    return { ok: true };
  }

  /** «Расширить радиус» или «подождать» после «Мастеров сейчас нет». */
  async restartSearch(clientId: string, orderId: string, radiusM?: number) {
    const order = await this.loadOwned(clientId, orderId);
    if (order.status !== 'NO_WORKERS' && order.status !== 'SEARCHING') throw new AppException('INVALID_STATUS_TRANSITION');
    const ctx = await this.ctx(order);
    const max = this.settings.get('MAX_SEARCH_RADIUS_M', ctx);
    if (radiusM !== undefined) {
      if (radiusM > max) throw new AppException('VALIDATION_FAILED', { radiusM: `max ${max}` });
      await this.prisma.order.update({ where: { id: orderId }, data: { searchRadiusM: Math.max(radiusM, order.searchRadiusM) } });
    }
    if (order.status === 'SEARCHING') {
      await this.dispatch.offerNext(orderId);
    } else {
      await this.dispatch.start(orderId);
    }
    return this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  }

  // ───────────── Вспомогательное ─────────────

  private computeClientFee(order: Order, reason: string) {
    if (!['DRAFT', 'SEARCHING', 'NO_WORKERS', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED'].includes(order.status)) {
      throw new AppException('ORDER_NOT_CANCELLABLE');
    }
    const ctxSync = { cityId: order.cityId, categoryId: order.categoryId };
    const minutesSinceAccept = order.acceptedAt ? (Date.now() - order.acceptedAt.getTime()) / 60_000 : 0;
    return clientCancelFee({
      status: order.status as CancellableStatus,
      minutesSinceAccept,
      reason,
      freeMinutes: this.settings.get('FREE_CANCEL_MINUTES', ctxSync),
      penalties: this.settings.get('CLIENT_CANCEL_PENALTY', ctxSync),
      travelCompensationCents: this.settings.get('TRAVEL_COMPENSATION', ctxSync),
    });
  }

  /** Счётчик отмен клиента за 30 дней: предупреждение → обязательная предоплата → временная блокировка. */
  private async applyClientCancelCounters(clientId: string, order: Order): Promise<void> {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const count = await this.prisma.cancellation.count({
      where: { actor: 'CLIENT', actorId: clientId, createdAt: { gte: since }, createsReview: false, statusAtCancel: { in: ['ACCEPTED', 'EN_ROUTE', 'ARRIVED'] } },
    });
    const t = this.settings.get('CLIENT_CANCEL_THRESHOLDS', { cityId: order.cityId });
    const status = count >= t.block ? 'SUSPENDED' : count >= t.prepay ? 'PREPAY_REQUIRED' : count >= t.warn ? 'WARNED' : null;
    await this.prisma.clientProfile.update({ where: { userId: clientId }, data: { cancelCount30d: count } });
    if (status) await this.prisma.user.updateMany({ where: { id: clientId, status: { in: ['ACTIVE', 'WARNED', 'PREPAY_REQUIRED'] } }, data: { status } });
  }

  private async applyWorkerCancelCounters(workerId: string): Promise<void> {
    const since30 = new Date(Date.now() - 30 * 86_400_000);
    const since90 = new Date(Date.now() - 90 * 86_400_000);
    const [cancels30, cancels90, accepted90] = await Promise.all([
      this.prisma.orderEvent.count({ where: { type: 'worker_cancelled', actorId: workerId, createdAt: { gte: since30 } } }),
      this.prisma.orderEvent.count({ where: { type: 'worker_cancelled', actorId: workerId, createdAt: { gte: since90 } } }),
      this.prisma.offer.count({ where: { workerId, status: 'ACCEPTED', sentAt: { gte: since90 } } }),
    ]);
    const t = this.settings.get('WORKER_CANCEL_THRESHOLDS');
    await this.prisma.workerProfile.update({
      where: { userId: workerId },
      data: { cancelCount30d: cancels30, cancelRate: accepted90 > 0 ? Math.min(1, cancels90 / accepted90).toFixed(4) : '0' },
    });
    const status = cancels30 >= t.block ? 'SUSPENDED' : cancels30 >= t.warn ? 'WARNED' : null;
    if (status) await this.prisma.user.updateMany({ where: { id: workerId, status: { in: ['ACTIVE', 'WARNED'] } }, data: { status } });
    if (cancels30 >= t.warn) {
      await this.prisma.fraudFlag.create({ data: { type: 'HIGH_CANCEL_RATE', userId: workerId, details: { cancels30 } } });
    }
  }

  /** «Прибыл», но по треку исполнитель был далеко → подозрительно, пометка для дашборда и спора. */
  private async checkGpsConsistency(order: Order, userId: string, geofence: number): Promise<void> {
    const [last] = await this.prisma.$queryRaw<Array<{ distance: number }>>`
      SELECT ST_Distance(lp."point", o."location")::int AS distance
      FROM "LocationPoint" lp JOIN "Order" o ON o."id" = lp."orderId"
      WHERE lp."orderId" = ${order.id}::uuid AND lp."userId" = ${userId}::uuid AND lp."recordedAt" > now() - interval '3 minutes'
      ORDER BY lp."recordedAt" DESC LIMIT 1`;
    if (last && last.distance > geofence * 3) {
      await this.prisma.fraudFlag.create({
        data: { type: 'GPS_MISMATCH', userId, orderId: order.id, details: { trackDistanceM: last.distance, geofenceM: geofence } },
      });
      await this.prisma.orderEvent.create({ data: { orderId: order.id, type: 'gps_mismatch', actorId: userId, payload: { trackDistanceM: last.distance } } });
    }
  }

  /**
   * Отмена поддержкой (раздел 14): без штрафов и компенсаций, с причиной в журнале действий.
   * После «Завершил» заказ отменить нельзя — комиссия уже списана, такие случаи решаются спором.
   */
  async cancelByAdmin(adminId: string, orderId: string, reason: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new AppException('NOT_FOUND');
    if (!['DRAFT', 'SEARCHING', 'NO_WORKERS', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'].includes(order.status)) {
      throw new AppException('ORDER_NOT_CANCELLABLE');
    }
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.order.updateMany({
        where: { id: orderId, status: order.status, version: order.version },
        data: { status: 'CANCELLED_BY_ADMIN', cancelledAt: new Date(), version: { increment: 1 } },
      });
      if (res.count === 0) throw new AppException('ORDER_NOT_CANCELLABLE');
      await this.endAssignments(tx, orderId);
      await tx.cancellation.create({
        data: { orderId, actor: 'ADMIN', actorId: adminId, reasonCode: 'admin', comment: reason, statusAtCancel: order.status },
      });
      await tx.orderEvent.create({ data: { orderId, type: 'cancelled_by_admin', actorId: adminId, payload: { reason } } });
      await this.audit.log(
        { adminId, action: 'order.cancel', entityType: 'Order', entityId: orderId, before: { status: order.status }, after: { status: 'CANCELLED_BY_ADMIN', reason } },
        tx,
      );
    });
    await this.dispatch.cancelOffers(orderId);
    this.afterFinal(order, 'CANCELLED_BY_ADMIN');
    await this.notifications.notify(order.clientId, { key: 'push.order_cancelled', orderId, params: { number: order.number } });
    if (order.workerId) {
      await this.notifications.notify(order.workerId, { key: 'push.order_cancelled', orderId, params: { number: order.number }, priority: 'high' });
    }
    return { status: 'CANCELLED_BY_ADMIN' };
  }

  private async assertCashLimit(order: Order, totalCents: number): Promise<void> {
    const ctx = await this.ctx(order);
    const completed = await this.prisma.order.count({ where: { workerId: order.workerId, status: { in: ['CONFIRMED', 'AUTO_CONFIRMED', 'CLOSED'] } } });
    const limit = completed < 5 ? this.settings.get('CASH_MAX_ORDER_AMOUNT_NEW_WORKER', ctx) : this.settings.get('CASH_MAX_ORDER_AMOUNT', ctx);
    if (totalCents > limit) throw new AppException('CASH_LIMIT_EXCEEDED', { limitCents: limit });
  }

  private async recomputeRating(tx: Tx, workerId: string): Promise<void> {
    const agg = await tx.review.aggregate({ where: { targetId: workerId, isHidden: false }, _avg: { rating: true }, _count: true });
    await tx.workerProfile.update({
      where: { userId: workerId },
      data: { ratingAvg: (agg._avg.rating ?? 0).toFixed(2), ratingCount: agg._count },
    });
  }

  private afterFinal(order: Order, status: OrderStatus): void {
    this.emitStatus(order, status);
    this.realtime.closeOrderRoom(order.id);
  }

  private emitStatus(order: Pick<Order, 'id' | 'clientId' | 'workerId'>, status: string): void {
    const payload: OrderStatusPayload = { orderId: order.id, status, at: new Date().toISOString() };
    this.realtime.toUser(order.clientId, RT_EVENTS.orderStatus, payload);
    if (order.workerId) this.realtime.toUser(order.workerId, RT_EVENTS.orderStatus, payload);
    this.realtime.toOrder(order.id, RT_EVENTS.orderStatus, payload);
    this.realtime.toAdmins(RT_EVENTS.orderStatus, payload);
  }

  private async ctx(order: Pick<Order, 'cityId' | 'categoryId'>) {
    const city = await this.prisma.city.findUniqueOrThrow({ where: { id: order.cityId }, select: { countryCode: true } });
    return { countryCode: city.countryCode, cityId: order.cityId, categoryId: order.categoryId };
  }

  async orderLocation(orderId: string): Promise<LatLng> {
    const [geo] = await this.prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
      SELECT ST_Y("location"::geometry) AS lat, ST_X("location"::geometry) AS lng FROM "Order" WHERE "id" = ${orderId}::uuid`;
    if (!geo) throw new AppException('NOT_FOUND');
    return geo;
  }

  private async loadOwned(clientId: string, orderId: string): Promise<Order> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.clientId !== clientId) throw new AppException('NOT_FOUND');
    return order;
  }

  /** Заказ снят с исполнителя: текущее назначение завершается, ожидающая замена отзывается. */
  private async endAssignments(tx: Tx, orderId: string): Promise<void> {
    await tx.orderAssignment.updateMany({ where: { orderId, state: 'PENDING_CONSENT' }, data: { state: 'CANCELLED', endedAt: new Date() } });
    await tx.orderAssignment.updateMany({ where: { orderId, isCurrent: true }, data: { isCurrent: false, state: 'ENDED', endedAt: new Date() } });
  }

  private async loadForUser(user: AuthUser, orderId: string): Promise<Order> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new AppException('NOT_FOUND');
    if (isAdminWith(user, 'SUPPORT', 'MODERATOR', 'FINANCE')) return order;
    if (order.clientId === user.id || order.workerId === user.id) return order;
    // участник видит заказы, где он был или есть исполнитель, и заказ, куда его предлагают на замену
    const assigned = await this.prisma.orderAssignment.findFirst({ where: { orderId, teamMember: { userId: user.id }, state: { in: ['ACTIVE', 'ENDED', 'PENDING_CONSENT'] } } });
    if (assigned) return order;
    throw new AppException('NOT_FOUND');
  }

  /** Исполнитель — мастер/компания по заказу или назначенный участник команды. */
  private async loadForPerformer(userId: string, orderId: string): Promise<Order> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || FINAL_STATUSES.includes(order.status)) throw new AppException('NOT_FOUND');
    if (order.workerId === userId) {
      const current = await this.prisma.orderAssignment.findFirst({ where: { orderId, isCurrent: true }, include: { teamMember: true } });
      // если назначен участник команды, статусы подтверждает он, а не руководитель
      if (current && current.teamMember.userId !== userId) throw new AppException('FORBIDDEN', { reason: 'assigned_to_team_member' });
      return order;
    }
    const assigned = await this.prisma.orderAssignment.findFirst({ where: { orderId, isCurrent: true, teamMember: { userId } } });
    if (assigned) return order;
    throw new AppException('NOT_FOUND');
  }

  private async performerName(orderId: string, fallbackUserId: string): Promise<string> {
    const card = await this.performerCard(orderId, fallbackUserId);
    return card.name ?? 'Masterio Pro';
  }

  /** Кто фактически приедет: имя, фото, роль, значки — без документов (раздел 19.3). */
  async performerCard(orderId: string, workerId: string) {
    const assignment = await this.prisma.orderAssignment.findFirst({
      where: { orderId, isCurrent: true },
      include: { teamMember: { include: { user: true } } },
    });
    const user = assignment ? assignment.teamMember.user : await this.prisma.user.findUniqueOrThrow({ where: { id: workerId } });
    const profile = await this.prisma.workerProfile.findUnique({ where: { userId: workerId } });
    const licensed = await this.prisma.document.count({
      where: { ownerId: user.id, kind: 'LICENSE', status: 'VERIFIED', OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }] },
    });
    const insured = await this.prisma.insurancePolicy.count({
      where: { document: { ownerId: user.id, status: 'VERIFIED' }, validUntil: { gt: new Date() } },
    });
    return {
      userId: user.id,
      name: this.pii.decrypt(user.firstNameEnc),
      photoKey: user.photoKey,
      role: assignment ? assignment.teamMember.role : 'MASTER',
      ratingAvg: profile ? Number(profile.ratingAvg) : null,
      badges: { licenseVerified: licensed > 0, insured: insured > 0 },
      phone: user.phone,
    };
  }
}
