import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DISPUTE_FINAL } from '@masterio/shared';
import { AppException } from '../common/app-exception';
import type { AuthUser } from '../common/auth';
import { PII_CIPHER, PiiCipher } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { TeamsService } from '../teams/teams.service';
import { WalletService } from '../wallet/wallet.service';

const BUSY: string[] = ['SEARCHING', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED_BY_WORKER'];
const EXPORT_LINK_DAYS = 7;

/**
 * Права пользователя на свои данные (GDPR, раздел 19.6): выгрузка в машиночитаемом виде и удаление аккаунта.
 * Удаление обезличивает профиль, закрывает сессии и стирает файлы, но сохраняет то, что платформа обязана хранить:
 * журнал проводок (бухгалтерия), материалы споров и инцидентов до конца срока хранения, факты согласий.
 * Что именно сохранено и почему — записывается в запросе и показывается пользователю.
 */
@Injectable()
export class PrivacyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly wallet: WalletService,
    @Inject(PII_CIPHER) private readonly pii: PiiCipher,
    private readonly teams: TeamsService,
  ) {}

  async export(auth: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: auth.id },
      include: { client: true, worker: { include: { categories: true, cities: true } }, addresses: true, devices: { select: { platform: true, appVersion: true, lastSeenAt: true } } },
    });
    const orders = await this.prisma.order.findMany({
      where: { OR: [{ clientId: u.id }, { workerId: u.id }] },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, number: true, status: true, description: true, addressFormatted: true, addressDetails: true, paymentMethod: true, currency: true,
        confirmedAmountCents: true, commissionCents: true, createdAt: true, completedAt: true, cancelledAt: true, clientId: true, workerId: true,
      },
    });
    const [messages, reviewsWritten, consents, documents, disputes, tickets, notifications] = await Promise.all([
      this.prisma.chatMessage.findMany({ where: { senderId: u.id }, select: { orderId: true, body: true, createdAt: true }, orderBy: { createdAt: 'asc' } }),
      this.prisma.review.findMany({ where: { authorId: u.id }, select: { orderId: true, rating: true, text: true, createdAt: true } }),
      this.prisma.userConsent.findMany({ where: { userId: u.id }, include: { version: { include: { document: true } } } }),
      this.prisma.document.findMany({ where: { ownerId: u.id }, select: { kind: true, status: true, validUntil: true, createdAt: true, rejectReason: true } }),
      this.prisma.dispute.findMany({ where: { OR: [{ openedById: u.id }, { againstId: u.id }] }, select: { orderId: true, reason: true, status: true, description: true, createdAt: true, closedAt: true, outcome: true } }),
      this.prisma.supportTicket.findMany({ where: { userId: u.id }, include: { messages: { where: { isInternal: false }, select: { body: true, senderId: true, createdAt: true } } } }),
      this.prisma.notification.findMany({ where: { userId: u.id }, select: { type: true, params: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 500 }),
    ]);
    // команды: участие (в том числе прошлое) и своя команда без телефонов других людей
    const memberships = await this.prisma.teamMember.findMany({
      where: { userId: u.id },
      select: { role: true, isActive: true, joinedAt: true, leftAt: true, team: { select: { name: true, ownerId: true } }, assignments: { select: { orderId: true, state: true, createdAt: true, endedAt: true } } },
    });
    const ownTeam = await this.prisma.team.findUnique({ where: { ownerId: u.id }, select: { name: true, createdAt: true, members: { select: { role: true, isActive: true, joinedAt: true, leftAt: true } } } });
    let wallet: unknown = null;
    if (u.worker) {
      const currency = await this.wallet.workerCurrency(this.prisma, u.id);
      wallet = { currency, pockets: await this.wallet.pockets(this.prisma, u.id, currency) };
    }
    const data = {
      generatedAt: new Date().toISOString(),
      format: 'masterio-export-v1',
      profile: {
        id: u.id,
        role: u.role,
        phone: u.phone,
        email: u.email,
        firstName: this.pii.decrypt(u.firstNameEnc),
        lastName: this.pii.decrypt(u.lastNameEnc),
        locale: u.locale,
        countryCode: u.countryCode,
        createdAt: u.createdAt,
        worker: u.worker
          ? { type: u.worker.type, companyName: u.worker.companyName, kycStatus: u.worker.kycStatus, ratingAvg: Number(u.worker.ratingAvg), categoryIds: u.worker.categories.map((c) => c.categoryId), cityIds: u.worker.cities.map((c) => c.cityId) }
          : null,
      },
      addresses: u.addresses.map((a) => ({ label: a.label, formatted: a.formatted, details: a.details, createdAt: a.createdAt })),
      devices: u.devices,
      orders: orders.map((o) => ({ ...o, myRole: o.clientId === u.id ? 'client' : 'worker', clientId: undefined, workerId: undefined })),
      chatMessages: messages,
      reviewsWritten,
      consents: consents.map((c) => ({ document: c.version.document.audience, country: c.countryCode, version: c.version.version, locale: c.version.locale, context: c.context, acceptedAt: c.acceptedAt, withdrawnAt: c.withdrawnAt })),
      documents,
      disputes,
      supportTickets: tickets.map((t) => ({ subject: t.subject, status: t.status, createdAt: t.createdAt, messages: t.messages.map((m) => ({ fromMe: m.senderId === u.id, body: m.body, createdAt: m.createdAt })) })),
      notifications,
      wallet,
      teams: {
        memberships: memberships.map((m) => ({ team: m.team.name, leader: m.team.ownerId === u.id, role: m.role, isActive: m.isActive, joinedAt: m.joinedAt, leftAt: m.leftAt, assignments: m.assignments })),
        ownTeam,
      },
    };
    const json = JSON.stringify(data, (_k, v: unknown) => (typeof v === 'bigint' ? Number(v) : v), 2);
    const key = `private/export/${u.id}/${randomUUID()}.json`;
    await this.storage.putObject(key, json, 'application/json');
    const req = await this.prisma.dataRequest.create({ data: { userId: u.id, type: 'export', status: 'done', fileKey: key, completedAt: new Date() } });
    const link = await this.storage.downloadUrl(key, `masterio-data-${new Date().toISOString().slice(0, 10)}.json`);
    return { id: req.id, status: req.status, url: link.url, expiresIn: link.expiresIn };
  }

  async myRequests(auth: AuthUser) {
    const rows = await this.prisma.dataRequest.findMany({ where: { userId: auth.id }, orderBy: { createdAt: 'desc' }, take: 20 });
    return Promise.all(
      rows.map(async (r) => {
        const fresh = r.type === 'export' && r.fileKey && r.completedAt && Date.now() - r.completedAt.getTime() < EXPORT_LINK_DAYS * 86_400_000;
        return {
          id: r.id,
          type: r.type,
          status: r.status,
          retainedReason: r.retainedReason,
          createdAt: r.createdAt,
          completedAt: r.completedAt,
          url: fresh && r.fileKey ? (await this.storage.downloadUrl(r.fileKey, 'masterio-data.json')).url : null,
        };
      }),
    );
  }

  /** Удаление аккаунта. Нельзя, пока есть незавершённые заказы, открытые споры или долг мастера. */
  async deleteAccount(auth: AuthUser, reason?: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.id }, include: { worker: true } });
    if (u.role === 'ADMIN') throw new AppException('FORBIDDEN');
    const busy = await this.prisma.order.count({ where: { OR: [{ clientId: u.id }, { workerId: u.id }], status: { in: BUSY as never } } });
    if (busy > 0) throw new AppException('ACCOUNT_DELETE_BLOCKED', { reason: 'active_order' });
    // участник команды, назначенный на активный заказ
    const performing = await this.prisma.orderAssignment.count({
      where: { teamMember: { userId: u.id }, state: { in: ['ACTIVE', 'PENDING_CONSENT'] }, order: { status: { in: BUSY as never } } },
    });
    if (performing > 0) throw new AppException('ACCOUNT_DELETE_BLOCKED', { reason: 'active_order' });
    const openDisputes = await this.prisma.dispute.count({
      where: { order: { OR: [{ clientId: u.id }, { workerId: u.id }] }, status: { notIn: [...DISPUTE_FINAL] } },
    });
    if (openDisputes > 0) throw new AppException('ACCOUNT_DELETE_BLOCKED', { reason: 'open_dispute' });
    if (u.worker) {
      const currency = await this.wallet.workerCurrency(this.prisma, u.id);
      const pockets = await this.wallet.pockets(this.prisma, u.id, currency);
      if (pockets.debtCents > 0) throw new AppException('ACCOUNT_DELETE_BLOCKED', { reason: 'debt', debtCents: pockets.debtCents, currency });
    }

    const now = new Date();
    const retained: string[] = [];
    const docs = await this.prisma.document.findMany({ where: { ownerId: u.id } });
    const evidence = await this.prisma.disputeEvidence.count({ where: { dispute: { order: { OR: [{ clientId: u.id }, { workerId: u.id }] } }, retentionUntil: { gt: now } } });
    const incidents = await this.prisma.incidentReport.count({ where: { reporterId: u.id } });
    const ledger = await this.prisma.ledgerAccount.count({ where: { ownerId: u.id } });
    const orders = await this.prisma.order.count({ where: { OR: [{ clientId: u.id }, { workerId: u.id }] } });

    // файлы удостоверений и лицензий: стираются, если не идёт обязательный срок хранения
    const filesToDelete: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const d of docs) {
        if (d.retentionUntil && d.retentionUntil > now) continue;
        if (d.fileKey) filesToDelete.push(d.fileKey);
        await tx.document.update({ where: { id: d.id }, data: { fileKey: '' } });
      }
      // участие в команде закрывается, своя команда распускается (журнал команды остаётся)
      await this.teams.onAccountDeleted(tx, u.id);
      await tx.address.deleteMany({ where: { userId: u.id } });
      await tx.device.deleteMany({ where: { userId: u.id } });
      await tx.refreshToken.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: now } });
      await tx.clientBlacklist.deleteMany({ where: { clientId: u.id } });
      await tx.notification.deleteMany({ where: { userId: u.id } });
      await tx.savedPaymentMethod.deleteMany({ where: { userId: u.id } });
      // переписка остаётся у второй стороны, но без текста (снимок для открытых когда-то споров хранится отдельно)
      await tx.chatMessage.updateMany({ where: { senderId: u.id }, data: { body: '—', bodyOriginalEnc: null } });
      // треки заказов без споров удаляются сразу; по спорным — хранятся до конца срока доказательств
      await tx.$executeRaw`
        DELETE FROM "LocationPoint" lp USING "Order" o
        WHERE lp."orderId" = o."id" AND lp."userId" = ${u.id}::uuid
          AND NOT EXISTS (SELECT 1 FROM "Dispute" d WHERE d."orderId" = o."id")`;
      if (u.worker) {
        await tx.workerProfile.update({ where: { userId: u.id }, data: { isOnline: false, companyName: null, companyRegNumber: null } });
        await tx.$executeRaw`UPDATE "WorkerProfile" SET "lastLocation" = NULL, "lastLocationAt" = NULL WHERE "userId" = ${u.id}::uuid`;
      }
      await tx.user.update({
        where: { id: u.id },
        data: { phone: null, email: null, firstNameEnc: null, lastNameEnc: null, photoKey: null, status: 'DELETED', deletedAt: now },
      });
      if (orders > 0) retained.push('orders');
      if (ledger > 0) retained.push('ledger');
      if (evidence > 0) retained.push('dispute_evidence');
      if (incidents > 0) retained.push('incidents');
      if (docs.some((d) => d.retentionUntil && d.retentionUntil > now)) retained.push('documents');
      retained.push('consents');
      await tx.dataRequest.create({
        data: {
          userId: u.id,
          type: 'delete',
          status: retained.length > 0 ? 'partially_retained' : 'done',
          retainedReason: [retained.join(','), reason ? `user: ${reason}` : ''].filter(Boolean).join(' | '),
          completedAt: now,
        },
      });
    });
    for (const key of filesToDelete) {
      try {
        await this.storage.deleteObject(key);
      } catch {
        // файл уже удалён или хранилище недоступно: запись обезличена, файл подчистит регламентная задача
      }
    }
    return { status: retained.length > 0 ? 'partially_retained' : 'done', retained };
  }

  async adminList(limit: number) {
    const rows = await this.prisma.dataRequest.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, role: true } });
    const role = new Map(users.map((u) => [u.id, u.role]));
    // ссылка на выгрузку не отдаётся в CRM: файл предназначен только самому пользователю
    return rows.map(({ fileKey: _fileKey, ...r }) => ({ ...r, userRole: role.get(r.userId) ?? null }));
  }
}
