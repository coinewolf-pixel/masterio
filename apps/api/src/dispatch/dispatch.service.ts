import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  RT_EVENTS,
  translate,
  type OfferClosedPayload,
  type OfferClosedReason,
  type OfferNewPayload,
  type OrderStatusPayload,
} from '@masterio/shared';
import { AppException } from '../common/app-exception';
import type { Offer } from '../generated/prisma/client';
import { JobsService, jobId } from '../jobs/jobs.service';
import { MatchingService } from '../matching/matching.service';
import { NotificationsService } from '../notifications/notifications.service';
import { isUniqueViolation, PrismaService } from '../prisma/prisma.service';
import { TeamsService } from '../teams/teams.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SettingsService } from '../settings/settings.service';
import { PII_CIPHER, PiiCipher } from '../common/crypto';
import { Inject } from '@nestjs/common';

const JOB_OFFER_EXPIRE = 'offer-expire';
const JOB_DISPATCH_TIMEOUT = 'dispatch-timeout';

type OfferNextOutcome = { kind: 'offered'; offers: Offer[] } | { kind: 'waiting' } | { kind: 'no_workers' } | { kind: 'inactive' };

/**
 * Рассылка заказа по одному мастеру за раз (раздел 11).
 * - Предложение получает первый в очереди, срок OFFER_TTL_SECONDS; таймер — отложенная задача BullMQ.
 * - Отказ или истечение → сразу следующий. Отказавшимся явно заказ больше не приходит.
 * - Круг 2..MAX_ROUNDS — снова по тем, кто не ответил. BATCH_SIZE > 1 — несколько предложений сразу.
 * - Принятие атомарно: UPDATE ... WHERE status='SEARCHING' AND version=… — побеждает ровно один.
 * - После перезапуска recover() восстанавливает таймеры и продолжает рассылку.
 */
