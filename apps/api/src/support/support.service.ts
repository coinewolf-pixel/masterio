import { Injectable } from '@nestjs/common';
import { RT_EVENTS, type LatLng } from '@masterio/shared';
import { AppException } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import type { AuthUser } from '../common/auth';
import { geoPoint } from '../common/geo';
import type { IncidentType, Prisma, TicketStatus } from '../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../storage/storage.service';

/**
 * Поддержка и инциденты. Тикет создаёт пользователь, спор или инцидент; переписка видна пользователю,
 * внутренние заметки — только поддержке. При несчастном случае приложение сначала показывает экстренный номер
 * страны (раздел 19.4), затем эта форма сохраняет материалы. Masterio не обещает страховых выплат.
 */
@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  // ───────────── Пользователь ─────────────

  async createTicket(user: AuthUser, input: { subject: string; body: string; orderId?: string }) {
    if (input.orderId) {
      const order = await this.prisma.order.findUnique({ where: { id: input.orderId }, select: { clientId: true, workerId: true } });
      if (!order || (order.clientId !== user.id && order.workerId !== user.id)) throw new AppException('NOT_FOUND');
    }
    const ticket = await this.prisma.$transaction(async (tx) => {
      const t = await tx.supportTicket.create({ data: { userId: user.id, orderId: input.orderId ?? null, subject: input.subject } });
      await tx.ticketMessage.create({ data: { ticketId: t.id, senderId: user.id, body: input.body } });
      return t;
    });
    this.realtime.toAdmins(RT_EVENTS.ticketMessage, { ticketId: ticket.id });
    return this.getMine(user, ticket.id);
  }

  async listMine(user: AuthUser) {
    const rows = await this.prisma.supportTicket.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      include: { messages: { where: { isInternal: false }, orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    return rows.map((t) => ({
      id: t.id,
      subject: t.subject,
      status: t.status,
      orderId: t.orderId,
      disputeId: t.disputeId,
      updatedAt: t.updatedAt,
      lastMessage: t.messages[0] ? { body: t.messages[0].body, fromSupport: t.messages[0].senderId !== user.id, createdAt: t.messages[0].createdAt } : null,
    }));
  }

  async getMine(user: AuthUser, ticketId: string) {
    const t = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: { messages: { where: { isInternal: false }, orderBy: { createdAt: 'asc' } } },
    });
    if (!t || t.userId !== user.id) throw new AppException('NOT_FOUND');
    return {
      id: t.id,
      subject: t.subject,
      status: t.status,
      orderId: t.orderId,
      disputeId: t.disputeId,
      createdAt: t.createdAt,
      messages: t.messages.map((m) => ({ id: m.id, body: m.body, fromSupport: m.senderId !== user.id, createdAt: m.createdAt })),
    };
  }

  async postMine(user: AuthUser, ticketId: string, body: string) {
    const t = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!t || t.userId !== user.id) throw new AppException('NOT_FOUND');
    if (t.status === 'CLOSED') throw new AppException('INVALID_STATUS_TRANSITION');
    await this.prisma.$transaction(async (tx) => {
      await tx.ticketMessage.create({ data: { ticketId, senderId: user.id, body } });
      // ответ пользователя возвращает тикет в работу
      await tx.supportTicket.update({ where: { id: ticketId }, data: { status: 'OPEN' } });
    });
    this.realtime.toAdmins(RT_EVENTS.ticketMessage, { ticketId });
    return this.getMine(user, ticketId);
  }

  async reportIncident(
    user: AuthUser,
    orderId: string,
    input: { type: IncidentType; description: string; emergencyCalled: boolean; location?: LatLng; photoKeys: string[] },
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { city: true } });
    if (!order) throw new AppException('NOT_FOUND');
    // на месте может работать участник команды — он тоже сообщает о происшествии (раздел 19.4: «для обеих сторон»)
    const performer = order.clientId !== user.id && order.workerId !== user.id
      ? await this.prisma.orderAssignment.count({ where: { orderId, teamMember: { userId: user.id }, state: { in: ['ACTIVE', 'ENDED'] } } })
      : 0;
    if (order.clientId !== user.id && order.workerId !== user.id && performer === 0) throw new AppException('NOT_FOUND');
    for (const key of input.photoKeys) {
      if (!this.storage.isOwnedKey(key, 'incident', user.id)) throw new AppException('VALIDATION_FAILED', { photoKeys: 'unknown file' });
      if (!(await this.storage.exists(key))) throw new AppException('VALIDATION_FAILED', { photoKeys: 'file not uploaded' });
    }
    const incident = await this.prisma.$transaction(async (tx) => {
      const ticket = await tx.supportTicket.create({ data: { userId: user.id, orderId, subject: `Incident #${order.number}: ${input.type}` } });
      await tx.ticketMessage.create({ data: { ticketId: ticket.id, senderId: user.id, body: input.description } });
      const created = await tx.incidentReport.create({
        data: { orderId, reporterId: user.id, type: input.type, description: input.description, emergencyCalled: input.emergencyCalled, fileKeys: input.photoKeys, ticketId: ticket.id },
      });
      if (input.location) await tx.$executeRaw`UPDATE "IncidentReport" SET "location" = ${geoPoint(input.location)} WHERE "id" = ${created.id}::uuid`;
      await tx.orderEvent.create({ data: { orderId, type: 'incident_reported', actorId: user.id, payload: { incidentId: created.id, type: input.type, emergencyCalled: input.emergencyCalled } } });
      return { ...created, ticketId: ticket.id };
    });
    this.realtime.toAdmins(RT_EVENTS.ticketMessage, { ticketId: incident.ticketId, incidentId: incident.id });
    // о происшествии с участником команды сразу узнаёт руководитель — он отвечает за привлечённых помощников
    if (performer > 0 && order.workerId) {
      await this.notifications.notify(order.workerId, { key: 'push.team_incident', orderId, params: { number: order.number }, priority: 'high' });
    }
    return { id: incident.id, ticketId: incident.ticketId, emergencyNumber: order.city.emergencyNumber };
  }

  // ───────────── Поддержка ─────────────

  async adminList(f: { status?: TicketStatus; kind?: 'dispute' | 'incident' | 'general'; mine?: string; adminId: string; limit: number; cursor?: string }) {
    const where: Prisma.SupportTicketWhereInput = {
      ...(f.status ? { status: f.status } : {}),
      ...(f.mine === 'true' ? { assigneeId: f.adminId } : {}),
      ...(f.kind === 'dispute' ? { disputeId: { not: null } } : {}),
      ...(f.kind === 'incident' ? { subject: { startsWith: 'Incident #' } } : {}),
      ...(f.kind === 'general' ? { disputeId: null, NOT: { subject: { startsWith: 'Incident #' } } } : {}),
    };
    const rows = await this.prisma.supportTicket.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: f.limit,
      ...(f.cursor ? { skip: 1, cursor: { id: f.cursor } } : {}),
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, role: true, phone: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    return {
      items: rows.map((t) => ({
        id: t.id,
        subject: t.subject,
        status: t.status,
        userId: t.userId,
        userRole: byId.get(t.userId)?.role ?? null,
        userPhone: byId.get(t.userId)?.phone ?? null,
        orderId: t.orderId,
        disputeId: t.disputeId,
        assigneeId: t.assigneeId,
        updatedAt: t.updatedAt,
        waitingSupport: t.messages[0] ? t.messages[0].senderId === t.userId : false,
      })),
      nextCursor: rows.length === f.limit ? (rows[rows.length - 1]?.id ?? null) : null,
    };
  }

  async adminGet(ticketId: string) {
    const t = await this.prisma.supportTicket.findUnique({ where: { id: ticketId }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
    if (!t) throw new AppException('NOT_FOUND');
    const user = await this.prisma.user.findUnique({ where: { id: t.userId }, select: { id: true, role: true, phone: true, locale: true } });
    const incident = await this.prisma.incidentReport.findUnique({ where: { ticketId } });
    const senders = await this.prisma.user.findMany({ where: { id: { in: [...new Set(t.messages.map((m) => m.senderId))] } }, select: { id: true, email: true, role: true } });
    const sender = new Map(senders.map((s) => [s.id, s]));
    return {
      ...t,
      user,
      incidentId: incident?.id ?? null,
      messages: t.messages.map((m) => ({
        id: m.id,
        body: m.body,
        isInternal: m.isInternal,
        fromSupport: m.senderId !== t.userId,
        senderEmail: sender.get(m.senderId)?.email ?? null,
        createdAt: m.createdAt,
      })),
    };
  }

  async adminPost(admin: AuthUser, ticketId: string, body: string, internal: boolean) {
    const t = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!t) throw new AppException('NOT_FOUND');
    await this.prisma.$transaction(async (tx) => {
      await tx.ticketMessage.create({ data: { ticketId, senderId: admin.id, body, isInternal: internal } });
      if (!internal) await tx.supportTicket.update({ where: { id: ticketId }, data: { status: 'PENDING_USER', assigneeId: t.assigneeId ?? admin.id } });
    });
    if (!internal) {
      await this.notifications.notify(t.userId, { key: 'push.support_reply', data: { ticketId }, ...(t.orderId ? { orderId: t.orderId } : {}) });
      this.realtime.toUser(t.userId, RT_EVENTS.ticketMessage, { ticketId });
    }
    return this.adminGet(ticketId);
  }

  async adminUpdate(admin: AuthUser, ticketId: string, patch: { status?: TicketStatus; assigneeId?: string | null }) {
    const t = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!t) throw new AppException('NOT_FOUND');
    await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { ...(patch.status ? { status: patch.status } : {}), ...(patch.assigneeId !== undefined ? { assigneeId: patch.assigneeId } : {}) },
    });
    await this.audit.log({ adminId: admin.id, action: 'ticket.update', entityType: 'SupportTicket', entityId: ticketId, before: { status: t.status, assigneeId: t.assigneeId }, after: patch as Prisma.InputJsonValue });
    return this.adminGet(ticketId);
  }

  async adminIncidents(limit: number, cursor?: string) {
    const rows = await this.prisma.incidentReport.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      include: { order: { select: { number: true, cityId: true, categoryId: true, clientId: true, workerId: true } } },
    });
    return {
      items: rows.map((i) => ({
        id: i.id,
        orderId: i.orderId,
        orderNumber: i.order.number,
        cityId: i.order.cityId,
        type: i.type,
        reporterRole: i.reporterId === i.order.clientId ? 'client' : 'worker',
        emergencyCalled: i.emergencyCalled,
        photos: i.fileKeys.length,
        ticketId: i.ticketId,
        createdAt: i.createdAt,
      })),
      nextCursor: rows.length === limit ? (rows[rows.length - 1]?.id ?? null) : null,
    };
  }

  /** Карточка инцидента с фото; просмотр пишется в журнал (материалы о здоровье и ущербе — чувствительные данные). */
  async adminIncident(admin: AuthUser, id: string) {
    const i = await this.prisma.incidentReport.findUnique({ where: { id }, include: { order: { select: { number: true, clientId: true, workerId: true } } } });
    if (!i) throw new AppException('NOT_FOUND');
    const [loc] = await this.prisma.$queryRaw<Array<{ lat: number | null; lng: number | null }>>`
      SELECT ST_Y("location"::geometry) AS lat, ST_X("location"::geometry) AS lng FROM "IncidentReport" WHERE "id" = ${id}::uuid`;
    await this.audit.log({ adminId: admin.id, action: 'incident.view', entityType: 'IncidentReport', entityId: id });
    return {
      ...i,
      location: loc && loc.lat !== null && loc.lng !== null ? { lat: loc.lat, lng: loc.lng } : null,
      reporterRole: i.reporterId === i.order.clientId ? 'client' : 'worker',
      photos: this.storage.configured ? await Promise.all(i.fileKeys.map(async (k) => (await this.storage.viewUrl(k)).url)) : [],
    };
  }
}
