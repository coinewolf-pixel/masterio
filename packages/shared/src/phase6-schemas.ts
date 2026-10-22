import { z } from 'zod';
import { latLngSchema, monthSchema } from './schemas';

/** Схемы фазы 6: споры, «клиент не вышел», инциденты, поддержка, юридические документы, страховки, бонусы, приватность. */

const fileKeys = z.array(z.string().min(10).max(300)).max(10).default([]);
const text = (max: number) => z.string().trim().min(3).max(max);

/** Причины, с которыми сторона может открыть спор сама. Автоматические (расхождение наличных, несоответствие исполнителя) создаёт система. */
export const CLIENT_DISPUTE_REASONS = [
  'POOR_QUALITY',
  'UNFINISHED',
  'PROPERTY_DAMAGE',
  'ACCIDENT_INJURY',
  'PRICE_DISAGREEMENT',
  'WORKER_NO_SHOW',
  'REFUND_REFUSED',
  'FRAUD_SUSPECTED',
  'PERFORMER_MISMATCH',
  'INSURANCE_OR_LICENSE',
  'OTHER',
] as const;
export const WORKER_DISPUTE_REASONS = ['PAYMENT_REFUSED', 'PRICE_DISAGREEMENT', 'PROPERTY_DAMAGE', 'ACCIDENT_INJURY', 'FRAUD_SUSPECTED', 'OTHER'] as const;
export const DISPUTE_REASONS = [...new Set([...CLIENT_DISPUTE_REASONS, ...WORKER_DISPUTE_REASONS, 'CLIENT_NO_SHOW', 'CASH_AMOUNT_MISMATCH'] as const)];
export type DisputeReasonName = (typeof DISPUTE_REASONS)[number];

export const DISPUTE_STATUSES = ['OPEN', 'AWAITING_RESPONSE', 'UNDER_REVIEW', 'ESCALATED', 'SETTLED', 'UNRESOLVED_REFERRED', 'CLOSED'] as const;
export type DisputeStatusName = (typeof DISPUTE_STATUSES)[number];
/** Спор завершён: новые объяснения и действия не принимаются. */
export const DISPUTE_FINAL: readonly DisputeStatusName[] = ['SETTLED', 'UNRESOLVED_REFERRED', 'CLOSED'];

export const openDisputeSchema = z.object({
  reason: z.enum([...CLIENT_DISPUTE_REASONS, ...WORKER_DISPUTE_REASONS] as [string, ...string[]]),
  description: text(2_000),
  photoKeys: fileKeys,
});
export type OpenDisputeInput = z.infer<typeof openDisputeSchema>;

export const disputeResponseSchema = z.object({
  text: text(2_000),
  photoKeys: fileKeys,
});

/** «Клиент не вышел»: после ожидания на месте, с фото адреса и геопозицией (раздел 12). */
export const noShowSchema = z.object({
  location: latLngSchema,
  photoKey: z.string().min(10).max(300),
  comment: z.string().trim().max(1_000).optional(),
});

export const DISPUTE_RESOLUTIONS = ['agreement', 'in_favor_client', 'in_favor_worker', 'partial', 'no_fault'] as const;
export const adminDisputeActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('assign'), assigneeId: z.uuid().nullable() }),
  z.object({ action: z.literal('request_response'), note: text(1_000) }),
  z.object({ action: z.literal('proposal'), text: text(2_000) }),
  z.object({ action: z.literal('escalate'), note: text(1_000) }),
  z.object({ action: z.literal('note'), text: text(2_000) }),
  z.object({
    action: z.literal('settle'),
    resolution: z.enum(DISPUTE_RESOLUTIONS),
    summary: text(2_000),
    /** возврат комиссии мастеру по этому заказу (не больше удержанной) */
    commissionRefundCents: z.number().int().nonnegative().max(100_000_000).optional(),
    /** итоговая сумма, о которой договорились стороны (для учёта; наличные платформа не возвращает) */
    agreedAmountCents: z.number().int().nonnegative().max(100_000_000).optional(),
  }),
  /** соглашение не достигнуто: сторонам показывается, куда обратиться дальше */
  z.object({ action: z.literal('refer'), summary: text(2_000) }),
]);
export type AdminDisputeAction = z.infer<typeof adminDisputeActionSchema>;