@Injectable()
export class DispatchService implements OnModuleInit {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingService,
    private readonly settings: SettingsService,
    private readonly jobs: JobsService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
    @Inject(PII_CIPHER) private readonly pii: PiiCipher,
    private readonly teams: TeamsService,
  ) {}

  onModuleInit(): void {
    this.jobs.register(JOB_OFFER_EXPIRE, async (data) => this.expireOffer(data.offerId ?? ''));
    this.jobs.register(JOB_DISPATCH_TIMEOUT, async (data) => this.dispatchTimeout(data.orderId ?? ''));
  }

  /** Запуск поиска мастера для заказа в статусе DRAFT/NO_WORKERS. */
  async start(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { city: true } });
    const ctx = { countryCode: order.city.countryCode, cityId: order.cityId, categoryId: order.categoryId };
    const updated = await this.prisma.order.updateMany({
      where: { id: orderId, status: { in: ['DRAFT', 'NO_WORKERS'] } },
      data: { status: 'SEARCHING', dispatchRound: 1, dispatchStartedAt: new Date() },
    });
    if (updated.count === 0) throw new AppException('INVALID_STATUS_TRANSITION');
    await this.prisma.orderEvent.create({ data: { orderId, type: 'dispatch_started', payload: { radiusM: order.searchRadiusM } } });
    const timeoutMs = this.settings.get('MAX_DISPATCH_MINUTES', ctx) * 60_000;
    await this.jobs.cancel(jobId('timeout', orderId));
    await this.jobs.schedule(JOB_DISPATCH_TIMEOUT, { orderId }, { delayMs: timeoutMs, jobId: jobId('timeout', orderId) });
    this.emitStatus(order.clientId, orderId, 'SEARCHING');
    await this.offerNext(orderId);
  }

  /** Создать следующее предложение (или несколько при BATCH_SIZE > 1). Безопасно вызывать повторно. */
  async offerNext(orderId: string, attempt = 0): Promise<OfferNextOutcome> {
    let outcome: OfferNextOutcome;
    try {
      outcome = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`dispatch:${orderId}`}))`;
        const order = await tx.order.findUnique({ where: { id: orderId }, include: { city: true } });
        if (!order || order.status !== 'SEARCHING') return { kind: 'inactive' } as const;
        const ctx = { countryCode: order.city.countryCode, cityId: order.cityId, categoryId: order.categoryId };
        const batch = this.settings.get('BATCH_SIZE', ctx);
        const maxRounds = this.settings.get('MAX_ROUNDS', ctx);
        const ttlSeconds = this.settings.get('OFFER_TTL_SECONDS', ctx);

        const offers = await tx.offer.findMany({ where: { orderId }, select: { workerId: true, round: true, status: true } });
        const pending = offers.filter((o) => o.status === 'PENDING').length;
        const need = batch - pending;
        if (need <= 0) return { kind: 'waiting' } as const;

        // Явно отказавшимся и тем, кто принял и потом отменил, заказ больше не предлагается
        const neverAgain = new Set(offers.filter((o) => o.status === 'DECLINED' || o.status === 'ACCEPTED').map((o) => o.workerId));
        const [geo] = await tx.$queryRaw<Array<{ lat: number; lng: number }>>`
          SELECT ST_Y("location"::geometry) AS lat, ST_X("location"::geometry) AS lng FROM "Order" WHERE "id" = ${orderId}::uuid`;
        if (!geo) return { kind: 'inactive' } as const;
        const base = {
          cityId: order.cityId,
          categoryId: order.categoryId,
          countryCode: order.city.countryCode,
          currency: order.currency,
          location: { lat: geo.lat, lng: geo.lng },
          radiusM: order.searchRadiusM,
          clientId: order.clientId,
        };

        let round = order.dispatchRound;
        for (;;) {
          const offeredThisRound = offers.filter((o) => o.round === round).map((o) => o.workerId);
          const candidates = await this.matching.findCandidates({
            ...base,
            excludeWorkerIds: [...neverAgain, ...offeredThisRound],
            limit: need,
          });
          if (candidates.length > 0) {
            const expiresAt = new Date(Date.now() + ttlSeconds * 1_000);
            const startPos = offeredThisRound.length;
            const created: Offer[] = [];
            for (const [i, c] of candidates.entries()) {
              created.push(
                await tx.offer.create({
                  data: {
                    orderId,
                    workerId: c.workerId,
                    round,
                    position: startPos + i + 1,
                    score: c.score,
                    distanceM: c.distanceM,
                    expiresAt,
                  },
                }),
              );
            }
            if (round !== order.dispatchRound) await tx.order.update({ where: { id: orderId }, data: { dispatchRound: round } });
            return { kind: 'offered', offers: created } as const;
          }
          if (pending > 0) return { kind: 'waiting' } as const;
          if (round >= maxRounds) break;
          const anyone = await this.matching.findCandidates({ ...base, excludeWorkerIds: [...neverAgain], limit: 1 });
          if (anyone.length === 0) break;
          round += 1;
        }

        await tx.order.update({ where: { id: orderId }, data: { status: 'NO_WORKERS', dispatchRound: round } });
        await tx.orderEvent.create({ data: { orderId, type: 'no_workers', payload: { round } } });
        return { kind: 'no_workers' } as const;
      });
    } catch (error) {
      // Мастер успел получить предложение по другому заказу (уникальный индекс) — пересчитываем очередь
      if (isUniqueViolation(error) && attempt < 3) return this.offerNext(orderId, attempt + 1);
      throw error;
    }

    if (outcome.kind === 'offered') {
      for (const offer of outcome.offers) await this.announceOffer(offer);
    } else if (outcome.kind === 'no_workers') {
      await this.onNoWorkers(orderId);
    }
    return outcome;
  }

  /** Принятие предложения мастером. Ровно один победитель даже при одновременных запросах. */
  async accept(offerId: string, workerId: string): Promise<{ orderId: string }> {
    const offer = await this.prisma.offer.findUnique({ where: { id: offerId } });
    if (!offer || offer.workerId !== workerId) throw new AppException('NOT_FOUND');
    if (offer.status !== 'PENDING') {
      throw new AppException(offer.status === 'TAKEN_BY_OTHER' ? 'ORDER_ALREADY_TAKEN' : 'OFFER_NOT_ACTIVE');
    }
    // Решает время получения запроса сервером, а не отсчёт в приложении
    if (offer.expiresAt.getTime() <= Date.now()) {
      await this.expireOffer(offer.id);
      throw new AppException('OFFER_EXPIRED');
    }

    let otherPending: Offer[] = [];
    let clientId = '';
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { id: offer.orderId } });
      if (order.status !== 'SEARCHING') throw new AppException('ORDER_ALREADY_TAKEN');
      // сколько заказов мастер или команда ведут одновременно: по одному на свободного исполнителя
      await this.teams.lock(tx, workerId);
      const active = await tx.order.count({ where: { workerId, status: { in: ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] } } });
      if (active >= (await this.teams.capacity(workerId, tx))) throw new AppException('WORKER_HAS_ACTIVE_ORDER');
      clientId = order.clientId;
      const won = await tx.order.updateMany({
        where: { id: order.id, status: 'SEARCHING', version: order.version },
        data: { status: 'ACCEPTED', workerId, acceptedAt: new Date(), version: { increment: 1 } },
      });
      if (won.count === 0) throw new AppException('ORDER_ALREADY_TAKEN');
      const mine = await tx.offer.updateMany({
        where: { id: offer.id, status: 'PENDING', expiresAt: { gt: new Date() } },
        data: { status: 'ACCEPTED', respondedAt: new Date() },
      });
      if (mine.count === 0) throw new AppException('OFFER_EXPIRED');
      otherPending = await tx.offer.findMany({ where: { orderId: order.id, status: 'PENDING' } });
      await tx.offer.updateMany({
        where: { orderId: order.id, status: 'PENDING' },
        data: { status: 'TAKEN_BY_OTHER', respondedAt: new Date() },
      });
      await tx.orderEvent.create({ data: { orderId: order.id, type: 'offer_accepted', actorId: workerId, payload: { offerId: offer.id } } });
    });

    await this.jobs.cancel(jobId('offer', offer.id));
    await this.jobs.cancel(jobId('timeout', offer.orderId));
    for (const other of otherPending) {
      await this.jobs.cancel(jobId('offer', other.id));
      await this.closeOffer(other, 'taken');
    }
    this.emitStatus(clientId, offer.orderId, 'ACCEPTED', workerId);
    const worker = await this.prisma.user.findUniqueOrThrow({ where: { id: workerId } });
    await this.notifications.notify(clientId, {
      key: 'push.order_accepted',
      orderId: offer.orderId,
      params: { name: this.pii.decrypt(worker.firstNameEnc) ?? 'Masterio Pro' },
      priority: 'high',
    });
    void this.refreshAcceptRate(workerId);
    await this.teams.afterAccept(await this.prisma.order.findUniqueOrThrow({ where: { id: offer.orderId } }));
    return { orderId: offer.orderId };
  }

  async decline(offerId: string, workerId: string): Promise<void> {
    const offer = await this.prisma.offer.findUnique({ where: { id: offerId } });
    if (!offer || offer.workerId !== workerId) throw new AppException('NOT_FOUND');
    const res = await this.prisma.offer.updateMany({
      where: { id: offerId, status: 'PENDING' },
      data: { status: 'DECLINED', respondedAt: new Date() },
    });
    if (res.count === 0) throw new AppException('OFFER_NOT_ACTIVE');
    await this.jobs.cancel(jobId('offer', offerId));
    await this.prisma.orderEvent.create({ data: { orderId: offer.orderId, type: 'offer_declined', actorId: workerId, payload: { offerId } } });
    await this.closeOffer(offer, 'declined');
    void this.refreshAcceptRate(workerId);
    await this.offerNext(offer.orderId);
  }

  /** Обработчик таймера: предложение не принято за OFFER_TTL_SECONDS. */
  async expireOffer(offerId: string): Promise<void> {
    if (!offerId) return;
    const res = await this.prisma.offer.updateMany({
      where: { id: offerId, status: 'PENDING', expiresAt: { lte: new Date(Date.now() + 1_000) } },
      data: { status: 'EXPIRED', respondedAt: new Date() },
    });
    if (res.count === 0) return;
    const offer = await this.prisma.offer.findUniqueOrThrow({ where: { id: offerId } });
    await this.prisma.orderEvent.create({ data: { orderId: offer.orderId, type: 'offer_expired', payload: { offerId, workerId: offer.workerId } } });
    await this.closeOffer(offer, 'expired');
    void this.refreshAcceptRate(offer.workerId);
    await this.offerNext(offer.orderId);
  }

  /** Заказ отменён или снят — все висящие предложения закрываются у мастеров. */
  async cancelOffers(orderId: string): Promise<void> {
    const pending = await this.prisma.offer.findMany({ where: { orderId, status: 'PENDING' } });
    await this.prisma.offer.updateMany({ where: { orderId, status: 'PENDING' }, data: { status: 'CANCELLED', respondedAt: new Date() } });
    for (const offer of pending) {
      await this.jobs.cancel(jobId('offer', offer.id));
      await this.closeOffer(offer, 'cancelled');
    }
    await this.jobs.cancel(jobId('timeout', orderId));
  }

  async dispatchTimeout(orderId: string): Promise<void> {
    if (!orderId) return;
    const res = await this.prisma.order.updateMany({ where: { id: orderId, status: 'SEARCHING' }, data: { status: 'NO_WORKERS' } });
    if (res.count === 0) return;
    await this.prisma.orderEvent.create({ data: { orderId, type: 'dispatch_timeout' } });
    await this.cancelOffers(orderId);
    await this.onNoWorkers(orderId);
  }

  /**
   * Восстановление после перезапуска: просроченные предложения закрываются, потерянные таймеры
   * создаются заново, заказы без активного предложения продолжают рассылку.
   */
  async recover(): Promise<{ expired: number; rescheduled: number; resumed: number }> {
    let expired = 0;
    let rescheduled = 0;
    let resumed = 0;
    const pending = await this.prisma.offer.findMany({ where: { status: 'PENDING' } });
    for (const offer of pending) {
      if (offer.expiresAt.getTime() <= Date.now()) {
        await this.expireOffer(offer.id);
        expired += 1;
      } else if (!(await this.jobs.exists(jobId('offer', offer.id)))) {
        await this.jobs.schedule(JOB_OFFER_EXPIRE, { offerId: offer.id }, { delayMs: offer.expiresAt.getTime() - Date.now(), jobId: jobId('offer', offer.id) });
        rescheduled += 1;
      }
    }
    const searching = await this.prisma.order.findMany({ where: { status: 'SEARCHING' }, include: { city: true } });
    for (const order of searching) {
      const ctx = { countryCode: order.city.countryCode, cityId: order.cityId, categoryId: order.categoryId };
      const deadline = (order.dispatchStartedAt ?? order.createdAt).getTime() + this.settings.get('MAX_DISPATCH_MINUTES', ctx) * 60_000;
      if (deadline <= Date.now()) {
        await this.dispatchTimeout(order.id);
        continue;
      }
      if (!(await this.jobs.exists(jobId('timeout', order.id)))) {
        await this.jobs.schedule(JOB_DISPATCH_TIMEOUT, { orderId: order.id }, { delayMs: deadline - Date.now(), jobId: jobId('timeout', order.id) });
      }
      const hasPending = await this.prisma.offer.count({ where: { orderId: order.id, status: 'PENDING' } });
      if (hasPending === 0) {
        await this.offerNext(order.id);
        resumed += 1;
      }
    }
    if (expired + rescheduled + resumed > 0) this.logger.log(`recovered dispatch: expired ${expired}, rescheduled ${rescheduled}, resumed ${resumed}`);
    return { expired, rescheduled, resumed };
  }

  private async announceOffer(offer: Offer): Promise<void> {
    await this.jobs.schedule(JOB_OFFER_EXPIRE, { offerId: offer.id }, { delayMs: offer.expiresAt.getTime() - Date.now(), jobId: jobId('offer', offer.id) });
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: offer.orderId }, include: { category: true } });
    const payload: OfferNewPayload = {
      offerId: offer.id,
      orderId: order.id,
      categoryId: order.categoryId,
      categoryCode: order.category.code,
      distanceM: offer.distanceM,
      description: order.description,
      paymentMethod: order.paymentMethod,
      isUrgent: order.category.isUrgent,
      expiresAt: offer.expiresAt.toISOString(),
      serverNow: new Date().toISOString(),
    };
    this.realtime.toUser(offer.workerId, RT_EVENTS.offerNew, payload);
    const names = order.category.names as Record<string, string>;
    const seconds = Math.max(1, Math.round((offer.expiresAt.getTime() - Date.now()) / 1_000));
    await this.notifications.notify(offer.workerId, {
      key: 'push.offer_new',
      orderId: order.id,
      priority: 'high',
      collapseKey: `offer-${offer.id}`,
      persist: false,
      data: { offerId: offer.id, expiresAt: payload.expiresAt },
      params: (locale) => ({
        category: names[locale] ?? names.en ?? order.category.code,
        distance: formatDistance(offer.distanceM, locale),
        seconds,
      }),
    });
  }

  private async closeOffer(offer: Offer, reason: OfferClosedReason): Promise<void> {
    const payload: OfferClosedPayload = { offerId: offer.id, orderId: offer.orderId, reason };
    this.realtime.toUser(offer.workerId, RT_EVENTS.offerClosed, payload);
    // «Отзыв» push: тот же collapseKey заменяет карточку, приложение закрывает её по data-сообщению
    await this.notifications.notify(offer.workerId, {
      key: 'push.offer_closed',
      orderId: offer.orderId,
      collapseKey: `offer-${offer.id}`,
      silent: true,
      persist: false,
      data: { offerId: offer.id, reason },
    });
  }

  private async onNoWorkers(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    await this.jobs.cancel(jobId('timeout', orderId));
    this.emitStatus(order.clientId, orderId, 'NO_WORKERS');
    this.realtime.toUser(order.clientId, RT_EVENTS.dispatchNoWorkers, {
      orderId,
      options: ['expand_radius', 'wait', 'cancel_free'],
    });
    await this.notifications.notify(order.clientId, { key: 'push.no_workers', orderId });
  }

  private emitStatus(clientId: string, orderId: string, status: string, workerId?: string): void {
    const payload: OrderStatusPayload = { orderId, status, at: new Date().toISOString() };
    this.realtime.toUser(clientId, RT_EVENTS.orderStatus, payload);
    if (workerId) this.realtime.toUser(workerId, RT_EVENTS.orderStatus, payload);
    this.realtime.toAdmins(RT_EVENTS.orderStatus, payload);
  }

  /** Процент принятых: принятые / (принятые + отказы + истёкшие) по последним 200 предложениям. */
  private async refreshAcceptRate(workerId: string): Promise<void> {
    try {
      const recent = await this.prisma.offer.findMany({
        where: { workerId, status: { in: ['ACCEPTED', 'DECLINED', 'EXPIRED'] } },
        orderBy: { sentAt: 'desc' },
        take: 200,
        select: { status: true },
      });
      if (recent.length === 0) return;
      const accepted = recent.filter((o) => o.status === 'ACCEPTED').length;
      await this.prisma.workerProfile.update({
        where: { userId: workerId },
        data: { acceptRate: (accepted / recent.length).toFixed(4) },
      });
    } catch (error) {
      this.logger.warn(`acceptRate refresh failed: ${String(error)}`);
    }
  }
}

function formatDistance(meters: number, locale: string): string {
  if (meters < 1_000) return `${meters} ${translate(locale, 'units.m')}`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(meters / 1_000)} ${translate(locale, 'units.km')}`;
}
