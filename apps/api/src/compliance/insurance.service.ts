import { Injectable, OnModuleInit } from '@nestjs/common';
import type { InsuranceRuleInput } from '@masterio/shared';
import { AppException } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import type { AuthUser } from '../common/auth';
import { Prisma, type WorkerType } from '../generated/prisma/client';
import { JobsService } from '../jobs/jobs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

export interface InsuranceRequirement {
  required: boolean;
  requiredRisks: string[];
  /** откуда взялось требование: правило страны или флаг услуги */
  source: 'rule' | 'category' | 'none';
  ruleId: string | null;
}

const REMINDER_DAYS = [30, 14, 3] as const;

/**
 * Требования к страховке по стране, услуге и типу исполнителя (разделы 18.3, 19.4) и сроки документов:
 * напоминания за 30, 14 и 3 дня, статус «Истёк срок действия» и автоматическая приостановка заказов
 * в услугах, где полис обязателен (подбор мастеров проверяет действующий полис).
 */
@Injectable()
export class InsuranceService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.jobs.register('documents-expiry', async () => {
      await this.runExpiry();
    });
  }

  /** Самое точное правило: услуга+тип → услуга → тип → вся страна; нет правил — флаг «нужна страховка» у услуги. */
  async requirement(countryCode: string, categoryId: string, workerType: WorkerType): Promise<InsuranceRequirement> {
    const rules = await this.prisma.insuranceRule.findMany({
      where: { countryCode, OR: [{ categoryId }, { categoryId: null }], AND: [{ OR: [{ workerType }, { workerType: null }] }] },
    });
    const rank = (r: { categoryId: string | null; workerType: WorkerType | null }) => (r.categoryId ? 2 : 0) + (r.workerType ? 1 : 0);
    const best = [...rules].sort((a, b) => rank(b) - rank(a))[0];
    if (best) return { required: best.required, requiredRisks: best.requiredRisks, source: 'rule', ruleId: best.id };
    const cat = await this.prisma.category.findUnique({ where: { id: categoryId }, select: { requiresInsurance: true } });
    return { required: cat?.requiresInsurance ?? false, requiredRisks: [], source: cat?.requiresInsurance ? 'category' : 'none', ruleId: null };
  }

  /** Для подбора: требование отдельно для независимого мастера и для компании. */
  async requirementsForDispatch(countryCode: string, categoryId: string): Promise<Record<WorkerType, InsuranceRequirement>> {
    const [independent, company] = await Promise.all([this.requirement(countryCode, categoryId, 'INDEPENDENT'), this.requirement(countryCode, categoryId, 'COMPANY')]);
    return { INDEPENDENT: independent, COMPANY: company };
  }

  /** Что требуется от мастера по его услугам и городам и есть ли у него подходящий действующий полис. */
  async forWorker(workerId: string) {
    const w = await this.prisma.workerProfile.findUnique({
      where: { userId: workerId },
      include: { categories: { include: { category: true } }, cities: { include: { city: true } } },
    });
    if (!w) throw new AppException('NOT_FOUND');
    const policies = await this.prisma.insurancePolicy.findMany({
      where: { document: { ownerId: workerId, status: 'VERIFIED' }, validUntil: { gt: new Date() } },
      select: { coveredRisks: true, validUntil: true, insurerName: true },
    });
    const countries = [...new Set(w.cities.map((c) => c.city.countryCode))];
    const items = [];
    for (const countryCode of countries) {
      for (const wc of w.categories) {
        const req = await this.requirement(countryCode, wc.categoryId, w.type);
        if (!req.required) continue;
        const ok = policies.some((p) => req.requiredRisks.every((r) => p.coveredRisks.includes(r)));
        const rule = req.ruleId ? await this.prisma.insuranceRule.findUnique({ where: { id: req.ruleId }, select: { note: true } }) : null;
        items.push({ countryCode, categoryId: wc.categoryId, categoryNames: wc.category.names, requiredRisks: req.requiredRisks, satisfied: ok, note: rule?.note ?? null });
      }
    }
    return { items, policies };
  }

  // ───────────── Сроки документов ─────────────

  async runExpiry(now = new Date()): Promise<{ reminded: number; expired: number }> {
    let reminded = 0;
    const horizon = new Date(now.getTime() + REMINDER_DAYS[0] * 86_400_000);
    const soon = await this.prisma.insurancePolicy.findMany({
      where: { validUntil: { gt: now, lte: horizon }, document: { status: 'VERIFIED' } },
      include: { document: { select: { ownerId: true } } },
    });
    for (const p of soon) {
      const daysLeft = Math.ceil((p.validUntil.getTime() - now.getTime()) / 86_400_000);
      // ближайший порог, по которому ещё не напоминали (за 30, 14 и 3 дня)
      const due = REMINDER_DAYS.filter((d) => daysLeft <= d && !p.remindersSent.includes(d));
      if (due.length === 0) continue;
      await this.prisma.insurancePolicy.update({ where: { id: p.id }, data: { remindersSent: [...new Set([...p.remindersSent, ...due])] } });
      await this.notifications.notify(p.document.ownerId, { key: 'push.insurance_expiring', params: { days: daysLeft } });
      reminded++;
    }

    // истёкшие лицензии и полисы: статус «Истёк срок действия», заказы в обязательных услугах прекращаются
    const expiredDocs = await this.prisma.document.findMany({
      where: {
        status: 'VERIFIED',
        OR: [{ validUntil: { lte: now } }, { insurance: { validUntil: { lte: now } } }],
      },
      select: { id: true, ownerId: true, kind: true },
    });
    for (const d of expiredDocs) {
      const res = await this.prisma.document.updateMany({ where: { id: d.id, status: 'VERIFIED' }, data: { status: 'EXPIRED' } });
      if (res.count === 0) continue;
      await this.notifications.notify(d.ownerId, { key: 'push.document_expired' });
    }
    return { reminded, expired: expiredDocs.length };
  }

  // ───────────── CRM ─────────────

  list() {
    return this.prisma.insuranceRule.findMany({ orderBy: [{ countryCode: 'asc' }, { categoryId: 'asc' }, { workerType: 'asc' }] });
  }

  async upsert(admin: AuthUser, input: InsuranceRuleInput, id?: string) {
    const category = input.categoryId ? await this.prisma.category.findUnique({ where: { id: input.categoryId } }) : null;
    if (input.categoryId && !category) throw new AppException('VALIDATION_FAILED', { categoryId: 'unknown' });
    const data = {
      countryCode: input.countryCode,
      categoryId: input.categoryId,
      workerType: input.workerType,
      required: input.required,
      requiredRisks: input.requiredRisks,
      note: input.note ? (input.note as Prisma.InputJsonValue) : Prisma.DbNull,
    };
    const duplicate = await this.prisma.insuranceRule.findFirst({
      where: { countryCode: input.countryCode, categoryId: input.categoryId, workerType: input.workerType, ...(id ? { id: { not: id } } : {}) },
    });
    if (duplicate) throw new AppException('ALREADY_EXISTS');
    const before = id ? await this.prisma.insuranceRule.findUnique({ where: { id } }) : null;
    if (id && !before) throw new AppException('NOT_FOUND');
    const rule = id ? await this.prisma.insuranceRule.update({ where: { id }, data }) : await this.prisma.insuranceRule.create({ data });
    await this.audit.log({
      adminId: admin.id,
      action: id ? 'insurance_rule.update' : 'insurance_rule.create',
      entityType: 'InsuranceRule',
      entityId: rule.id,
      ...(before ? { before: before as unknown as Prisma.InputJsonValue } : {}),
      after: input as unknown as Prisma.InputJsonValue,
    });
    return rule;
  }

  async remove(admin: AuthUser, id: string) {
    const before = await this.prisma.insuranceRule.findUnique({ where: { id } });
    if (!before) throw new AppException('NOT_FOUND');
    await this.prisma.insuranceRule.delete({ where: { id } });
    await this.audit.log({ adminId: admin.id, action: 'insurance_rule.delete', entityType: 'InsuranceRule', entityId: id, before: before as unknown as Prisma.InputJsonValue });
    return { deleted: true };
  }
}
