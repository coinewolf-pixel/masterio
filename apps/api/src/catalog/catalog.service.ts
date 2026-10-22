import { Injectable } from '@nestjs/common';
import type { LatLng } from '@masterio/shared';
import { AppException } from '../common/app-exception';
import { MatchingService } from '../matching/matching.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingService,
    private readonly settings: SettingsService,
  ) {}

  async cities() {
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; countryCode: string; names: unknown; timezone: string; currency: string; emergencyNumber: string; lat: number | null; lng: number | null }>
    >`SELECT "id", "countryCode", "names", "timezone", "currency", "emergencyNumber",
             ST_Y("center"::geometry) AS lat, ST_X("center"::geometry) AS lng
      FROM "City" WHERE "isActive" = true ORDER BY "countryCode", "id"`;
    return rows.map((r) => ({ ...r, center: r.lat === null || r.lng === null ? null : { lat: r.lat, lng: r.lng } }));
  }

  async categories(cityId?: string) {
    const groups = await this.prisma.categoryGroup.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        categories: {
          where: {
            isActive: true,
            ...(cityId ? { cities: { some: { cityId, isActive: true } } } : {}),
          },
          orderBy: { sortOrder: 'asc' },
          select: { id: true, code: true, names: true, icon: true, isUrgent: true, requiresLicense: true, requiresInsurance: true },
        },
      },
    });
    return groups.filter((g) => g.categories.length > 0);
  }

  async availability(cityId: string, categoryId: string, location: LatLng) {
    const cc = await this.prisma.cityCategory.findUnique({
      where: { cityId_categoryId: { cityId, categoryId } },
      include: { city: true },
    });
    if (!cc || !cc.isActive || !cc.city.isActive) throw new AppException('CITY_OR_CATEGORY_UNAVAILABLE');
    const ctx = { countryCode: cc.city.countryCode, cityId, categoryId };
    const radiusM = this.settings.get('SEARCH_RADIUS_M', ctx);
    const maxRadiusM = this.settings.get('MAX_SEARCH_RADIUS_M', ctx);
    const base = { cityId, categoryId, countryCode: cc.city.countryCode, currency: cc.city.currency, location };
    const nearby = await this.matching.findCandidates({ ...base, radiusM });
    const wider = nearby.length > 0 ? nearby : await this.matching.findCandidates({ ...base, radiusM: maxRadiusM });
    return {
      radiusM,
      availableCount: nearby.length,
      nearestDistanceM: nearby[0]?.distanceM ?? null,
      suggestExpandRadius: nearby.length === 0 && wider.length > 0,
      maxRadiusM,
      availableInMaxRadius: wider.length,
    };
  }
}
