import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import type { registerDocumentSchema } from '@masterio/shared';
import { AppException } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import { isAdminWith, type AuthUser } from '../common/auth';
import { PII_CIPHER, PiiCipher } from '../common/crypto';
import type { Document } from '../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/**
 * Документы мастера и участников команды: удостоверение, селфи, лицензии, страховки (разделы 6, 18.3, 19.3).
 * Файлы лежат в закрытом бакете; смотреть их могут только владелец и сотрудники с нужной ролью, каждый просмотр — в журнал.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    @Inject(PII_CIPHER) private readonly pii: PiiCipher,
  ) {}

  async register(user: AuthUser, input: z.infer<typeof registerDocumentSchema>): Promise<Document> {
    if (user.role !== 'WORKER') throw new AppException('FORBIDDEN');
    if (!this.storage.isOwnedKey(input.fileKey, 'document', user.id)) throw new AppException('FORBIDDEN', { reason: 'foreign_file' });
    if (!(await this.storage.exists(input.fileKey))) throw new AppException('VALIDATION_FAILED', { fileKey: 'file was not uploaded' });
    if (input.kind === 'LICENSE') {
      const category = await this.prisma.category.findUnique({ where: { id: input.categoryId } });
      if (!category) throw new AppException('VALIDATION_FAILED', { categoryId: 'unknown' });
    }
    const user$ = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    // документ участника привязывается к его участию в команде (руководитель — к своей строке LEADER)
    const member =
      (await this.prisma.teamMember.findFirst({ where: { userId: user.id, isActive: true, role: { not: 'LEADER' } } })) ??
      (await this.prisma.teamMember.findFirst({ where: { userId: user.id, isActive: true } }));

    return this.prisma.$transaction(async (tx) => {
      const doc = await tx.document.create({
        data: {
          ownerId: user.id,
          teamMemberId: member?.id ?? null,
          kind: input.kind,
          fileKey: input.fileKey,
          validUntil: input.validUntil ? new Date(input.validUntil) : input.insurance ? new Date(input.insurance.validUntil) : null,
        },
      });
      if (input.kind === 'LICENSE' && input.categoryId) {
        await tx.license.create({
          data: {
            documentId: doc.id,
            categoryId: input.categoryId,
            number: input.number ?? null,
            issuer: input.issuer ?? null,
            countryCode: user$.countryCode,
          },
        });
      }
      if (input.kind === 'INSURANCE' && input.insurance) {
        await tx.insurancePolicy.create({
          data: {
            documentId: doc.id,
            insurerName: input.insurance.insurerName,
            policyNumber: input.insurance.policyNumber,
            validFrom: new Date(input.insurance.validFrom),
            validUntil: new Date(input.insurance.validUntil),
            coveredRisks: input.insurance.coveredRisks,
          },
        });
      }
      return doc;
    });
  }

  async listOwn(userId: string) {
    return this.prisma.document.findMany({
      where: { ownerId: userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        kind: true,
        status: true,
        rejectReason: true,
        validUntil: true,
        createdAt: true,
        license: { select: { categoryId: true, number: true } },
        insurance: { select: { insurerName: true, policyNumber: true, validUntil: true, coveredRisks: true } },
      },
    });
  }

  /** Временная ссылка на файл: владелец или модератор/поддержка/superadmin; каждый просмотр пишется в журнал. */
  async viewUrl(viewer: AuthUser, documentId: string, ip?: string) {
    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc) throw new AppException('NOT_FOUND');
    const isOwner = doc.ownerId === viewer.id;
    const isStaff = isAdminWith(viewer, 'MODERATOR', 'SUPPORT');
    if (!isOwner && !isStaff) throw new AppException('NOT_FOUND');
    await this.prisma.documentAccessLog.create({
      data: { documentId, viewerId: viewer.id, purpose: isOwner ? 'owner' : 'review', ip: ip ?? null },
    });
    return this.storage.viewUrl(doc.fileKey);
  }

  async queue(status: 'NOT_VERIFIED' | 'VERIFIED' | 'REJECTED' | 'EXPIRED' = 'NOT_VERIFIED') {
    const rows = await this.prisma.document.findMany({
      where: { status },
      orderBy: { createdAt: 'asc' },
      take: 200,
      include: {
        license: true,
        insurance: true,
        owner: { select: { id: true, phone: true, countryCode: true, firstNameEnc: true, lastNameEnc: true } },
        teamMember: { select: { role: true, isActive: true, team: { select: { name: true, ownerId: true } } } },
      },
    });
    // имя владельца для очереди проверки; ключ файла не отдаётся — просмотр только через view-url с записью в журнал
    return rows.map(({ fileKey: _fileKey, owner: { firstNameEnc, lastNameEnc, ...owner }, teamMember, ...doc }) => ({
      ...doc,
      // документ участника команды: в очереди видно, чья это команда и какая роль
      team: teamMember && teamMember.role !== 'LEADER' ? { name: teamMember.team.name, ownerId: teamMember.team.ownerId, role: teamMember.role, isActive: teamMember.isActive } : null,
      owner: { ...owner, name: [this.pii.decrypt(firstNameEnc), this.pii.decrypt(lastNameEnc)].filter(Boolean).join(' ') || null },
    }));
  }

  /**
   * Решение модератора. Когда подтверждены и удостоверение, и селфи — KYC мастера считается пройденным.
   * Отклонение требует причины; мастер получает уведомление и может загрузить документ заново.
   */
  async review(admin: AuthUser, documentId: string, decision: 'approve' | 'reject', reason?: string) {
    if (!isAdminWith(admin, 'MODERATOR')) throw new AppException('FORBIDDEN');
    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc) throw new AppException('NOT_FOUND');
    if (doc.status !== 'NOT_VERIFIED') throw new AppException('INVALID_STATUS_TRANSITION');
    if (decision === 'approve' && doc.validUntil && doc.validUntil < new Date()) {
      throw new AppException('VALIDATION_FAILED', { validUntil: 'document already expired' });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id: documentId },
        data: {
          status: decision === 'approve' ? 'VERIFIED' : 'REJECTED',
          rejectReason: decision === 'reject' ? (reason ?? null) : null,
          reviewedById: admin.id,
          reviewedAt: new Date(),
        },
      });
      await tx.documentAccessLog.create({ data: { documentId, viewerId: admin.id, purpose: `decision:${decision}` } });
      await this.audit.log(
        { adminId: admin.id, action: `document.${decision}`, entityType: 'Document', entityId: documentId, after: { reason: reason ?? null } },
        tx,
      );
      if (doc.kind === 'ID_DOCUMENT' || doc.kind === 'SELFIE') {
        const worker = await tx.workerProfile.findUnique({ where: { userId: doc.ownerId } });
        if (worker) {
          if (decision === 'reject') {
            await tx.workerProfile.update({ where: { userId: doc.ownerId }, data: { kycStatus: 'REJECTED' } });
          } else {
            const verified = await tx.document.findMany({
              where: { ownerId: doc.ownerId, kind: { in: ['ID_DOCUMENT', 'SELFIE'] }, status: 'VERIFIED' },
              select: { kind: true },
            });
            const kinds = new Set(verified.map((d) => d.kind));
            if (kinds.has('ID_DOCUMENT') && kinds.has('SELFIE')) {
              await tx.workerProfile.update({ where: { userId: doc.ownerId }, data: { kycStatus: 'VERIFIED' } });
            }
          }
          // статус участника команды повторяет статус его проверки личности (виден руководителю и в CRM)
          const now = await tx.workerProfile.findUniqueOrThrow({ where: { userId: doc.ownerId }, select: { kycStatus: true } });
          await tx.teamMember.updateMany({ where: { userId: doc.ownerId }, data: { kycStatus: now.kycStatus } });
        }
      }
    });
    await this.notifications.notify(doc.ownerId, {
      key: decision === 'approve' ? 'push.document_approved' : 'push.document_rejected',
      params: (locale) => ({ document: documentLabel(doc.kind, locale), reason: reason ?? '' }),
    });
    return this.prisma.document.findUniqueOrThrow({ where: { id: documentId } });
  }
}