export const INCIDENT_TYPES = ['ACCIDENT', 'INJURY', 'PROPERTY_DAMAGE', 'OTHER'] as const;
export const incidentSchema = z.object({
  type: z.enum(INCIDENT_TYPES),
  description: text(3_000),
  emergencyCalled: z.boolean(),
  location: latLngSchema.optional(),
  photoKeys: fileKeys,
});

export const TICKET_STATUSES = ['OPEN', 'PENDING_USER', 'RESOLVED', 'CLOSED'] as const;
export const createTicketSchema = z.object({
  subject: z.string().trim().min(3).max(200),
  body: text(4_000),
  orderId: z.uuid().optional(),
});
export const ticketMessageSchema = z.object({
  body: z.string().trim().min(1).max(4_000),
  /** внутренняя заметка поддержки — пользователь её не видит */
  internal: z.boolean().optional(),
});
export const ticketUpdateSchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  assigneeId: z.uuid().nullable().optional(),
});

// ── Юридические документы и согласия (18.6) ──
export const LEGAL_AUDIENCES = [
  'CLIENT',
  'INDEPENDENT_WORKER',
  'COMPANY',
  'TEAM_MEMBER',
  'DISPUTE_POLICY',
  'INCIDENT_POLICY',
  'INSURANCE_REQUIREMENTS',
  'PRIVACY_POLICY',
  'TOPUP_TERMS',
] as const;
export type LegalAudienceName = (typeof LEGAL_AUDIENCES)[number];
/** Где согласие обязательно (принять), а где документ только показывается (ознакомиться). */
export const CONSENT_CONTEXTS = ['registration', 'order', 'topup', 'add_helper'] as const;
export type ConsentContext = (typeof CONSENT_CONTEXTS)[number];

export const legalVersionSchema = z.object({
  audience: z.enum(LEGAL_AUDIENCES),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  version: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}(\.\d{1,3})?$/, 'version: YYYY-MM-DD or YYYY-MM-DD.N'),
  /** тексты на всех 5 языках приложения (Markdown) */
  bodies: z.object({
    en: z.string().trim().min(50).max(200_000),
    ru: z.string().trim().min(50).max(200_000),
    de: z.string().trim().min(50).max(200_000),
    es: z.string().trim().min(50).max(200_000),
    hy: z.string().trim().min(50).max(200_000),
  }),
  /** кто проверил редакцию (юрист, фирма) — обязательно перед публикацией */
  legalReviewedBy: z.string().trim().min(3).max(200),
});
export const acceptConsentsSchema = z.object({
  context: z.enum(CONSENT_CONTEXTS),
  versionIds: z.array(z.uuid()).min(1).max(20),
});

// ── Страхование (18.3, 19.4) ──
export const insuranceRuleSchema = z.object({
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  categoryId: z.uuid().nullable(),
  workerType: z.enum(['INDEPENDENT', 'COMPANY']).nullable(),
  required: z.boolean(),
  requiredRisks: z.array(z.string().trim().min(2).max(100)).max(20).default([]),
  note: z
    .object({ en: z.string().max(500), ru: z.string().max(500), de: z.string().max(500), es: z.string().max(500), hy: z.string().max(500) })
    .partial()
    .optional(),
});
export type InsuranceRuleInput = z.infer<typeof insuranceRuleSchema>;

// ── Бонусы (20.4) ──
export const bonusRuleSchema = z
  .object({
    name: z.string().trim().min(2).max(40),
    minOrders: z.number().int().min(1).max(10_000),
    maxOrders: z.number().int().min(1).max(10_000).nullable(),
    percentBp: z.number().int().min(1).max(5_000),
    minRating: z.number().min(0).max(5),
    maxCancelRateBp: z.number().int().min(0).max(10_000),
    maxLostDisputes: z.number().int().min(0).max(100),
    isActive: z.boolean(),
  })
  .refine((r) => r.maxOrders === null || r.maxOrders >= r.minOrders, { message: 'maxOrders must be >= minOrders', path: ['maxOrders'] });
export type BonusRuleInput = z.infer<typeof bonusRuleSchema>;
export const bonusRunSchema = z.object({ period: monthSchema });

// ── Приватность (GDPR) ──
export const deleteAccountSchema = z.object({
  /** пользователь подтверждает, что понимает последствия */
  confirm: z.literal(true),
  reason: z.string().trim().max(500).optional(),
});
