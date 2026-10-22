import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  CLIENT_DISPUTE_REASONS,
  DISPUTE_FINAL,
  RT_EVENTS,
  WORKER_DISPUTE_REASONS,
  distanceMeters,
  type AdminDisputeAction,
  type DisputeStatusName,
  type LatLng,
  type OpenDisputeInput,
} from '@masterio/shared';
import { AppException } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import { isAdminWith, type AuthUser } from '../common/auth';
import type { DisputeReason, Order, Prisma } from '../generated/prisma/client';
import { JobsService, jobId } from '../jobs/jobs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../storage/storage.service';
import { WalletService } from '../wallet/wallet.service';

/** Статусы заказа, после которых у сторон есть общая история (мастер принял заказ). */
const DISPUTABLE: Order['status'][] = [
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
];
/** Работа завершена — спор блокирует автоподтверждение и переводит заказ в «Спор». */
const FREEZES_ORDER: Order['status'][] = ['COMPLETED_BY_WORKER', 'CONFIRMED', 'AUTO_CONFIRMED'];

export interface SystemDisputeInput {
  order: Order;
  reason: DisputeReason;
  openedById: string;
  againstId: string | null;
  description: string;
  isAutomatic: boolean;
  isSuspicious?: boolean;
  /** доказательства, которые сторона приложила при открытии */
  photoKeys?: string[];
  extraEvidence?: Array<{ kind: string; content: Prisma.InputJsonValue }>;
}

/**
 * Единый процесс урегулирования споров (раздел 18.5): открытие любой стороной или системой, снимок материалов
 * заказа, объяснения второй стороны, работа поддержки (назначение, предложение, эскалация), итог или передача
 * вовне. Поддержка не выносит судебных решений и не обещает возмещений без законных оснований.
 */
