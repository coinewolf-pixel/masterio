import { Inject, Injectable } from '@nestjs/common';
import { AppException } from '../common/app-exception';
import { isAdminWith, type AuthUser } from '../common/auth';
import { PII_CIPHER, PiiCipher } from '../common/crypto';
import type { LedgerAccountType, LedgerTxKind, OrderStatus, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../storage/storage.service';
import { WorkersService } from '../workers/workers.service';

const ACTIVE: OrderStatus[] = ['SEARCHING', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'];
const PERFORMING: OrderStatus[] = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'];
const DONE: OrderStatus[] = ['CONFIRMED', 'AUTO_CONFIRMED', 'CLOSED'];
const CANCELLED: OrderStatus[] = ['CANCELLED_BY_CLIENT', 'CANCELLED_BY_WORKER', 'CANCELLED_BY_ADMIN'];

type UserNames = { firstNameEnc: Uint8Array | null; lastNameEnc: Uint8Array | null };

export interface OrdersFilter {
  status?: OrderStatus;
  cityId?: string;
  categoryId?: string;
  workerId?: string;
  clientId?: string;
  number?: number;
  from?: string;
  to?: string;
  limit: number;
  cursor?: string;
}

export interface PeopleFilter {
  q?: string;
  status?: 'ACTIVE' | 'WARNED' | 'PREPAY_REQUIRED' | 'SUSPENDED' | 'BLOCKED';
  limit: number;
  cursor?: string;
}

/** Чтение данных для CRM: списки, карточки, дашборд, финансовые сводки. Изменения — в контроллерах и сервисах домена. */
@Injectable()
export class AdminQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    private readonly workerService: WorkersService,
    @Inject(PII_CIPHER) private readonly pii: PiiCipher,
  ) {}

  name(u: UserNames | null | undefined): string | null {
    if (!u) return null;
    const parts = [this.pii.decrypt(u.firstNameEnc), this.pii.decrypt(u.lastNameEnc)].filter((x): x is string => Boolean(x));
    return parts.length > 0 ? parts.join(' ') : null;
  }

  // ───────────── Дашборд ─────────────

  /** Сегодня (в часовом поясе админа), сейчас, онлайн по городам с предупреждением «мало мастеров», очереди на проверку. */
  async dashboard(admin: AuthUser, tz: string) {
    const [day] = await this.prisma.$queryRaw<Array<{ start: Date }>>`
      SELECT (date_trunc('day', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz}) AS start`;
    const start = day?.start ?? new Date(new Date().setUTCHours(0, 0, 0, 0));
    const byStatus = await this.prisma.order.groupBy({ by: ['status'], where: { createdAt: { gte: start } }, _count: true });
    const today = Object.fromEntries(byStatus.map((r) => [r.status, r._count])) as Partial<Record<OrderStatus, number>>;
    const sum = (list: OrderStatus[]) => list.reduce((acc, s) => acc + (today[s] ?? 0), 0);
    const completedToday = await this.prisma.order.count({ where: { completedAt: { gte: start } } });

    const nowByStatus = await this.prisma.order.groupBy({ by: ['status'], where: { status: { in: [...ACTIVE, 'NO_WORKERS', 'COMPLETED_BY_WORKER', 'DISPUTED'] } }, _count: true });
    const now = Object.fromEntries(nowByStatus.map((r) => [r.status, r._count])) as Partial<Record<OrderStatus, number>>;

    const stale = this.settings.get('WORKER_ONLINE_STALE_SECONDS');
    const cityRows = await this.prisma.$queryRaw<Array<{ id: string; names: unknown; countryCode: string; online: bigint; active: bigint; searching: bigint; noWorkers: bigint }>>`
      SELECT c."id", c."names", c."countryCode",
        (SELECT COUNT(DISTINCT w."userId") FROM "WorkerCity" wc JOIN "WorkerProfile" w ON w."userId" = wc."workerId"
          WHERE wc."cityId" = c."id" AND w."isOnline" = true AND w."lastLocationAt" > now() - make_interval(secs => ${stale})) AS online,
        (SELECT COUNT(*) FROM "Order" o WHERE o."cityId" = c."id" AND o."status" IN ('ACCEPTED','EN_ROUTE','ARRIVED','IN_PROGRESS')) AS active,
        (SELECT COUNT(*) FROM "Order" o WHERE o."cityId" = c."id" AND o."status" = 'SEARCHING') AS searching,
        (SELECT COUNT(*) FROM "Order" o WHERE o."cityId" = c."id" AND o."status" = 'NO_WORKERS') AS "noWorkers"
      FROM "City" c WHERE c."isActive" = true ORDER BY c."countryCode", c."id"`;
    const cities = cityRows.map((c) => {
      const online = Number(c.online);
      const minimum = this.settings.get('LOW_WORKERS_WARNING', { countryCode: c.countryCode, cityId: c.id });
      return { cityId: c.id, names: c.names, online, active: Number(c.active), searching: Number(c.searching), noWorkers: Number(c.noWorkers), minimum, lowWorkers: online < minimum };
    });

    const queues = {
      documents: await this.prisma.document.count({ where: { status: 'NOT_VERIFIED' } }),
      grants: await this.prisma.walletGrant.count({ where: { status: 'PENDING_APPROVAL' } }),
      fraudFlags: await this.prisma.fraudFlag.count({ where: { resolvedAt: null } }),
      disputes: await this.prisma.dispute.count({ where: { status: { notIn: ['SETTLED', 'UNRESOLVED_REFERRED', 'CLOSED'] } } }),
      tickets: await this.prisma.supportTicket.count({ where: { status: 'OPEN' } }),
      incidents: await this.prisma.incidentReport.count({ where: { createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } } }),
    };

    const commissionToday = isAdminWith(admin, 'FINANCE')
      ? (
          await this.prisma.$queryRaw<Array<{ currency: string; cents: bigint }>>`
            SELECT a."currency", COALESCE(SUM(e."amountCents"), 0) AS cents
            FROM "LedgerEntry" e JOIN "LedgerAccount" a ON a."id" = e."accountId" JOIN "LedgerTransaction" t ON t."id" = e."transactionId"
            WHERE a."type" = 'PLATFORM_REVENUE' AND t."kind" = 'COMMISSION' AND t."createdAt" >= ${start}
            GROUP BY a."currency" ORDER BY a."currency"`
        ).map((r) => ({ currency: r.currency, cents: Number(r.cents) }))
      : null;

    return {
      since: start.toISOString(),
      today: { created: byStatus.reduce((a, r) => a + r._count, 0), completed: completedToday, cancelled: sum(CANCELLED), byStatus: today },
      now: {
        searching: now.SEARCHING ?? 0,
        noWorkers: now.NO_WORKERS ?? 0,
        performing: PERFORMING.reduce((a, s) => a + (now[s] ?? 0), 0),
        awaitingConfirmation: now.COMPLETED_BY_WORKER ?? 0,
        disputed: now.DISPUTED ?? 0,
        onlineWorkers: cities.reduce((a, c) => a + c.online, 0),
      },
      cities,
      queues,
      commissionToday,
    };
  }

  // ───────────── Живая карта ─────────────

  async mapSnapshot() {
    const stale = this.settings.get('WORKER_ONLINE_STALE_SECONDS');
    const workers = await this.prisma.$queryRaw<Array<{ userId: string; lat: number; lng: number; lastLocationAt: Date; firstNameEnc: Uint8Array | null; lastNameEnc: Uint8Array | null; busy: boolean }>>`
      SELECT w."userId", ST_Y(w."lastLocation"::geometry) AS lat, ST_X(w."lastLocation"::geometry) AS lng, w."lastLocationAt",
             u."firstNameEnc", u."lastNameEnc",
             EXISTS (SELECT 1 FROM "Order" o WHERE o."workerId" = w."userId" AND o."status" IN ('ACCEPTED','EN_ROUTE','ARRIVED','IN_PROGRESS')) AS busy
      FROM "WorkerProfile" w JOIN "User" u ON u."id" = w."userId"
      WHERE w."isOnline" = true AND w."lastLocation" IS NOT NULL AND w."lastLocationAt" > now() - make_interval(secs => ${stale * 10})`;
    const orders = await this.prisma.$queryRaw<
      Array<{ id: string; number: number; status: string; categoryId: string; cityId: string; addressFormatted: string; workerId: string | null; lat: number; lng: number; wLat: number | null; wLng: number | null; wAt: Date | null }>
    >`
      SELECT o."id", o."number", o."status", o."categoryId", o."cityId", o."addressFormatted", o."workerId",
             ST_Y(o."location"::geometry) AS lat, ST_X(o."location"::geometry) AS lng,
             ST_Y(lp."point"::geometry) AS "wLat", ST_X(lp."point"::geometry) AS "wLng", lp."recordedAt" AS "wAt"
      FROM "Order" o
      LEFT JOIN LATERAL (SELECT "point", "recordedAt" FROM "LocationPoint" WHERE "orderId" = o."id" ORDER BY "recordedAt" DESC LIMIT 1) lp ON true
      WHERE o."status" IN ('SEARCHING','NO_WORKERS','ACCEPTED','EN_ROUTE','ARRIVED','IN_PROGRESS')`;
    return {
      staleSeconds: stale,
      workers: workers.map((w) => ({ userId: w.userId, name: this.name(w), lat: w.lat, lng: w.lng, lastLocationAt: w.lastLocationAt.toISOString(), busy: w.busy })),
      orders: orders.map((o) => ({
        id: o.id,
        number: o.number,
        status: o.status,
        categoryId: o.categoryId,
        cityId: o.cityId,
        addressFormatted: o.addressFormatted,
        workerId: o.workerId,
        location: { lat: o.lat, lng: o.lng },
        performer: o.wLat !== null && o.wLng !== null ? { lat: o.wLat, lng: o.wLng, at: o.wAt?.toISOString() ?? null } : null,
      })),
    };
  }

  // ───────────── Заказы ─────────────

  async orders(f: OrdersFilter) {
    const where: Prisma.OrderWhereInput = {
      ...(f.status ? { status: f.status } : {}),
      ...(f.cityId ? { cityId: f.cityId } : {}),
      ...(f.categoryId ? { categoryId: f.categoryId } : {}),
      ...(f.workerId ? { workerId: f.workerId } : {}),
      ...(f.clientId ? { clientId: f.clientId } : {}),
      ...(f.number !== undefined ? { number: f.number } : {}),
      ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: new Date(f.from) } : {}), ...(f.to ? { lt: new Date(f.to) } : {}) } } : {}),
    };
    const rows = await this.prisma.order.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: f.limit,
      ...(f.cursor ? { skip: 1, cursor: { id: f.cursor } } : {}),
      include: {
        client: { select: { user: { select: { id: true, phone: true, firstNameEnc: true, lastNameEnc: true } } } },
        worker: { select: { user: { select: { id: true, phone: true, firstNameEnc: true, lastNameEnc: true } } } },
      },
    });
    const total = await this.prisma.order.count({ where });
    return {
      total,
      items: rows.map((o) => ({
        id: o.id,
        number: o.number,
        status: o.status,
        cityId: o.cityId,
        categoryId: o.categoryId,
        paymentMethod: o.paymentMethod,
        currency: o.currency,
        confirmedAmountCents: o.confirmedAmountCents,
        commissionCents: o.commissionCents,
        addressFormatted: o.addressFormatted,
        createdAt: o.createdAt,
        client: { id: o.client.user.id, name: this.name(o.client.user), phone: o.client.user.phone },
        worker: o.worker ? { id: o.worker.user.id, name: this.name(o.worker.user), phone: o.worker.user.phone } : null,
      })),
      nextCursor: rows.length === f.limit ? (rows[rows.length - 1]?.id ?? null) : null,
    };
  }

  /** Карточка заказа: таймлайн, журнал рассылки, сметы, назначения, чат, трек, фото, проводки, отзывы. */
  async order(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        events: { orderBy: { createdAt: 'asc' } },
        offers: { orderBy: [{ round: 'asc' }, { position: 'asc' }, { sentAt: 'asc' }], include: { worker: { select: { user: { select: { firstNameEnc: true, lastNameEnc: true } } } } } },
        estimates: { include: { items: true }, orderBy: { version: 'asc' } },
        assignments: { orderBy: { createdAt: 'asc' }, include: { teamMember: { select: { role: true, userId: true, user: { select: { firstNameEnc: true, lastNameEnc: true } } } } } },
        cancellation: true,
        disputes: true,
        messages: { orderBy: { createdAt: 'asc' }, take: 500 },
        reviews: true,
        photos: { orderBy: { createdAt: 'asc' } },
        client: { select: { user: { select: { id: true, phone: true, firstNameEnc: true, lastNameEnc: true, status: true } } } },
        worker: { select: { user: { select: { id: true, phone: true, firstNameEnc: true, lastNameEnc: true, status: true } } } },
      },
    });
    if (!order) throw new AppException('NOT_FOUND');
    const [geo] = await this.prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
      SELECT ST_Y("location"::geometry) AS lat, ST_X("location"::geometry) AS lng FROM "Order" WHERE "id" = ${id}::uuid`;
    const track = await this.prisma.$queryRaw<Array<{ lat: number; lng: number; recordedAt: Date; accuracyM: number | null; userId: string }>>`
      SELECT ST_Y("point"::geometry) AS lat, ST_X("point"::geometry) AS lng, "recordedAt", "accuracyM", "userId"
      FROM "LocationPoint" WHERE "orderId" = ${id}::uuid ORDER BY "recordedAt" ASC LIMIT 5000`;
    const ledger = await this.prisma.ledgerTransaction.findMany({
      where: { orderId: id },
      orderBy: { createdAt: 'asc' },
      include: { entries: { include: { account: { select: { type: true, ownerId: true, currency: true } } } } },
    });
    const photos = this.storage.configured
      ? await Promise.all(order.photos.map(async (p) => ({ id: p.id, purpose: p.purpose, url: (await this.storage.viewUrl(p.fileKey)).url, createdAt: p.createdAt })))
      : [];
    const party = (u: { id: string; phone: string | null; status: string } & UserNames) => ({ id: u.id, name: this.name(u), phone: u.phone, status: u.status });
    const { messages, offers, client, worker, assignments, ...rest } = order;
    return {
      ...rest,
      // кто фактически выполнял заказ: назначения и замены участников команды с согласием клиента
      assignments: assignments.map(({ teamMember, ...a }) => ({ ...a, memberRole: teamMember.role, memberUserId: teamMember.userId, memberName: this.name(teamMember.user) })),
      // фото — только временными ссылками, без ключей хранилища
      photos,
      location: geo ?? null,
      client: party(client.user),
      worker: worker ? party(worker.user) : null,
      offers: offers.map(({ worker: w, score, ...o }) => ({ ...o, score: Number(score), workerName: this.name(w.user) })),
      messages: messages.map((m) => ({ id: m.id, senderId: m.senderId, body: m.body, filtered: m.filtered, filterHits: m.filterHits, createdAt: m.createdAt })),
      track: track.map((p) => ({ lat: p.lat, lng: p.lng, recordedAt: p.recordedAt.toISOString(), accuracyM: p.accuracyM, userId: p.userId })),
      ledger: ledger.map((t) => ({
        id: t.id,
        kind: t.kind,
        createdAt: t.createdAt,
        memo: t.memo,
        entries: t.entries.map((e) => ({ account: e.account.type, ownerId: e.account.ownerId, currency: e.account.currency, amountCents: Number(e.amountCents) })),
      })),
    };
  }

  // ───────────── Мастера ─────────────

  private peopleWhere(f: PeopleFilter): Prisma.UserWhereInput {
    const q = f.q?.trim();
    const digits = q?.replace(/[^\d]/g, '') ?? '';
    return {
      ...(f.status ? { status: f.status } : { status: { not: 'DELETED' } }),
      ...(q
        ? /^[0-9a-f-]{36}$/i.test(q)
          ? { id: q }
          : digits.length >= 3
            ? { phone: { contains: digits } }
            : { id: '00000000-0000-0000-0000-000000000000' }
        : {}),
    };
  }

  async workers(f: PeopleFilter & { kyc?: 'NOT_VERIFIED' | 'VERIFIED' | 'REJECTED' | 'EXPIRED'; online?: boolean; cityId?: string }) {
    const where: Prisma.WorkerProfileWhereInput = {
      user: this.peopleWhere(f),
      ...(f.kyc ? { kycStatus: f.kyc } : {}),
      ...(f.online !== undefined ? { isOnline: f.online } : {}),
      ...(f.cityId ? { cities: { some: { cityId: f.cityId } } } : {}),
    };
    const rows = await this.prisma.workerProfile.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { userId: 'desc' }],
      take: f.limit,
      ...(f.cursor ? { skip: 1, cursor: { userId: f.cursor } } : {}),
      include: { user: true, cities: true, categories: true },
    });
    const total = await this.prisma.workerProfile.count({ where });
    return {
      total,
      items: rows.map((w) => ({
        id: w.userId,
        name: this.name(w.user),
        phone: w.user.phone,
        countryCode: w.user.countryCode,
        status: w.user.status,
        type: w.type,
        companyName: w.companyName,
        kycStatus: w.kycStatus,
        isOnline: w.isOnline,
        ratingAvg: Number(w.ratingAvg),
        ratingCount: w.ratingCount,
        acceptRate: Number(w.acceptRate),
        cancelRate: Number(w.cancelRate),
        cityIds: w.cities.map((c) => c.cityId),
        categoryIds: w.categories.map((c) => c.categoryId),
        createdAt: w.createdAt,
      })),
      nextCursor: rows.length === f.limit ? (rows[rows.length - 1]?.userId ?? null) : null,
    };
  }

  async worker(id: string) {
    const w = await this.prisma.workerProfile.findUnique({ where: { userId: id }, include: { user: true, cities: true, categories: true } });
    if (!w) throw new AppException('NOT_FOUND');
    const byStatus = await this.prisma.order.groupBy({ by: ['status'], where: { workerId: id }, _count: true });
    const counts = Object.fromEntries(byStatus.map((r) => [r.status, r._count])) as Partial<Record<OrderStatus, number>>;
    const workerCancels = await this.prisma.orderEvent.count({ where: { type: 'worker_cancelled', actorId: id } });
    const disputes = await this.prisma.dispute.count({ where: { OR: [{ againstId: id }, { openedById: id }] } });
    const documents = await this.prisma.document.findMany({
      where: { ownerId: id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, kind: true, status: true, rejectReason: true, validUntil: true, createdAt: true, reviewedAt: true, license: { select: { categoryId: true, number: true } }, insurance: { select: { insurerName: true, policyNumber: true, validUntil: true } } },
    });
    const recentOrders = await this.prisma.order.findMany({
      where: { workerId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, number: true, status: true, createdAt: true, confirmedAmountCents: true, commissionCents: true, currency: true, categoryId: true },
    });
    const grants = await this.prisma.walletGrant.findMany({ where: { workerId: id }, orderBy: { createdAt: 'desc' }, take: 50 });
    const flags = await this.prisma.fraudFlag.findMany({ where: { OR: [{ userId: id }, { pairUserId: id }] }, orderBy: { createdAt: 'desc' }, take: 50 });
    const eligibility = await this.workerService.eligibility(id);
    return {
      id,
      name: this.name(w.user),
      phone: w.user.phone,
      countryCode: w.user.countryCode,
      locale: w.user.locale,
      status: w.user.status,
      createdAt: w.user.createdAt,
      type: w.type,
      companyName: w.companyName,
      companyRegNumber: w.companyRegNumber,
      kycStatus: w.kycStatus,
      isOnline: w.isOnline,
      lastLocationAt: w.lastLocationAt,
      preferredRadiusM: w.preferredRadiusM,
      ratingAvg: Number(w.ratingAvg),
      ratingCount: w.ratingCount,
      acceptRate: Number(w.acceptRate),
      cancelRate: Number(w.cancelRate),
      cancelCount30d: w.cancelCount30d,
      cityIds: w.cities.map((c) => c.cityId),
      categoryIds: w.categories.map((c) => c.categoryId),
      stats: {
        total: Object.values(counts).reduce((a, n) => a + (n ?? 0), 0),
        completed: DONE.reduce((a, s) => a + (counts[s] ?? 0), 0),
        active: PERFORMING.reduce((a, s) => a + (counts[s] ?? 0), 0),
        disputed: counts.DISPUTED ?? 0,
        workerCancels,
        disputes,
      },
      eligibility,
      documents,
      recentOrders,
      grants,
      flags,
    };
  }

  // ───────────── Клиенты ─────────────

  async clients(f: PeopleFilter) {
    const where: Prisma.ClientProfileWhereInput = { user: this.peopleWhere(f) };
    const rows = await this.prisma.clientProfile.findMany({
      where,
      orderBy: [{ user: { createdAt: 'desc' } }, { userId: 'desc' }],
      take: f.limit,
      ...(f.cursor ? { skip: 1, cursor: { userId: f.cursor } } : {}),
      include: { user: true },
    });
    const total = await this.prisma.clientProfile.count({ where });
    return {
      total,
      items: rows.map((c) => ({
        id: c.userId,
        name: this.name(c.user),
        phone: c.user.phone,
        countryCode: c.user.countryCode,
        status: c.user.status,
        completedOrders: c.completedOrders,
        cancelCount30d: c.cancelCount30d,
        createdAt: c.user.createdAt,
      })),
      nextCursor: rows.length === f.limit ? (rows[rows.length - 1]?.userId ?? null) : null,
    };
  }

  async client(id: string) {
    const c = await this.prisma.clientProfile.findUnique({ where: { userId: id }, include: { user: true, blacklist: true } });
    if (!c) throw new AppException('NOT_FOUND');
    const orders = await this.prisma.order.findMany({
      where: { clientId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, number: true, status: true, createdAt: true, confirmedAmountCents: true, currency: true, categoryId: true, workerId: true, cancellation: { select: { reasonCode: true, penaltyCents: true, actor: true } } },
    });
    const byStatus = await this.prisma.order.groupBy({ by: ['status'], where: { clientId: id }, _count: true });
    const counts = Object.fromEntries(byStatus.map((r) => [r.status, r._count])) as Partial<Record<OrderStatus, number>>;
    const disputes = await this.prisma.dispute.findMany({ where: { OR: [{ openedById: id }, { againstId: id }] }, orderBy: { createdAt: 'desc' }, take: 50 });
    const flags = await this.prisma.fraudFlag.findMany({ where: { OR: [{ userId: id }, { pairUserId: id }] }, orderBy: { createdAt: 'desc' }, take: 50 });
    return {
      id,
      name: this.name(c.user),
      phone: c.user.phone,
      countryCode: c.user.countryCode,
      locale: c.user.locale,
      status: c.user.status,
      createdAt: c.user.createdAt,
      completedOrders: c.completedOrders,
      cancelCount30d: c.cancelCount30d,
      stats: {
        total: Object.values(counts).reduce((a, n) => a + (n ?? 0), 0),
        completed: DONE.reduce((a, s) => a + (counts[s] ?? 0), 0),
        cancelledByClient: counts.CANCELLED_BY_CLIENT ?? 0,
        disputed: counts.DISPUTED ?? 0,
      },
      orders,
      disputes,
      flags,
      blacklist: c.blacklist.map((b) => ({ workerId: b.workerId, createdAt: b.createdAt })),
    };
  }

  // ───────────── Подозрительные действия ─────────────

  async fraudFlags(resolved: boolean) {
    const rows = await this.prisma.fraudFlag.findMany({
      where: resolved ? { resolvedAt: { not: null } } : { resolvedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const ids = [...new Set(rows.flatMap((r) => [r.userId, r.pairUserId]).filter((x): x is string => x !== null))];
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, role: true, phone: true, firstNameEnc: true, lastNameEnc: true } });
    const byId = new Map(users.map((u) => [u.id, { id: u.id, role: u.role, phone: u.phone, name: this.name(u) }]));
    return rows.map((r) => ({ ...r, user: r.userId ? (byId.get(r.userId) ?? null) : null, pairUser: r.pairUserId ? (byId.get(r.pairUserId) ?? null) : null }));
  }

  // ───────────── Финансы ─────────────

  /** Сводка за период по валютам: оборот заказов, комиссия и из чего она оплачена, пополнения, кредиты, сгорания, обязательства. */
  async financeSummary(from: Date, to: Date) {
    const rows = await this.prisma.$queryRaw<Array<{ kind: LedgerTxKind; type: LedgerAccountType; currency: string; sum: bigint; txs: bigint }>>`
      SELECT t."kind", a."type", a."currency", SUM(e."amountCents") AS sum, COUNT(DISTINCT t."id") AS txs
      FROM "LedgerEntry" e
      JOIN "LedgerTransaction" t ON t."id" = e."transactionId"
      JOIN "LedgerAccount" a ON a."id" = e."accountId"
      WHERE t."createdAt" >= ${from} AND t."createdAt" < ${to}
      GROUP BY t."kind", a."type", a."currency"`;
    const turnover = await this.prisma.$queryRaw<Array<{ currency: string; orders: bigint; cents: bigint }>>`
      SELECT "currency", COUNT(*) AS orders, COALESCE(SUM("confirmedAmountCents"), 0) AS cents
      FROM "Order" WHERE "status" IN ('CONFIRMED','AUTO_CONFIRMED','CLOSED') AND "completedAt" >= ${from} AND "completedAt" < ${to}
      GROUP BY "currency"`;
    const liabilities = await this.prisma.$queryRaw<Array<{ type: LedgerAccountType; currency: string; positive: bigint; negative: bigint }>>`
      SELECT a."type", a."currency",
             COALESCE(SUM(GREATEST(b."balanceCents", 0)), 0) AS positive,
             COALESCE(SUM(LEAST(b."balanceCents", 0)), 0) AS negative
      FROM "AccountBalance" b JOIN "LedgerAccount" a ON a."id" = b."accountId"
      WHERE a."ownerId" IS NOT NULL AND a."type" IN ('WORKER_TOPUP','WORKER_PROMO','WORKER_BONUS','WORKER_EARNINGS','WORKER_DEBT')
      GROUP BY a."type", a."currency"`;
    return buildFinanceSummary(from, to, rows, turnover, liabilities);
  }

  async transactions(f: { from: Date; to: Date; kind?: LedgerTxKind; ownerId?: string; limit: number; cursor?: string }) {
    const where: Prisma.LedgerTransactionWhereInput = {
      createdAt: { gte: f.from, lt: f.to },
      ...(f.kind ? { kind: f.kind } : {}),
      ...(f.ownerId ? { entries: { some: { account: { ownerId: f.ownerId } } } } : {}),
    };
    const rows = await this.prisma.ledgerTransaction.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: f.limit,
      ...(f.cursor ? { skip: 1, cursor: { id: f.cursor } } : {}),
      include: { entries: { include: { account: { select: { type: true, ownerId: true, currency: true } } } } },
    });
    return {
      items: rows.map((t) => ({
        id: t.id,
        kind: t.kind,
        createdAt: t.createdAt,
        orderId: t.orderId,
        grantId: t.grantId,
        paymentId: t.paymentId,
        actorId: t.actorId,
        memo: t.memo,
        entries: t.entries.map((e) => ({ account: e.account.type, ownerId: e.account.ownerId, currency: e.account.currency, amountCents: Number(e.amountCents) })),
      })),
      nextCursor: rows.length === f.limit ? (rows[rows.length - 1]?.id ?? null) : null,
    };
  }

  /** CSV журнала операций за период: одна строка на проводку. Суммы — в минимальных единицах и в валюте. */
  async ledgerCsv(from: Date, to: Date): Promise<string> {
    const rows = await this.prisma.$queryRaw<
      Array<{ txId: string; createdAt: Date; kind: string; orderNumber: number | null; account: string; ownerId: string | null; currency: string; amountCents: bigint; memo: string | null }>
    >`
      SELECT t."id" AS "txId", t."createdAt", t."kind", o."number" AS "orderNumber", a."type" AS account, a."ownerId", a."currency", e."amountCents", t."memo"
      FROM "LedgerEntry" e
      JOIN "LedgerTransaction" t ON t."id" = e."transactionId"
      JOIN "LedgerAccount" a ON a."id" = e."accountId"
      LEFT JOIN "Order" o ON o."id" = t."orderId"
      WHERE t."createdAt" >= ${from} AND t."createdAt" < ${to}
      ORDER BY t."createdAt", t."id", e."id"
      LIMIT 200000`;
    const header = ['transaction_id', 'created_at', 'kind', 'order_number', 'account', 'owner_id', 'currency', 'amount_cents', 'amount', 'memo'];
    const lines = rows.map((r) =>
      [r.txId, r.createdAt.toISOString(), r.kind, r.orderNumber ?? '', r.account, r.ownerId ?? '', r.currency, r.amountCents.toString(), centsToDecimal(r.amountCents), r.memo ?? '']
        .map(csvCell)
        .join(','),
    );
    return [header.join(','), ...lines].join('\n') + '\n';
  }
}

// ───────────── чистые функции (покрыты unit-тестами) ─────────────

export interface FinanceCurrencySummary {
  currency: string;
  ordersCompleted: number;
  turnoverCents: number;
  commissionCents: number;
  commissionFromBonusCents: number;
  commissionFromPromoCents: number;
  commissionFromTopupCents: number;
  commissionFromEarningsCents: number;
  commissionToDebtCents: number;
  topupsCents: number;
  topupsCount: number;
  chargebacksCents: number;
  promoGrantedCents: number;
  promoExpiredCents: number;
  bonusAccruedCents: number;
  bonusExpiredCents: number;
  liabilities: { topupCents: number; promoCents: number; bonusCents: number; earningsCents: number; debtCents: number };
}

export function buildFinanceSummary(
  from: Date,
  to: Date,
  rows: Array<{ kind: string; type: string; currency: string; sum: bigint; txs: bigint }>,
  turnover: Array<{ currency: string; orders: bigint; cents: bigint }>,
  liabilities: Array<{ type: string; currency: string; positive: bigint; negative: bigint }>,
): { from: string; to: string; currencies: FinanceCurrencySummary[] } {
  const currencies = new Set<string>([...rows.map((r) => r.currency), ...turnover.map((t) => t.currency), ...liabilities.map((l) => l.currency)]);
  const pick = (currency: string, kind: string, type: string) => rows.find((r) => r.currency === currency && r.kind === kind && r.type === type);
  const val = (currency: string, kind: string, type: string) => Number(pick(currency, kind, type)?.sum ?? 0n);
  const liab = (currency: string, type: string) => liabilities.find((l) => l.currency === currency && l.type === type);
  const result = [...currencies].sort().map((currency): FinanceCurrencySummary => {
    const t = turnover.find((x) => x.currency === currency);
    return {
      currency,
      ordersCompleted: Number(t?.orders ?? 0n),
      turnoverCents: Number(t?.cents ?? 0n),
      commissionCents: val(currency, 'COMMISSION', 'PLATFORM_REVENUE'),
      commissionFromBonusCents: -val(currency, 'COMMISSION', 'WORKER_BONUS'),
      commissionFromPromoCents: -val(currency, 'COMMISSION', 'WORKER_PROMO'),
      commissionFromTopupCents: -val(currency, 'COMMISSION', 'WORKER_TOPUP'),
      commissionFromEarningsCents: -val(currency, 'COMMISSION', 'WORKER_EARNINGS'),
      commissionToDebtCents: -val(currency, 'COMMISSION', 'WORKER_DEBT'),
      topupsCents: -val(currency, 'TOPUP', 'STRIPE_CLEARING'),
      topupsCount: Number(pick(currency, 'TOPUP', 'STRIPE_CLEARING')?.txs ?? 0n),
      chargebacksCents: val(currency, 'CHARGEBACK', 'STRIPE_CLEARING'),
      promoGrantedCents: val(currency, 'PROMO_GRANT', 'WORKER_PROMO'),
      promoExpiredCents: -val(currency, 'PROMO_EXPIRY', 'WORKER_PROMO'),
      bonusAccruedCents: val(currency, 'BONUS_ACCRUAL', 'WORKER_BONUS'),
      bonusExpiredCents: -val(currency, 'BONUS_EXPIRY', 'WORKER_BONUS'),
      liabilities: {
        topupCents: Number(liab(currency, 'WORKER_TOPUP')?.positive ?? 0n),
        promoCents: Number(liab(currency, 'WORKER_PROMO')?.positive ?? 0n),
        bonusCents: Number(liab(currency, 'WORKER_BONUS')?.positive ?? 0n),
        earningsCents: Number(liab(currency, 'WORKER_EARNINGS')?.positive ?? 0n),
        debtCents: -Number(liab(currency, 'WORKER_DEBT')?.negative ?? 0n),
      },
    };
  });
  return { from: from.toISOString(), to: to.toISOString(), currencies: result };
}

/** Экранирование для CSV, включая защиту от формул в Excel (=, +, -, @ в начале текста). */
export function csvCell(value: string | number): string {
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function centsToDecimal(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? '-' : ''}${(abs / 100n).toString()}.${(abs % 100n).toString().padStart(2, '0')}`;
}
