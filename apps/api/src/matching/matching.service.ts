import { Injectable } from '@nestjs/common';
import { commissionFor, percentOf, percentToBp, type LatLng } from '@masterio/shared';
import { geoPoint } from '../common/geo';
import { InsuranceService } from '../compliance/insurance.service';
import { ReviewAccounts } from '../auth/review';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

export interface MatchParams {
  cityId: string;
  categoryId: string;
  countryCode: string;
  currency: string;
  location: LatLng;
  radiusM: number;
  clientId?: string;
  excludeWorkerIds?: string[];
  limit?: number;
}

export interface Candidate {
  workerId: string;
  distanceM: number;
  score: number;
}

interface Row {
  workerId: string;
  distanceM: number;
  ratingAvg: string;
  acceptRate: string;
  cancelRate: string;
}

/**
 * Очередь мастеров для заказа (раздел 10): онлайн, свежая геопозиция, KYC, категория и город,
 * лицензия/страховка если требуются, в радиусе (PostGIS), баланс выше порога и долг в пределах лимита,
 * нет активного заказа и висящего предложения, не в чёрном списке клиента. Порядок — по весам из настроек.
 */
@Injectable()
export class MatchingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly insurance: InsuranceService,
    private readonly review: ReviewAccounts,
  ) {}

  /** Порог баланса (пополнение + промо) для получения заказов в этой категории и городе. */
  accessThreshold(ctx: { countryCode: string; cityId: string; categoryId: string }): number {
    const min = this.settings.get('CASH_MIN_BALANCE', ctx);
    const commissionBp = percentToBp(this.settings.get('COMMISSION_PERCENT', ctx));
    const expected = commissionFor(this.settings.get('EXPECTED_ORDER_AMOUNT', ctx), commissionBp);
    const withBuffer = expected + percentOf(expected, this.settings.get('CASH_COMMISSION_BUFFER_BP', ctx));
    return Math.max(min, withBuffer);
  }

  async findCandidates(p: MatchParams): Promise<Candidate[]> {
    const ctx = { countryCode: p.countryCode, cityId: p.cityId, categoryId: p.categoryId };
    const category = await this.prisma.category.findUniqueOrThrow({ where: { id: p.categoryId } });
    const staleSeconds = this.settings.get('WORKER_ONLINE_STALE_SECONDS', ctx);
    const threshold = this.accessThreshold(ctx);
    const debtLimit = this.settings.get('CASH_DEBT_LIMIT', ctx);
    const point = geoPoint(p.location);
    const excluded = p.excludeWorkerIds ?? [];
    const clientId = p.clientId ?? null;
    // аккаунты проверки магазинами изолированы: тестовый клиент видит только тестовых мастеров и наоборот
    const reviewPhones = [...this.review.phones];
    const client = clientId && reviewPhones.length > 0 ? await this.prisma.user.findUnique({ where: { id: clientId }, select: { phone: true } }) : null;
    const reviewClient = this.review.isReview(client?.phone);
    // страховка: правила страны по услуге и типу исполнителя (независимый мастер / компания), иначе флаг услуги
    const ins = await this.insurance.requirementsForDispatch(p.countryCode, p.categoryId);
    const insIndependent = ins.INDEPENDENT.required;
    const insCompany = ins.COMPANY.required;
    const risksIndependent = ins.INDEPENDENT.requiredRisks;
    const risksCompany = ins.COMPANY.requiredRisks;

    const rows = await this.prisma.$queryRaw<Row[]>`
      WITH bal AS (
        SELECT a."ownerId" AS wid,
          SUM(CASE WHEN a."type" IN ('WORKER_TOPUP', 'WORKER_PROMO') THEN b."balanceCents" ELSE 0 END) AS access,
          SUM(CASE WHEN a."type" = 'WORKER_DEBT' THEN -b."balanceCents" ELSE 0 END) AS debt
        FROM "LedgerAccount" a
        JOIN "AccountBalance" b ON b."accountId" = a."id"
        WHERE a."currency" = ${p.currency} AND a."type" IN ('WORKER_TOPUP', 'WORKER_PROMO', 'WORKER_DEBT')
        GROUP BY a."ownerId"
      )
      SELECT w."userId" AS "workerId",
             ST_Distance(w."lastLocation", ${point})::int AS "distanceM",
             w."ratingAvg"::text AS "ratingAvg", w."acceptRate"::text AS "acceptRate", w."cancelRate"::text AS "cancelRate"
      FROM "WorkerProfile" w
      JOIN "User" u ON u."id" = w."userId"
      JOIN "WorkerCategory" wc ON wc."workerId" = w."userId" AND wc."categoryId" = ${p.categoryId}::uuid
      JOIN "WorkerCity" wci ON wci."workerId" = w."userId" AND wci."cityId" = ${p.cityId}::uuid
      LEFT JOIN bal ON bal.wid = w."userId"
      WHERE w."isOnline" = true
        AND w."lastLocation" IS NOT NULL
        AND w."lastLocationAt" > now() - make_interval(secs => ${staleSeconds})
        AND w."kycStatus" = 'VERIFIED'
        AND u."status" IN ('ACTIVE', 'WARNED')
        AND ST_DWithin(w."lastLocation", ${point}, LEAST(${p.radiusM}, COALESCE(w."preferredRadiusM", ${p.radiusM})))
        -- участник чужой команды заказы напрямую не получает (только назначения руководителя)
        AND NOT EXISTS (
          SELECT 1 FROM "TeamMember" tm WHERE tm."userId" = w."userId" AND tm."isActive" = true AND tm."role" <> 'LEADER')
        -- одновременно не больше заказов, чем свободных исполнителей: руководитель + проверенные участники
        AND (SELECT count(*) FROM "Order" o WHERE o."workerId" = w."userId"
               AND o."status" IN ('ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'))
            < 1 + (SELECT count(*) FROM "TeamMember" tm
                     JOIN "Team" t ON t."id" = tm."teamId"
                     JOIN "User" mu ON mu."id" = tm."userId"
                     JOIN "WorkerProfile" mw ON mw."userId" = tm."userId"
                   WHERE t."ownerId" = w."userId" AND tm."isActive" = true AND tm."role" <> 'LEADER'
                     AND mu."status" IN ('ACTIVE', 'WARNED') AND mw."kycStatus" = 'VERIFIED')
        AND NOT EXISTS (SELECT 1 FROM "Offer" f WHERE f."workerId" = w."userId" AND f."status" = 'PENDING')
        AND COALESCE(bal.access, 0) >= ${threshold}
        AND COALESCE(bal.debt, 0) <= ${debtLimit}
        AND (${category.requiresLicense} = false OR EXISTS (
          SELECT 1 FROM "License" l JOIN "Document" d ON d."id" = l."documentId"
          WHERE d."ownerId" = w."userId" AND l."categoryId" = ${p.categoryId}::uuid
            AND d."status" = 'VERIFIED' AND (d."validUntil" IS NULL OR d."validUntil" > now())))
        AND ((CASE WHEN w."type" = 'COMPANY' THEN ${insCompany}::boolean ELSE ${insIndependent}::boolean END) = false OR EXISTS (
          SELECT 1 FROM "InsurancePolicy" ip JOIN "Document" d ON d."id" = ip."documentId"
          WHERE d."ownerId" = w."userId" AND d."status" = 'VERIFIED' AND ip."validUntil" > now()
            AND ip."coveredRisks" @> (CASE WHEN w."type" = 'COMPANY' THEN ${risksCompany}::text[] ELSE ${risksIndependent}::text[] END)))
        AND NOT EXISTS (
          SELECT 1 FROM "ClientBlacklist" cb WHERE cb."clientId" = ${clientId}::uuid AND cb."workerId" = w."userId")
        AND NOT (w."userId" = ANY(${excluded}::uuid[]))
        AND ${reviewClient}::boolean = COALESCE(u."phone" = ANY(${reviewPhones}::text[]), false)`;

    const weights = this.settings.get('QUEUE_WEIGHTS', ctx);
    const scored = rows.map((r) => {
      const distanceScore = 1 - Math.min(r.distanceM, p.radiusM) / p.radiusM;
      const score =
        weights.distance * distanceScore +
        weights.rating * (Number(r.ratingAvg) / 5) +
        weights.acceptRate * Number(r.acceptRate) +
        weights.cancelRate * (1 - Number(r.cancelRate));
      return { workerId: r.workerId, distanceM: r.distanceM, score: Math.round(score * 10_000) / 10_000 };
    });
    scored.sort((a, b) => b.score - a.score || a.distanceM - b.distanceM || a.workerId.localeCompare(b.workerId));
    return p.limit ? scored.slice(0, p.limit) : scored;
  }
}