@Injectable()
export class DisputesService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly jobs: JobsService,
    private readonly wallet: WalletService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.jobs.register('dispute-response-due', (d) => this.responseOverdue(d.disputeId ?? ''));
    this.jobs.register('dispute-escalate', (d) => this.autoEscalate(d.disputeId ?? ''));
  }

  // ───────────── Стороны ─────────────

  async open(user: AuthUser, orderId: string, input: OpenDisputeInput) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || (order.clientId !== user.id && order.workerId !== user.id)) throw new AppException('NOT_FOUND');
    const isClient = order.clientId === user.id;
    const allowed: readonly string[] = isClient ? CLIENT_DISPUTE_REASONS : WORKER_DISPUTE_REASONS;
    if (!allowed.includes(input.reason)) throw new AppException('VALIDATION_FAILED', { reason: 'not allowed for this side' });
    if (!order.workerId || !DISPUTABLE.includes(order.status)) throw new AppException('DISPUTE_NOT_ALLOWED', { reason: 'order_not_started' });
    const finishedAt = order.confirmedAt ?? order.cancelledAt ?? order.completedAt;
    const windowDays = this.settings.get('DISPUTE_OPEN_WINDOW_DAYS', { cityId: order.cityId, categoryId: order.categoryId });
    if (finishedAt && Date.now() - finishedAt.getTime() > windowDays * 86_400_000) {
      throw new AppException('DISPUTE_NOT_ALLOWED', { reason: 'window_passed', days: windowDays });
    }
    await this.assertOwnedFiles(input.photoKeys, user.id);
    const suspicious = (await this.prisma.fraudFlag.count({ where: { orderId, type: 'GPS_MISMATCH' } })) > 0;
    return this.openInternal({
      order,
      reason: input.reason as DisputeReason,
      openedById: user.id,
      againstId: isClient ? order.workerId : order.clientId,
      description: input.description,
      isAutomatic: false,
      isSuspicious: suspicious,
      photoKeys: input.photoKeys,
    });
  }

  /** «Клиент не вышел» (раздел 12): только после ожидания на месте, в геозоне адреса, с фото. */
  async reportNoShow(user: AuthUser, orderId: string, input: { location: LatLng; photoKey: string; comment?: string }) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order?.workerId) throw new AppException('NOT_FOUND');
    // сообщает тот, кто ждёт на адресе: назначенный участник команды или сам мастер; сторона спора — мастер/компания
    const current = await this.prisma.orderAssignment.findFirst({ where: { orderId, isCurrent: true }, select: { teamMember: { select: { userId: true } } } });
    if ((current?.teamMember.userId ?? order.workerId) !== user.id) throw new AppException('NOT_FOUND');
    if (order.status !== 'ARRIVED' || !order.arrivedAt) throw new AppException('INVALID_STATUS_TRANSITION');
    const ctx = { cityId: order.cityId, categoryId: order.categoryId };
    const waitMin = this.settings.get('NO_SHOW_WAIT_MINUTES', ctx);
    const waited = (Date.now() - order.arrivedAt.getTime()) / 60_000;
    if (waited < waitMin) throw new AppException('NO_SHOW_TOO_EARLY', { minutesLeft: Math.ceil(waitMin - waited) });
    const [loc] = await this.prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
      SELECT ST_Y("location"::geometry) AS lat, ST_X("location"::geometry) AS lng FROM "Order" WHERE "id" = ${orderId}::uuid`;
    const geofence = this.settings.get('ARRIVAL_GEOFENCE_M', ctx);
    const distanceM = loc ? distanceMeters(loc, input.location) : Number.POSITIVE_INFINITY;
    if (distanceM > geofence) throw new AppException('OUTSIDE_GEOFENCE', { distanceM: Math.round(distanceM), geofenceM: geofence });
    await this.assertOwnedFiles([input.photoKey], user.id);
    const res = await this.openInternal({
      order,
      reason: 'CLIENT_NO_SHOW',
      openedById: order.workerId,
      againstId: order.clientId,
      description: input.comment?.trim() || 'client did not show up',
      isAutomatic: false,
      photoKeys: [input.photoKey],
      extraEvidence: [{ kind: 'no_show', content: { location: input.location, distanceM: Math.round(distanceM), waitedMinutes: Math.floor(waited), arrivedAt: order.arrivedAt.toISOString(), reportedBy: user.id } }],
      freezeOrder: true,
    });
    await this.prisma.orderEvent.create({ data: { orderId, type: 'client_no_show', actorId: user.id, payload: { waitedMinutes: Math.floor(waited) } } });
    return res;
  }

  async respond(user: AuthUser, disputeId: string, input: { text: string; photoKeys: string[] }) {
    const d = await this.loadForParty(user, disputeId);
    if ((DISPUTE_FINAL as readonly string[]).includes(d.status)) throw new AppException('DISPUTE_CLOSED');
    await this.assertOwnedFiles(input.photoKeys, user.id);
    const retentionUntil = this.retention(d.order);
    const nextStatus: DisputeStatusName | null = d.status === 'AWAITING_RESPONSE' && user.id !== d.openedById ? 'UNDER_REVIEW' : null;
    await this.prisma.$transaction(async (tx) => {
      await tx.disputeEvidence.create({ data: { disputeId, submittedById: user.id, kind: 'text', content: { text: input.text }, retentionUntil } });
      for (const key of input.photoKeys) {
        await tx.disputeEvidence.create({ data: { disputeId, submittedById: user.id, kind: 'photo', fileKey: key, retentionUntil } });
      }
      await tx.disputeEvent.create({ data: { disputeId, actorId: user.id, type: 'response', payload: { text: input.text, photos: input.photoKeys.length } } });
      if (nextStatus) await tx.dispute.update({ where: { id: disputeId }, data: { status: nextStatus } });
    });
    const other = user.id === d.order.clientId ? d.order.workerId : d.order.clientId;
    if (other) await this.notifications.notify(other, { key: 'push.dispute_update', orderId: d.orderId, params: { number: d.order.number } });
    this.emit(d.id, d.order);
    return this.getForParty(user, disputeId);
  }

  async listMine(user: AuthUser) {
    const rows = await this.prisma.dispute.findMany({
      where: { order: { OR: [{ clientId: user.id }, { workerId: user.id }] } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { order: { select: { id: true, number: true, categoryId: true } } },
    });
    return rows.map((d) => ({ id: d.id, orderId: d.orderId, orderNumber: d.order.number, categoryId: d.order.categoryId, reason: d.reason, status: d.status, createdAt: d.createdAt, openedByMe: d.openedById === user.id }));
  }

  /** Спор глазами стороны: объяснения обеих сторон, их фото, предложения поддержки и итог. Внутренние заметки не видны. */
  async getForParty(user: AuthUser, disputeId: string) {
    const d = await this.loadForParty(user, disputeId);
    const evidence = await this.prisma.disputeEvidence.findMany({
      where: { disputeId, kind: { in: ['text', 'photo'] } },
      orderBy: { createdAt: 'asc' },
    });
    const events = await this.prisma.disputeEvent.findMany({
      where: { disputeId, type: { in: ['opened', 'response', 'proposal', 'request_response', 'escalated', 'settled', 'referred', 'response_overdue'] } },
      orderBy: { createdAt: 'asc' },
    });
    const side = (id: string | null) => (id === d.order.clientId ? 'client' : id === d.order.workerId ? 'worker' : 'support');
    return {
      id: d.id,
      orderId: d.orderId,
      orderNumber: d.order.number,
      reason: d.reason,
      status: d.status,
      description: d.description,
      openedBy: side(d.openedById),
      mine: d.openedById === user.id,
      isAutomatic: d.isAutomatic,
      responseDueAt: d.responseDueAt,
      createdAt: d.createdAt,
      closedAt: d.closedAt,
      outcome: d.outcome,
      photos: await Promise.all(
        evidence
          .filter((e) => e.kind === 'photo' && e.fileKey)
          .map(async (e) => ({ id: e.id, from: side(e.submittedById), url: this.storage.configured ? (await this.storage.viewUrl(e.fileKey ?? '')).url : null, createdAt: e.createdAt })),
      ),
      timeline: events.map((e) => ({
        id: e.id,
        type: e.type,
        from: side(e.actorId),
        text: e.type === 'response' || e.type === 'proposal' || e.type === 'request_response' ? (((e.payload ?? {}) as { text?: string; note?: string }).text ?? ((e.payload ?? {}) as { note?: string }).note ?? null) : null,
        createdAt: e.createdAt,
      })),
    };
  }

  // ───────────── Поддержка ─────────────

  async adminList(filter: { status?: DisputeStatusName; assigneeId?: string; mine?: string; adminId: string; limit: number; cursor?: string }) {
    const where: Prisma.DisputeWhereInput = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.mine === 'true' ? { assigneeId: filter.adminId } : filter.assigneeId ? { assigneeId: filter.assigneeId } : {}),
    };
    const rows = await this.prisma.dispute.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filter.limit,
      ...(filter.cursor ? { skip: 1, cursor: { id: filter.cursor } } : {}),
      include: { order: { select: { number: true, cityId: true, categoryId: true, currency: true } } },
    });
    const counts = await this.prisma.dispute.groupBy({ by: ['status'], _count: true });
    return {
      items: rows.map((d) => ({
        id: d.id,
        orderId: d.orderId,
        orderNumber: d.order.number,
        cityId: d.order.cityId,
        categoryId: d.order.categoryId,
        reason: d.reason,
        status: d.status,
        isAutomatic: d.isAutomatic,
        isSuspicious: d.isSuspicious,
        assigneeId: d.assigneeId,
        responseDueAt: d.responseDueAt,
        createdAt: d.createdAt,
        overdue: d.responseDueAt !== null && d.status === 'AWAITING_RESPONSE' && d.responseDueAt.getTime() < Date.now(),
      })),
      nextCursor: rows.length === filter.limit ? (rows[rows.length - 1]?.id ?? null) : null,
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
    };
  }

  /** Полная карточка для поддержки. Просмотр материалов (фото, снимки) пишется в журнал действий. */
  async adminGet(admin: AuthUser, disputeId: string) {
    const d = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: { order: true, evidence: { orderBy: { createdAt: 'asc' } }, events: { orderBy: { createdAt: 'asc' } }, ticket: { select: { id: true, status: true } } },
    });
    if (!d) throw new AppException('NOT_FOUND');
    await this.audit.log({ adminId: admin.id, action: 'dispute.view', entityType: 'Dispute', entityId: disputeId });
    const refunded = await this.wallet.refundedCommission(this.prisma, d.orderId);
    const charged = (d.order.commissionCents ?? 0) - (d.order.bonusDiscountCents ?? 0);
    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN', status: 'ACTIVE', admin: { subRoles: { hasSome: ['SUPPORT', 'MODERATOR', 'SUPERADMIN'] } } },
      select: { id: true, email: true },
    });
    return {
      id: d.id,
      reason: d.reason,
      status: d.status,
      description: d.description,
      isAutomatic: d.isAutomatic,
      isSuspicious: d.isSuspicious,
      openedById: d.openedById,
      againstId: d.againstId,
      assigneeId: d.assigneeId,
      responseDueAt: d.responseDueAt,
      createdAt: d.createdAt,
      closedAt: d.closedAt,
      outcome: d.outcome,
      ticket: d.ticket,
      order: {
        id: d.order.id,
        number: d.order.number,
        status: d.order.status,
        clientId: d.order.clientId,
        workerId: d.order.workerId,
        currency: d.order.currency,
        confirmedAmountCents: d.order.confirmedAmountCents,
        cashReportedByWorkerCents: d.order.cashReportedByWorkerCents,
        cashReportedByClientCents: d.order.cashReportedByClientCents,
        commissionChargedCents: charged,
        commissionRefundedCents: refunded,
      },
      evidence: await Promise.all(
        d.evidence.map(async (e) => ({
          id: e.id,
          kind: e.kind,
          submittedById: e.submittedById,
          content: e.content,
          url: e.fileKey && this.storage.configured ? (await this.storage.viewUrl(e.fileKey)).url : null,
          retentionUntil: e.retentionUntil,
          createdAt: e.createdAt,
        })),
      ),
      events: d.events,
      assignees: admins,
    };
  }

  async adminAction(admin: AuthUser, disputeId: string, body: AdminDisputeAction) {
    const d = await this.prisma.dispute.findUnique({ where: { id: disputeId }, include: { order: true } });
    if (!d) throw new AppException('NOT_FOUND');
    if ((DISPUTE_FINAL as readonly string[]).includes(d.status)) throw new AppException('DISPUTE_CLOSED');
    // finance участвует в споре только решением с возвратом комиссии
    if (!isAdminWith(admin, 'SUPPORT', 'MODERATOR') && !(body.action === 'settle' && (body.commissionRefundCents ?? 0) > 0)) throw new AppException('FORBIDDEN');
    const order = d.order;
    const parties = [order.clientId, order.workerId].filter((x): x is string => Boolean(x));
    const ctx = { cityId: order.cityId, categoryId: order.categoryId };

    switch (body.action) {
      case 'assign': {
        if (body.assigneeId) {
          const a = await this.prisma.user.findUnique({ where: { id: body.assigneeId }, select: { role: true } });
          if (a?.role !== 'ADMIN') throw new AppException('VALIDATION_FAILED', { assigneeId: 'not an admin' });
        }
        await this.prisma.$transaction(async (tx) => {
          await tx.dispute.update({ where: { id: disputeId }, data: { assigneeId: body.assigneeId } });
          await tx.disputeEvent.create({ data: { disputeId, actorId: admin.id, type: 'assigned', payload: { assigneeId: body.assigneeId } } });
          if (body.assigneeId) await tx.supportTicket.updateMany({ where: { disputeId }, data: { assigneeId: body.assigneeId } });
        });
        break;
      }
      case 'request_response': {
        const due = new Date(Date.now() + this.settings.get('DISPUTE_RESPONSE_HOURS', ctx) * 3_600_000);
        await this.prisma.$transaction(async (tx) => {
          await tx.dispute.update({ where: { id: disputeId }, data: { status: 'AWAITING_RESPONSE', responseDueAt: due } });
          await tx.disputeEvent.create({ data: { disputeId, actorId: admin.id, type: 'request_response', payload: { note: body.note } } });
        });
        await this.jobs.schedule('dispute-response-due', { disputeId }, { delayMs: due.getTime() - Date.now(), jobId: jobId('dispute-due', disputeId, String(due.getTime())) });
        for (const uid of parties) await this.notifications.notify(uid, { key: 'push.dispute_update', orderId: order.id, params: { number: order.number } });
        break;
      }
      case 'proposal': {
        await this.prisma.$transaction(async (tx) => {
          await tx.dispute.update({ where: { id: disputeId }, data: { status: 'UNDER_REVIEW' } });
          await tx.disputeEvent.create({ data: { disputeId, actorId: admin.id, type: 'proposal', payload: { text: body.text } } });
        });
        for (const uid of parties) await this.notifications.notify(uid, { key: 'push.dispute_proposal', orderId: order.id, params: { number: order.number } });
        break;
      }
      case 'escalate': {
        await this.prisma.$transaction(async (tx) => {
          await tx.dispute.update({ where: { id: disputeId }, data: { status: 'ESCALATED' } });
          await tx.disputeEvent.create({ data: { disputeId, actorId: admin.id, type: 'escalated', payload: { note: body.note } } });
        });
        break;
      }
      case 'note': {
        await this.prisma.disputeEvent.create({ data: { disputeId, actorId: admin.id, type: 'note', payload: { text: body.text } } });
        break;
      }
      case 'settle': {
        const refund = body.commissionRefundCents ?? 0;
        // деньги двигает только finance или superadmin
        if (refund > 0 && !isAdminWith(admin, 'FINANCE')) throw new AppException('FORBIDDEN', { reason: 'refund requires finance' });
        if (refund > 0 && !order.workerId) throw new AppException('VALIDATION_FAILED', { commissionRefundCents: 'no worker' });
        await this.prisma.$transaction(async (tx) => {
          const outcome = { resolution: body.resolution, summary: body.summary, agreedAmountCents: body.agreedAmountCents ?? null, commissionRefundCents: refund, decidedById: admin.id };
          const res = await tx.dispute.updateMany({
            where: { id: disputeId, status: { notIn: [...DISPUTE_FINAL] } },
            data: { status: 'SETTLED', outcome, closedAt: new Date() },
          });
          if (res.count === 0) throw new AppException('DISPUTE_CLOSED');
          if (refund > 0 && order.workerId) {
            await this.wallet.refundCommission(tx, { orderId: order.id, workerId: order.workerId, currency: order.currency, amountCents: refund, disputeId, actorId: admin.id });
          }
          await tx.disputeEvent.create({ data: { disputeId, actorId: admin.id, type: 'settled', payload: outcome } });
          await this.closeOrderIfLast(tx, order, disputeId);
          await tx.supportTicket.updateMany({ where: { disputeId }, data: { status: 'RESOLVED' } });
        });
        if (refund > 0 && order.workerId) await this.wallet.emitChanged(order.workerId, order.currency);
        for (const uid of parties) await this.notifications.notify(uid, { key: 'push.dispute_settled', orderId: order.id, params: { number: order.number } });
        break;
      }
      case 'refer': {
        await this.prisma.$transaction(async (tx) => {
          const outcome = { resolution: 'referred', summary: body.summary, decidedById: admin.id };
          await tx.dispute.update({ where: { id: disputeId }, data: { status: 'UNRESOLVED_REFERRED', outcome, closedAt: new Date() } });
          await tx.disputeEvent.create({ data: { disputeId, actorId: admin.id, type: 'referred', payload: outcome } });
          await this.closeOrderIfLast(tx, order, disputeId);
          await tx.supportTicket.updateMany({ where: { disputeId }, data: { status: 'CLOSED' } });
        });
        for (const uid of parties) await this.notifications.notify(uid, { key: 'push.dispute_referred', orderId: order.id, params: { number: order.number } });
        break;
      }
    }
    await this.audit.log({ adminId: admin.id, action: `dispute.${body.action}`, entityType: 'Dispute', entityId: disputeId, after: body as unknown as Prisma.InputJsonValue });
    this.emit(disputeId, order);
    return this.adminGet(admin, disputeId);
  }

  // ───────────── Общее ─────────────

  /** Используется и сторонами, и системой (расхождение наличных, «клиент не вышел»). */
  async openInternal(input: SystemDisputeInput & { freezeOrder?: boolean }, outerTx?: Tx) {
    const { order } = input;
    const run = async (tx: Tx) => {
      const existing = await tx.dispute.findFirst({ where: { orderId: order.id, status: { notIn: [...DISPUTE_FINAL] } } });
      if (existing && !input.isAutomatic) throw new AppException('DISPUTE_ALREADY_OPEN');
      if (existing) {
        // системный сигнал (расхождение наличных) при уже открытом споре — дополняем его, а не плодим второй
        await tx.disputeEvent.create({ data: { disputeId: existing.id, type: 'automatic_signal', payload: { reason: input.reason, description: input.description } } });
        if (FREEZES_ORDER.includes(order.status)) await tx.order.update({ where: { id: order.id }, data: { status: 'DISPUTED', version: { increment: 1 } } });
        return { dispute: existing, due: null, appended: true };
      }
      const ctx = { cityId: order.cityId, categoryId: order.categoryId };
      const due = new Date(Date.now() + this.settings.get('DISPUTE_RESPONSE_HOURS', ctx) * 3_600_000);
      const retentionUntil = this.retention(order);
      const dispute = await tx.dispute.create({
        data: {
          orderId: order.id,
          openedById: input.openedById,
          againstId: input.againstId,
          reason: input.reason,
          description: input.description,
          isAutomatic: input.isAutomatic,
          isSuspicious: input.isSuspicious ?? false,
          status: input.againstId ? 'AWAITING_RESPONSE' : 'UNDER_REVIEW',
          responseDueAt: input.againstId ? due : null,
        },
      });
      await tx.disputeEvent.create({ data: { disputeId: dispute.id, actorId: input.isAutomatic ? null : input.openedById, type: 'opened', payload: { reason: input.reason, automatic: input.isAutomatic } } });
      if (!input.isAutomatic) {
        await tx.disputeEvidence.create({ data: { disputeId: dispute.id, submittedById: input.openedById, kind: 'text', content: { text: input.description }, retentionUntil } });
      }
      for (const key of input.photoKeys ?? []) {
        await tx.disputeEvidence.create({ data: { disputeId: dispute.id, submittedById: input.openedById, kind: 'photo', fileKey: key, retentionUntil } });
      }
      for (const e of input.extraEvidence ?? []) {
        await tx.disputeEvidence.create({ data: { disputeId: dispute.id, submittedById: input.openedById, kind: e.kind, content: e.content, retentionUntil } });
      }
      await this.snapshot(tx, dispute.id, order, input.openedById, retentionUntil);
      await tx.supportTicket.create({
        data: { userId: input.openedById, orderId: order.id, disputeId: dispute.id, subject: `Dispute #${order.number}: ${input.reason}` },
      });
      // у заказа с открытым спором доказательства (трек) хранятся до решения
      if (input.freezeOrder || FREEZES_ORDER.includes(order.status)) {
        await tx.order.update({ where: { id: order.id }, data: { status: 'DISPUTED', version: { increment: 1 } } });
      }
      return { dispute, due, appended: false };
    };
    const { dispute, due, appended } = outerTx ? await run(outerTx) : await this.prisma.$transaction(run);
    if (input.freezeOrder || FREEZES_ORDER.includes(order.status)) {
      await this.jobs.cancel(jobId('autoconfirm', order.id));
      this.realtime.toUser(order.clientId, RT_EVENTS.orderStatus, { orderId: order.id, status: 'DISPUTED', at: new Date().toISOString() });
      if (order.workerId) this.realtime.toUser(order.workerId, RT_EVENTS.orderStatus, { orderId: order.id, status: 'DISPUTED', at: new Date().toISOString() });
    }
    if (appended) {
      this.emit(dispute.id, order);
      return { id: dispute.id, status: dispute.status, responseDueAt: dispute.responseDueAt };
    }
    if (input.againstId && due) {
      await this.jobs.schedule('dispute-response-due', { disputeId: dispute.id }, { delayMs: due.getTime() - Date.now(), jobId: jobId('dispute-due', dispute.id, String(due.getTime())) });
    }
    const escalateH = this.settings.get('DISPUTE_ESCALATE_HOURS', { cityId: order.cityId, categoryId: order.categoryId });
    await this.jobs.schedule('dispute-escalate', { disputeId: dispute.id }, { delayMs: escalateH * 3_600_000, jobId: jobId('dispute-escalate', dispute.id) });
    for (const uid of [order.clientId, order.workerId].filter((x): x is string => Boolean(x))) {
      await this.notifications.notify(uid, { key: 'push.dispute_opened', orderId: order.id, params: { number: order.number } });
    }
    this.emit(dispute.id, order);
    return { id: dispute.id, status: dispute.status, responseDueAt: dispute.responseDueAt };
  }

  /** Снимок материалов заказа на момент открытия: чат, сметы, хронология, трек исполнителя (раздел 18.5, п. 2). */
  private async snapshot(tx: Tx, disputeId: string, order: Order, actorId: string, retentionUntil: Date): Promise<void> {
    const [messages, estimates, events, cancellation] = await Promise.all([
      tx.chatMessage.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' }, select: { senderId: true, body: true, filtered: true, createdAt: true } }),
      tx.estimate.findMany({ where: { orderId: order.id }, include: { items: true }, orderBy: { version: 'asc' } }),
      tx.orderEvent.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' }, select: { type: true, actorId: true, payload: true, createdAt: true } }),
      tx.cancellation.findUnique({ where: { orderId: order.id } }),
    ]);
    const track = await tx.$queryRaw<Array<{ lat: number; lng: number; recordedAt: Date; userId: string }>>`
      SELECT ST_Y("point"::geometry) AS lat, ST_X("point"::geometry) AS lng, "recordedAt", "userId"
      FROM "LocationPoint" WHERE "orderId" = ${order.id}::uuid ORDER BY "recordedAt" ASC LIMIT 2000`;
    const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x: unknown) => (typeof x === 'bigint' ? Number(x) : x))) as Prisma.InputJsonValue;
    const rows: Array<{ kind: string; content: Prisma.InputJsonValue }> = [
      { kind: 'chat_export', content: json(messages) },
      { kind: 'estimate_snapshot', content: json(estimates) },
      { kind: 'timeline_snapshot', content: json({ events, cancellation }) },
      {
        kind: 'gps_snapshot',
        content: json({
          points: track.length,
          first: track[0] ?? null,
          last: track[track.length - 1] ?? null,
          sample: track.filter((_p, i) => i % Math.max(1, Math.ceil(track.length / 200)) === 0),
        }),
      },
      {
        kind: 'order_snapshot',
        content: json({
          status: order.status,
          confirmedAmountCents: order.confirmedAmountCents,
          cashReportedByWorkerCents: order.cashReportedByWorkerCents,
          cashReportedByClientCents: order.cashReportedByClientCents,
          acceptedAt: order.acceptedAt,
          arrivedAt: order.arrivedAt,
          completedAt: order.completedAt,
        }),
      },
    ];
    for (const r of rows) await tx.disputeEvidence.create({ data: { disputeId, submittedById: actorId, kind: r.kind, content: r.content, retentionUntil } });
  }

  private async closeOrderIfLast(tx: Tx, order: Order, disputeId: string): Promise<void> {
    const others = await tx.dispute.count({ where: { orderId: order.id, id: { not: disputeId }, status: { notIn: [...DISPUTE_FINAL] } } });
    if (others === 0) await tx.order.updateMany({ where: { id: order.id, status: 'DISPUTED' }, data: { status: 'CLOSED', version: { increment: 1 } } });
  }

  private async responseOverdue(disputeId: string): Promise<void> {
    const d = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!d || d.status !== 'AWAITING_RESPONSE' || !d.responseDueAt || d.responseDueAt.getTime() > Date.now() + 1_000) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.dispute.update({ where: { id: disputeId }, data: { status: 'UNDER_REVIEW' } });
      await tx.disputeEvent.create({ data: { disputeId, type: 'response_overdue' } });
    });
  }

  private async autoEscalate(disputeId: string): Promise<void> {
    const d = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!d || (DISPUTE_FINAL as readonly string[]).includes(d.status) || d.status === 'ESCALATED') return;
    await this.prisma.$transaction(async (tx) => {
      await tx.dispute.update({ where: { id: disputeId }, data: { status: 'ESCALATED' } });
      await tx.disputeEvent.create({ data: { disputeId, type: 'escalated', payload: { automatic: true } } });
    });
    this.realtime.toAdmins(RT_EVENTS.disputeUpdated, { disputeId, status: 'ESCALATED' });
  }

  private async loadForParty(user: AuthUser, disputeId: string) {
    const d = await this.prisma.dispute.findUnique({ where: { id: disputeId }, include: { order: true } });
    if (!d || (d.order.clientId !== user.id && d.order.workerId !== user.id)) throw new AppException('NOT_FOUND');
    return d;
  }

  private async assertOwnedFiles(keys: string[], ownerId: string): Promise<void> {
    for (const key of keys) {
      if (!this.storage.isOwnedKey(key, 'dispute_evidence', ownerId)) throw new AppException('VALIDATION_FAILED', { photoKeys: 'unknown file' });
      if (!(await this.storage.exists(key))) throw new AppException('VALIDATION_FAILED', { photoKeys: 'file not uploaded' });
    }
  }

  private retention(order: Order): Date {
    const days = this.settings.get('EVIDENCE_RETENTION_DAYS', { cityId: order.cityId, categoryId: order.categoryId });
    return new Date(Date.now() + days * 86_400_000);
  }

  private emit(disputeId: string, order: Order): void {
    const payload = { disputeId, orderId: order.id };
    this.realtime.toUser(order.clientId, RT_EVENTS.disputeUpdated, payload);
    if (order.workerId) this.realtime.toUser(order.workerId, RT_EVENTS.disputeUpdated, payload);
    this.realtime.toAdmins(RT_EVENTS.disputeUpdated, payload);
  }
}
