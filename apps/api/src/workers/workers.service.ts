import { Injectable } from '@nestjs/common';
import { RT_EVENTS, type LatLng } from '@masterio/shared';
import { AppException } from '../common/app-exception';
import { geoPoint } from '../common/geo';
import { MatchingService } from '../matching/matching.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SettingsService } from '../settings/settings.service';
import { TeamsService } from '../teams/teams.service';
import { WalletService } from '../wallet/wallet.service';

export type IneligibleReason = 'kyc' | 'blocked' | 'balance' | 'debt' | 'active_order' | 'offline' | 'no_categories' | 'no_cities' | 'team_member';

@Injectable()
export class WorkersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly settings: SettingsService,
    private readonly matching: MatchingService,
    private readonly realtime: RealtimeService,
    private readonly teams: TeamsService,
  ) {}

  async goOnline(workerId: string, location: LatLng) {
    // участник команды работает только по назначениям руководителя
    await this.teams.assertNotMember(workerId);
    await this.updateLocation(workerId, location);
    await this.prisma.workerProfile.update({ where: { userId: workerId }, data: { isOnline: true } });
    return this.eligibility(workerId);
  }

  async goOffline(workerId: string) {
    const pending = await this.prisma.offer.count({ where: { workerId, status: 'PENDING' } });
    if (pending > 0) throw new AppException('INVALID_STATUS_TRANSITION', { reason: 'answer_pending_offer_first' });
    await this.prisma.workerProfile.update({ where: { userId: workerId }, data: { isOnline: false } });
    this.realtime.toAdmins(RT_EVENTS.adminMap, { kind: 'offline', userId: workerId });
    return this.eligibility(workerId);
  }

  async updateLocation(workerId: string, p: LatLng): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE "WorkerProfile" SET "lastLocation" = ${geoPoint(p)}, "lastLocationAt" = now()
      WHERE "userId" = ${workerId}::uuid`;
    // живая карта CRM: позиция мастера на линии (координаты исполнителя заказа идут отдельным событием)
    this.realtime.toAdmins(RT_EVENTS.adminMap, { kind: 'worker', userId: workerId, lat: p.lat, lng: p.lng, at: new Date().toISOString() });
  }

  /** Почему мастер сейчас не получает заказы — показывается на главном экране Masterio Pro. */
  async eligibility(workerId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: workerId },
      include: { worker: { include: { categories: true, cities: { include: { city: true } } } } },
    });
    const w = user.worker;
    if (!w) throw new AppException('FORBIDDEN');
    const currency = await this.wallet.workerCurrency(this.prisma, workerId);
    const pockets = await this.wallet.pockets(this.prisma, workerId, currency);
    const firstCity = w.cities[0];
    const ctx = { countryCode: user.countryCode, cityId: firstCity?.cityId ?? null, categoryId: null };
    const threshold = this.matching.accessThreshold({
      countryCode: user.countryCode,
      cityId: firstCity?.cityId ?? '',
      categoryId: w.categories[0]?.categoryId ?? '',
    });
    const debtLimit = this.settings.get('CASH_DEBT_LIMIT', ctx);
    const activeOrders = await this.prisma.order.findMany({
      where: { workerId, status: { in: ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] } },
      select: { id: true, assignments: { where: { isCurrent: true }, select: { teamMember: { select: { userId: true } } } } },
      orderBy: { acceptedAt: 'asc' },
    });
    const capacity = await this.teams.capacity(workerId);
    // заказ, который мастер ведёт сам (не передан участнику команды)
    const own = activeOrders.find((o) => o.assignments.every((a) => a.teamMember.userId === workerId)) ?? null;
    // участник команды: заказ, на который его назначил руководитель (по нему идёт геопозиция)
    const assigned = own
      ? null
      : await this.prisma.orderAssignment.findFirst({
          where: { isCurrent: true, teamMember: { userId: workerId }, order: { status: { in: ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] } } },
          select: { orderId: true },
        });
    const activeOrder = own ?? (assigned ? { id: assigned.orderId } : null);
    const member = await this.teams.membership(workerId);

    const reasons: IneligibleReason[] = [];
    if (user.status !== 'ACTIVE' && user.status !== 'WARNED') reasons.push('blocked');
    if (w.kycStatus !== 'VERIFIED') reasons.push('kyc');
    if (w.categories.length === 0) reasons.push('no_categories');
    if (w.cities.length === 0) reasons.push('no_cities');
    if (pockets.debtCents > debtLimit) reasons.push('debt');
    if (pockets.topupCents + pockets.promoCents < threshold) reasons.push('balance');
    if (member) reasons.push('team_member');
    if (activeOrders.length >= capacity) reasons.push('active_order');
    if (!w.isOnline) reasons.push('offline');

    return {
      eligible: reasons.length === 0,
      reasons,
      isOnline: w.isOnline,
      accessBalanceCents: pockets.topupCents + pockets.promoCents,
      thresholdCents: threshold,
      debtCents: pockets.debtCents,
      debtLimitCents: debtLimit,
      currency,
      activeOrderId: activeOrder?.id ?? null,
      activeOrderIds: activeOrders.map((o) => o.id),
      capacity,
    };
  }

  async setCategories(workerId: string, ids: string[]) {
    const found = await this.prisma.category.count({ where: { id: { in: ids }, isActive: true } });
    if (found !== new Set(ids).size) throw new AppException('VALIDATION_FAILED', { ids: 'unknown category' });
    await this.prisma.$transaction([
      this.prisma.workerCategory.deleteMany({ where: { workerId } }),
      this.prisma.workerCategory.createMany({ data: [...new Set(ids)].map((categoryId) => ({ workerId, categoryId })) }),
    ]);
    return { ids: [...new Set(ids)] };
  }

  async setCities(workerId: string, ids: string[]) {
    const found = await this.prisma.city.count({ where: { id: { in: ids }, isActive: true } });
    if (found !== new Set(ids).size) throw new AppException('VALIDATION_FAILED', { ids: 'unknown city' });
    await this.prisma.$transaction([
      this.prisma.workerCity.deleteMany({ where: { workerId } }),
      this.prisma.workerCity.createMany({ data: [...new Set(ids)].map((cityId) => ({ workerId, cityId })) }),
    ]);
    return { ids: [...new Set(ids)] };
  }

  async updateProfile(
    workerId: string,
    body: { type?: 'INDEPENDENT' | 'COMPANY'; companyName?: string; companyRegNumber?: string; preferredRadiusM?: number | null; autoUseEarnings?: boolean },
  ) {
    if (body.preferredRadiusM) {
      const max = this.settings.get('MAX_SEARCH_RADIUS_M');
      if (body.preferredRadiusM > max) throw new AppException('VALIDATION_FAILED', { preferredRadiusM: `max ${max}` });
    }
    if (body.type === 'COMPANY' && !body.companyName) {
      const current = await this.prisma.workerProfile.findUniqueOrThrow({ where: { userId: workerId } });
      if (!current.companyName) throw new AppException('VALIDATION_FAILED', { companyName: 'required for COMPANY' });
    }
    return this.prisma.workerProfile.update({
      where: { userId: workerId },
      data: {
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.companyName !== undefined ? { companyName: body.companyName } : {}),
        ...(body.companyRegNumber !== undefined ? { companyRegNumber: body.companyRegNumber } : {}),
        ...(body.preferredRadiusM !== undefined ? { preferredRadiusM: body.preferredRadiusM } : {}),
        ...(body.autoUseEarnings !== undefined ? { autoUseEarnings: body.autoUseEarnings } : {}),
      },
      select: { type: true, companyName: true, companyRegNumber: true, preferredRadiusM: true, autoUseEarnings: true },
    });
  }
}
