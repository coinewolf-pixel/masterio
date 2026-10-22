import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { addressSchema, geoAutocompleteSchema, geoReverseSchema, monthSchema, uuidSchema } from '@masterio/shared';
import { AppException } from '../common/app-exception';
import { CurrentUser, Roles, type AuthUser } from '../common/auth';
import { geoPoint } from '../common/geo';
import { RateLimiter } from '../common/rate-limiter';
import { ApiZodBody, ZBody, ZodPipe, ZQuery } from '../common/zod';
import { GeoService } from '../geo/geo.service';
import { HistoryService } from '../history/history.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { PII_CIPHER, PiiCipher } from '../common/crypto';
import { Inject } from '@nestjs/common';

const MAX_ADDRESSES = 20;

function currentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Всё, что нужно приложению клиента: адреса, поиск адресов, настройки города, история, чёрный список. */
@ApiTags('client')
@ApiBearerAuth()
@Controller()
export class ClientController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geo: GeoService,
    private readonly limiter: RateLimiter,
    private readonly settings: SettingsService,
    private readonly history: HistoryService,
    @Inject(PII_CIPHER) private readonly pii: PiiCipher,
  ) {}

  // ── Сохранённые адреса ──
  @Get('me/addresses')
  @Roles('CLIENT')
  async addresses(@CurrentUser() user: AuthUser) {
    return this.prisma.$queryRaw<Array<{ id: string; label: string | null; formatted: string; details: string | null; placeId: string | null; lat: number; lng: number }>>`
      SELECT "id", "label", "formatted", "details", "placeId", ST_Y("location"::geometry) AS lat, ST_X("location"::geometry) AS lng
      FROM "Address" WHERE "userId" = ${user.id}::uuid ORDER BY "createdAt" DESC`;
  }

  @Post('me/addresses')
  @Roles('CLIENT')
  @ApiZodBody(addressSchema)
  async addAddress(@CurrentUser() user: AuthUser, @ZBody(addressSchema) body: z.infer<typeof addressSchema>) {
    const count = await this.prisma.address.count({ where: { userId: user.id } });
    if (count >= MAX_ADDRESSES) throw new AppException('VALIDATION_FAILED', { addresses: `max ${MAX_ADDRESSES}` });
    const [row] = await this.prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "Address" ("id", "userId", "label", "formatted", "placeId", "location", "details", "createdAt")
      VALUES (gen_random_uuid(), ${user.id}::uuid, ${body.label ?? null}, ${body.formatted}, ${body.placeId ?? null}, ${geoPoint(body.location)}, ${body.details ?? null}, now())
      RETURNING "id"`;
    return { id: row?.id, ...body };
  }

  @Delete('me/addresses/:id')
  @HttpCode(204)
  @Roles('CLIENT')
  async deleteAddress(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    const res = await this.prisma.address.deleteMany({ where: { id, userId: user.id } });
    if (res.count === 0) throw new AppException('NOT_FOUND');
  }

  // ── Поиск адресов (Google Places через сервер) ──
  @Get('geo/autocomplete')
  async autocomplete(@CurrentUser() user: AuthUser, @ZQuery(geoAutocompleteSchema) q: z.infer<typeof geoAutocompleteSchema>) {
    await this.limiter.hit(`geo:${user.id}`, 120, 60);
    const lang = await this.locale(user.id);
    const near = q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : undefined;
    return this.geo.autocomplete(q.q, lang, near, q.session);
  }

  @Get('geo/place/:placeId')
  async place(@CurrentUser() user: AuthUser, @Param('placeId') placeId: string, @Query('session') session?: string) {
    await this.limiter.hit(`geo:${user.id}`, 120, 60);
    return this.geo.place(placeId, await this.locale(user.id), session);
  }

  @Get('geo/reverse')
  async reverse(@CurrentUser() user: AuthUser, @ZQuery(geoReverseSchema) q: z.infer<typeof geoReverseSchema>) {
    await this.limiter.hit(`geo:${user.id}`, 120, 60);
    return this.geo.reverse(q.lat, q.lng, await this.locale(user.id));
  }

  // ── Настройки города для приложения (флаги запуска, радиусы, отмены) ──
  @Get('app-config')
  async appConfig(@CurrentUser() user: AuthUser, @Query('cityId', new ZodPipe(uuidSchema.optional())) cityId?: string) {
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { countryCode: true } });
    const city = cityId ? await this.prisma.city.findUnique({ where: { id: cityId } }) : null;
    const ctx = { countryCode: city?.countryCode ?? me.countryCode, cityId: city?.id ?? null };
    return {
      cashEnabled: this.settings.get('CASH_ENABLED', ctx),
      cardPaymentsEnabled: this.settings.get('CARD_PAYMENTS_ENABLED', ctx),
      clientCardRequiredForCash: this.settings.get('CLIENT_CARD_REQUIRED_FOR_CASH', ctx),
      commissionPercent: this.settings.get('COMMISSION_PERCENT', ctx),
      searchRadiusM: this.settings.get('SEARCH_RADIUS_M', ctx),
      maxSearchRadiusM: this.settings.get('MAX_SEARCH_RADIUS_M', ctx),
      freeCancelMinutes: this.settings.get('FREE_CANCEL_MINUTES', ctx),
      travelCompensationCents: this.settings.get('TRAVEL_COMPENSATION', ctx),
      offerTtlSeconds: this.settings.get('OFFER_TTL_SECONDS', ctx),
      emergencyNumber: city?.emergencyNumber ?? '112',
      currency: city?.currency ?? null,
    };
  }

  // ── История заказов клиента ──
  @Get('client/history')
  @Roles('CLIENT')
  async clientHistory(@CurrentUser() user: AuthUser, @Query('month', new ZodPipe(monthSchema.optional())) month?: string) {
    const { from, to } = this.history.monthRange(month ?? currentMonth());
    const orders = await this.prisma.order.findMany({
      where: { clientId: user.id, createdAt: { gte: from, lt: to } },
      orderBy: { createdAt: 'desc' },
      include: { category: { select: { id: true, code: true, names: true } }, worker: { include: { user: true } } },
    });
    const items = orders.map((o) => {
      const paid = ['CONFIRMED', 'AUTO_CONFIRMED', 'CLOSED'].includes(o.status) ? (o.cashReportedByClientCents ?? o.confirmedAmountCents ?? 0) : 0;
      return {
        id: o.id,
        number: o.number,
        createdAt: o.createdAt,
        status: o.status,
        category: o.category,
        paymentMethod: o.paymentMethod,
        currency: o.currency,
        amountCents: o.confirmedAmountCents,
        paidCents: paid,
        workerName: o.worker ? this.pii.decrypt(o.worker.user.firstNameEnc) : null,
        addressFormatted: o.addressFormatted,
        description: o.description,
      };
    });
    const done = items.filter((i) => i.paidCents > 0);
    return {
      month: month ?? currentMonth(),
      summary: { ordersCount: done.length, spentCents: done.reduce((s, i) => s + i.paidCents, 0), currency: done[0]?.currency ?? null },
      items,
    };
  }

  // ── Чёрный список мастеров ──
  @Get('me/blacklist')
  @Roles('CLIENT')
  blacklist(@CurrentUser() user: AuthUser) {
    return this.prisma.clientBlacklist.findMany({ where: { clientId: user.id }, orderBy: { createdAt: 'desc' } });
  }

  @Post('me/blacklist/:workerId')
  @HttpCode(204)
  @Roles('CLIENT')
  async block(@CurrentUser() user: AuthUser, @Param('workerId', ParseUUIDPipe) workerId: string): Promise<void> {
    // в чёрный список можно добавить только мастера, который выполнял ваш заказ
    const had = await this.prisma.order.count({ where: { clientId: user.id, workerId } });
    if (had === 0) throw new AppException('NOT_FOUND');
    await this.prisma.clientBlacklist.upsert({
      where: { clientId_workerId: { clientId: user.id, workerId } },
      create: { clientId: user.id, workerId },
      update: {},
    });
  }

  @Delete('me/blacklist/:workerId')
  @HttpCode(204)
  @Roles('CLIENT')
  async unblock(@CurrentUser() user: AuthUser, @Param('workerId', ParseUUIDPipe) workerId: string): Promise<void> {
    await this.prisma.clientBlacklist.deleteMany({ where: { clientId: user.id, workerId } });
  }

  private async locale(userId: string): Promise<string> {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { locale: true } });
    return u.locale;
  }
}
