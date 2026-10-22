import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';
import {
  distanceMeters,
  RT_EVENTS,
  translate,
  type LocationPointInput,
  type WorkerLocationPayload,
} from '@masterio/shared';
import { AppException } from '../common/app-exception';
import { PII_CIPHER, PiiCipher } from '../common/crypto';
import { geoPoint } from '../common/geo';
import type { Order } from '../generated/prisma/client';
import { JobsService } from '../jobs/jobs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { REDIS } from '../redis/redis.module';
import { SettingsService } from '../settings/settings.service';
import { WorkersService } from '../workers/workers.service';
import { EtaService } from './eta.service';

const ACTIVE = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] as const;
const LOST_AFTER_MS = 60_000;

/**
 * Живое отслеживание (раздел 4): точки от телефона назначенного исполнителя, трансляция клиенту в комнату
 * заказа только пока заказ активен, push «мастер рядом», статус «связь потеряна», хранение трека ограниченное время.
 */
@Injectable()
export class TrackingService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly workers: WorkersService,
    private readonly eta: EtaService,
    private readonly jobs: JobsService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(PII_CIPHER) private readonly pii: PiiCipher,
  ) {}

  onModuleInit(): void {
    this.jobs.register('tracking-watchdog', async () => {
      await this.watchdog();
    });
    this.jobs.register('track-retention', async () => {
      await this.purgeOldTracks();
    });
  }

  async ingest(userId: string, points: LocationPointInput[]): Promise<{ orderId: string | null; accepted: number }> {
    if (points.length === 0) return { orderId: null, accepted: 0 };
    const sorted = [...points].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    const latest = sorted[sorted.length - 1] as LocationPointInput;
    const profile = await this.prisma.workerProfile.findUnique({ where: { userId } });
    if (profile) await this.workers.updateLocation(userId, latest);

    const order = await this.activeOrderForPerformer(userId);
    // Без активного заказа трек не пишется: только последняя позиция онлайн-мастера для подбора
    if (!order) return { orderId: null, accepted: 0 };

    const maxFuture = Date.now() + 60_000;
    let accepted = 0;
    for (const p of sorted) {
      const recorded = new Date(p.recordedAt);
      if (Number.isNaN(recorded.getTime()) || recorded.getTime() > maxFuture) continue;
      await this.prisma.$executeRaw`
        INSERT INTO "LocationPoint" ("orderId", "userId", "point", "accuracyM", "speedMps", "heading", "recordedAt", "receivedAt")
        VALUES (${order.id}::uuid, ${userId}::uuid, ${geoPoint(p)}, ${p.accuracyM === undefined ? null : Math.round(p.accuracyM)},
                ${p.speedMps ?? null}, ${p.heading === null || p.heading === undefined ? null : Math.round(p.heading)}, ${recorded}, now())`;
      accepted += 1;
    }

    const target = await this.orderLocation(order.id);
    const { etaSeconds, distanceM } = await this.eta.eta(order.id, latest, target);
    const straight = distanceMeters(latest, target);
    const payload: WorkerLocationPayload = {
      orderId: order.id,
      lat: latest.lat,
      lng: latest.lng,
      heading: latest.heading ?? null,
      speedMps: latest.speedMps ?? null,
      distanceM,
      etaSeconds: order.status === 'ACCEPTED' || order.status === 'EN_ROUTE' ? etaSeconds : null,
      recordedAt: latest.recordedAt,
    };
    this.realtime.toOrder(order.id, RT_EVENTS.locationWorker, payload);
    this.realtime.toAdmins(RT_EVENTS.adminMap, { kind: 'performer', userId, ...payload });

    await this.redis.set(`trk:last:${order.id}`, String(Date.now()), 'EX', 86_400);
    const wasLost = await this.redis.del(`trk:lost:${order.id}`);
    if (wasLost > 0) this.realtime.toOrder(order.id, RT_EVENTS.locationRestored, { orderId: order.id });

    if (order.status === 'EN_ROUTE') await this.maybeNotifyNearby(order, userId, straight);
    return { orderId: order.id, accepted };
  }

  /** Право войти в комнату заказа: клиент только пока заказ активен; исполнитель; админ. */
  async canJoinOrderRoom(userId: string, role: string, orderId: string): Promise<boolean> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return false;
    if (role === 'ADMIN') return true;
    const active = (ACTIVE as readonly string[]).includes(order.status);
    if (!active) return false;
    if (order.clientId === userId || order.workerId === userId) return true;
    const assigned = await this.prisma.orderAssignment.findFirst({ where: { orderId, isCurrent: true, teamMember: { userId } } });
    return assigned !== null;
  }

  async activeOrderForPerformer(userId: string): Promise<Order | null> {
    const assigned = await this.prisma.orderAssignment.findFirst({
      where: { isCurrent: true, teamMember: { userId }, order: { status: { in: [...ACTIVE] } } },
      include: { order: true },
    });
    if (assigned) return assigned.order;
    // у руководителя команды может быть несколько активных заказов: свой — тот, что не передан участнику
    const own = await this.prisma.order.findFirst({
      where: { workerId: userId, status: { in: [...ACTIVE] }, NOT: { assignments: { some: { isCurrent: true, NOT: { teamMember: { userId } } } } } },
      orderBy: { acceptedAt: 'asc' },
    });
    return own;
  }

  async lastTrack(user: { id: string; role: string }, orderId: string, limit = 200) {
    if (!(await this.canJoinOrderRoom(user.id, user.role, orderId))) throw new AppException('NOT_FOUND');
    return this.prisma.$queryRaw<Array<{ lat: number; lng: number; recordedAt: Date }>>`
      SELECT ST_Y("point"::geometry) AS lat, ST_X("point"::geometry) AS lng, "recordedAt"
      FROM "LocationPoint" WHERE "orderId" = ${orderId}::uuid ORDER BY "recordedAt" DESC LIMIT ${limit}`;
  }

  /** Каждые 20 секунд: у активных заказов без точек дольше минуты — «связь потеряна». */
  async watchdog(): Promise<number> {
    const orders = await this.prisma.order.findMany({
      where: { status: { in: ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] } },
      select: { id: true },
    });
    let lost = 0;
    for (const o of orders) {
      const last = await this.redis.get(`trk:last:${o.id}`);
      if (!last || Date.now() - Number(last) < LOST_AFTER_MS) continue;
      const set = await this.redis.set(`trk:lost:${o.id}`, '1', 'EX', 86_400, 'NX');
      if (set === 'OK') {
        this.realtime.toOrder(o.id, RT_EVENTS.locationLost, { orderId: o.id, lastSeenAt: new Date(Number(last)).toISOString() });
        lost += 1;
      }
    }
    return lost;
  }

  /** Удаление треков старше LOCATION_RETENTION_DAYS, кроме заказов с открытым спором. */
  async purgeOldTracks(): Promise<number> {
    const days = this.settings.get('LOCATION_RETENTION_DAYS');
    return this.prisma.$executeRaw`
      DELETE FROM "LocationPoint" lp
      WHERE lp."recordedAt" < now() - make_interval(days => ${days})
        AND NOT EXISTS (
          SELECT 1 FROM "Dispute" d WHERE d."orderId" = lp."orderId" AND d."status" NOT IN ('CLOSED', 'SETTLED'))`;
  }

  private async maybeNotifyNearby(order: Order, userId: string, straight: number): Promise<void> {
    const city = await this.prisma.city.findUniqueOrThrow({ where: { id: order.cityId } });
    const threshold = this.settings.get('NEARBY_NOTIFY_M', { countryCode: city.countryCode, cityId: order.cityId, categoryId: order.categoryId });
    if (straight > threshold) return;
    const first = await this.redis.set(`trk:nearby:${order.id}`, '1', 'EX', 86_400, 'NX');
    if (first !== 'OK') return;
    await this.prisma.orderEvent.create({ data: { orderId: order.id, type: 'worker_nearby', actorId: userId, payload: { distanceM: straight } } });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.notifications.notify(order.clientId, {
      key: 'push.worker_nearby',
      orderId: order.id,
      priority: 'high',
      params: (locale) => ({
        name: this.pii.decrypt(user.firstNameEnc) ?? 'Masterio Pro',
        distance: `${threshold} ${translate(locale, 'units.m')}`,
      }),
    });
  }

  private async orderLocation(orderId: string): Promise<{ lat: number; lng: number }> {
    const [geo] = await this.prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
      SELECT ST_Y("location"::geometry) AS lat, ST_X("location"::geometry) AS lng FROM "Order" WHERE "id" = ${orderId}::uuid`;
    if (!geo) throw new AppException('NOT_FOUND');
    return geo;
  }
}
