import { Injectable } from '@nestjs/common';
import { LOCALES, type ConsentContext, type LegalAudienceName } from '@masterio/shared';
import { AppException } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import type { AuthUser } from '../common/auth';
import type { LegalAudience, Locale, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface LegalItem {
  versionId: string;
  documentId: string;
  audience: LegalAudienceName;
  version: string;
  locale: string;
  publishedAt: Date | null;
}

/**
 * Юридические документы с версиями по странам и языкам (раздел 18.6) и согласия пользователей (версия, дата, время,
 * страна, контекст). Тексты пишет и проверяет юрист: опубликовать редакцию без отметки о проверке нельзя,
 * опубликованную — изменить нельзя (только новая версия).
 */
@Injectable()
export class LegalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Какие документы нужно принять (required) и какие показать для сведения (notices) в данном контексте. */
  private async audiences(user: { id: string; role: string }, context: ConsentContext): Promise<{ required: LegalAudience[]; notices: LegalAudience[] }> {
    if (user.role === 'CLIENT') {
      if (context === 'registration') return { required: ['CLIENT', 'PRIVACY_POLICY'], notices: [] };
      if (context === 'order') return { required: [], notices: ['DISPUTE_POLICY', 'INCIDENT_POLICY'] };
      return { required: [], notices: [] };
    }
    if (user.role === 'WORKER') {
      const w = await this.prisma.workerProfile.findUnique({ where: { userId: user.id }, select: { type: true } });
      // участник чужой команды принимает условия для команд, а не условия самостоятельного мастера
      const member = await this.prisma.teamMember.count({ where: { userId: user.id, isActive: true, role: { not: 'LEADER' } } });
      if (member > 0) {
        if (context === 'registration') return { required: ['TEAM_MEMBER', 'PRIVACY_POLICY'], notices: ['INCIDENT_POLICY'] };
        return { required: [], notices: ['INCIDENT_POLICY'] };
      }
      if (context === 'registration') return { required: [w?.type === 'COMPANY' ? 'COMPANY' : 'INDEPENDENT_WORKER', 'PRIVACY_POLICY'], notices: ['INSURANCE_REQUIREMENTS', 'DISPUTE_POLICY', 'INCIDENT_POLICY'] };
      if (context === 'topup') return { required: ['TOPUP_TERMS'], notices: [] };
      if (context === 'add_helper') return { required: ['TEAM_MEMBER'], notices: [] };
      return { required: [], notices: ['DISPUTE_POLICY', 'INCIDENT_POLICY'] };
    }
    return { required: [], notices: [] };
  }

  /** Последняя опубликованная версия каждого документа страны на языке пользователя (иначе английская). */
  private async latest(countryCode: string, audiences: LegalAudience[], locale: string): Promise<LegalItem[]> {
    if (audiences.length === 0) return [];
    const docs = await this.prisma.legalDocument.findMany({
      where: { countryCode, audience: { in: audiences } },
      include: { versions: { where: { publishedAt: { not: null } }, orderBy: [{ publishedAt: 'desc' }, { version: 'desc' }] } },
    });
    const out: LegalItem[] = [];
    for (const d of docs) {
      const newest = d.versions[0]?.version;
      if (!newest) continue;
      const same = d.versions.filter((v) => v.version === newest);
      const v = same.find((x) => x.locale === locale) ?? same.find((x) => x.locale === 'en') ?? same[0];
      if (v) out.push({ versionId: v.id, documentId: d.id, audience: d.audience, version: v.version, locale: v.locale, publishedAt: v.publishedAt });
    }
    return out;
  }

  async forContext(authUser: AuthUser, context: ConsentContext) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: authUser.id }, select: { id: true, role: true, countryCode: true, locale: true } });
    const { required, notices } = await this.audiences(user, context);
    const req = await this.latest(user.countryCode, required, user.locale);
    const accepted = await this.acceptedPairs(user.id, req.map((r) => r.documentId));
    return {
      countryCode: user.countryCode,
      required: req.filter((r) => !accepted.has(`${r.documentId}|${r.version}`)),
      accepted: req.filter((r) => accepted.has(`${r.documentId}|${r.version}`)),
      notices: await this.latest(user.countryCode, notices, user.locale),
    };
  }

  /** Принятая версия документа засчитывается независимо от языка, на котором её прочитали. */
  private async acceptedPairs(userId: string, documentIds: string[]): Promise<Set<string>> {
    if (documentIds.length === 0) return new Set();
    const rows = await this.prisma.userConsent.findMany({
      where: { userId, withdrawnAt: null, version: { documentId: { in: documentIds } } },
      select: { version: { select: { documentId: true, version: true } } },
    });
    return new Set(rows.map((r) => `${r.version.documentId}|${r.version.version}`));
  }

  /** Сервер не пускает дальше без обязательных согласий (если документы для страны опубликованы). */
  async assertConsented(authUser: AuthUser, context: ConsentContext): Promise<void> {
    const { required } = await this.forContext(authUser, context);
    if (required.length > 0) throw new AppException('CONSENT_REQUIRED', { context, documents: required.map((r) => r.audience) });
  }

  async text(versionId: string) {
    const v = await this.prisma.legalDocumentVersion.findUnique({ where: { id: versionId }, include: { document: true } });
    if (!v || !v.publishedAt) throw new AppException('NOT_FOUND');
    return { versionId: v.id, audience: v.document.audience, countryCode: v.document.countryCode, version: v.version, locale: v.locale, body: v.body, publishedAt: v.publishedAt };
  }

  async accept(authUser: AuthUser, context: ConsentContext, versionIds: string[], meta: { ip?: string; userAgent?: string }) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: authUser.id }, select: { id: true, role: true, countryCode: true } });
    const { required, notices } = await this.audiences(user, context);
    const applicable = new Set<string>([...required, ...notices]);
    const versions = await this.prisma.legalDocumentVersion.findMany({ where: { id: { in: versionIds } }, include: { document: true } });
    if (versions.length !== new Set(versionIds).size) throw new AppException('NOT_FOUND');
    for (const v of versions) {
      if (!v.publishedAt || v.document.countryCode !== user.countryCode || !applicable.has(v.document.audience)) {
        throw new AppException('VALIDATION_FAILED', { versionId: v.id });
      }
    }
    const already = await this.acceptedPairs(user.id, versions.map((v) => v.documentId));
    for (const v of versions) {
      if (already.has(`${v.documentId}|${v.version}`)) continue;
      await this.prisma.userConsent.create({
        data: { userId: user.id, versionId: v.id, countryCode: user.countryCode, context, ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null },
      });
    }
    return this.forContext(authUser, context);
  }

  async myConsents(userId: string) {
    const rows = await this.prisma.userConsent.findMany({ where: { userId }, orderBy: { acceptedAt: 'desc' }, include: { version: { include: { document: true } } } });
    return rows.map((c) => ({ id: c.id, audience: c.version.document.audience, version: c.version.version, locale: c.version.locale, versionId: c.versionId, context: c.context, countryCode: c.countryCode, acceptedAt: c.acceptedAt, withdrawnAt: c.withdrawnAt }));
  }

  // ───────────── CRM ─────────────

  async adminList() {
    const docs = await this.prisma.legalDocument.findMany({
      orderBy: [{ countryCode: 'asc' }, { audience: 'asc' }],
      include: { versions: { select: { id: true, version: true, locale: true, publishedAt: true, publishedById: true, legalReviewedBy: true, createdAt: true, _count: { select: { consents: true } } }, orderBy: [{ createdAt: 'desc' }] } },
    });
    return docs.map((d) => {
      const byVersion = new Map<string, { version: string; publishedAt: Date | null; legalReviewedBy: string | null; publishedById: string | null; createdAt: Date; locales: Array<{ id: string; locale: string }>; consents: number }>();
      for (const v of d.versions) {
        const entry = byVersion.get(v.version) ?? { version: v.version, publishedAt: v.publishedAt, legalReviewedBy: v.legalReviewedBy, publishedById: v.publishedById, createdAt: v.createdAt, locales: [], consents: 0 };
        entry.locales.push({ id: v.id, locale: v.locale });
        entry.consents += v._count.consents;
        byVersion.set(v.version, entry);
      }
      return { id: d.id, audience: d.audience, countryCode: d.countryCode, versions: [...byVersion.values()] };
    });
  }

  async adminVersion(versionId: string) {
    const v = await this.prisma.legalDocumentVersion.findUnique({ where: { id: versionId }, include: { document: true } });
    if (!v) throw new AppException('NOT_FOUND');
    const siblings = await this.prisma.legalDocumentVersion.findMany({ where: { documentId: v.documentId, version: v.version }, orderBy: { locale: 'asc' } });
    return { documentId: v.documentId, audience: v.document.audience, countryCode: v.document.countryCode, version: v.version, publishedAt: v.publishedAt, legalReviewedBy: v.legalReviewedBy, bodies: Object.fromEntries(siblings.map((s) => [s.locale, { id: s.id, body: s.body }])) };
  }

  /** Новая редакция на всех 5 языках — черновик; публикуется отдельным действием. */
  async createVersion(admin: AuthUser, input: { audience: LegalAudienceName; countryCode: string; version: string; bodies: Record<(typeof LOCALES)[number], string>; legalReviewedBy: string }) {
    return this.prisma.$transaction(async (tx) => {
      const doc = await tx.legalDocument.upsert({
        where: { audience_countryCode: { audience: input.audience, countryCode: input.countryCode } },
        update: {},
        create: { audience: input.audience, countryCode: input.countryCode },
      });
      if (await tx.legalDocumentVersion.findFirst({ where: { documentId: doc.id, version: input.version } })) throw new AppException('ALREADY_EXISTS');
      for (const locale of LOCALES) {
        await tx.legalDocumentVersion.create({ data: { documentId: doc.id, version: input.version, locale: locale as Locale, body: input.bodies[locale], legalReviewedBy: input.legalReviewedBy } });
      }
      await this.audit.log({ adminId: admin.id, action: 'legal.create', entityType: 'LegalDocument', entityId: doc.id, after: { audience: input.audience, countryCode: input.countryCode, version: input.version } as Prisma.InputJsonValue }, tx);
      return { documentId: doc.id, version: input.version };
    });
  }

  async publish(admin: AuthUser, documentId: string, version: string) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.legalDocumentVersion.findMany({ where: { documentId, version } });
      if (rows.length === 0) throw new AppException('NOT_FOUND');
      if (rows.some((r) => r.publishedAt)) throw new AppException('ALREADY_EXISTS', { reason: 'already published' });
      if (rows.length < LOCALES.length || rows.some((r) => !r.legalReviewedBy)) throw new AppException('VALIDATION_FAILED', { reason: 'all 5 languages and a legal review are required' });
      await tx.legalDocumentVersion.updateMany({ where: { documentId, version }, data: { publishedAt: new Date(), publishedById: admin.id } });
      await this.audit.log({ adminId: admin.id, action: 'legal.publish', entityType: 'LegalDocument', entityId: documentId, after: { version } }, tx);
      return { documentId, version, published: true };
    });
  }

  /** Неопубликованный черновик можно удалить; опубликованный — нет (на него ссылаются согласия). */
  async deleteDraft(admin: AuthUser, documentId: string, version: string) {
    const rows = await this.prisma.legalDocumentVersion.findMany({ where: { documentId, version } });
    if (rows.length === 0) throw new AppException('NOT_FOUND');
    if (rows.some((r) => r.publishedAt)) throw new AppException('FORBIDDEN', { reason: 'published versions are immutable' });
    await this.prisma.legalDocumentVersion.deleteMany({ where: { documentId, version } });
    await this.audit.log({ adminId: admin.id, action: 'legal.delete_draft', entityType: 'LegalDocument', entityId: documentId, after: { version } });
    return { deleted: true };
  }
}