const LABELS: Record<string, Record<string, string>> = {
  ID_DOCUMENT: { en: 'ID document', ru: 'удостоверение личности', de: 'Ausweis', es: 'documento de identidad', hy: 'անձը հաստատող փաստաթուղթ' },
  SELFIE: { en: 'selfie', ru: 'селфи', de: 'Selfie', es: 'selfie', hy: 'սելֆի' },
  LICENSE: { en: 'license', ru: 'лицензия', de: 'Lizenz', es: 'licencia', hy: 'լիցենզիա' },
  INSURANCE: { en: 'insurance policy', ru: 'страховой полис', de: 'Versicherungspolice', es: 'póliza de seguro', hy: 'ապահովագրական պոլիս' },
  COMPANY_REGISTRATION: { en: 'company registration', ru: 'регистрация компании', de: 'Firmenregistrierung', es: 'registro de empresa', hy: 'ընկերության գրանցում' },
  QUALIFICATION: { en: 'qualification certificate', ru: 'документ о квалификации', de: 'Qualifikationsnachweis', es: 'certificado de cualificación', hy: 'որակավորման վկայական' },
  OTHER: { en: 'document', ru: 'документ', de: 'Dokument', es: 'documento', hy: 'փաստաթուղթ' },
};

function documentLabel(kind: string, locale: string): string {
  const l = LABELS[kind] ?? LABELS.OTHER;
  return l?.[locale] ?? l?.en ?? kind;
}
