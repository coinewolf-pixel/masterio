import { z } from 'zod';
import { CLIENT_CANCEL_REASONS, WORKER_CANCEL_REASONS } from './rules';

/** Общие zod-схемы запросов. Одни и те же на сервере и в приложениях. */

export const LOCALES = ['en', 'ru', 'de', 'es', 'hy'] as const;
export type Locale = (typeof LOCALES)[number];
export const localeSchema = z.enum(LOCALES);

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'phone must be in E.164 format');

export const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof latLngSchema>;

export const uuidSchema = z.uuid();
export const centsSchema = z.number().int().nonnegative().max(100_000_000);

// ── Авторизация ──
export const otpRequestSchema = z.object({
  phone: phoneSchema,
  appType: z.enum(['client', 'worker']),
  deviceId: z.string().min(8).max(128),
});
export const otpVerifySchema = otpRequestSchema.extend({
  code: z.string().regex(/^\d{4,8}$/),
  locale: localeSchema.default('en'),
  countryCode: z.string().length(2).toUpperCase(),
});
export const refreshSchema = z.object({ refreshToken: z.string().min(32) });
export const adminLoginSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  totp: z.string().regex(/^\d{6}$/),
});

// ── Профиль ──
export const updateMeSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  locale: localeSchema.optional(),
});
export const registerDeviceSchema = z.object({
  deviceId: z.string().min(8).max(128),
  platform: z.enum(['ios', 'android', 'web']),
  pushToken: z.string().max(4096).optional(),
  appVersion: z.string().max(32).optional(),
});

// ── Мастер ──
export const workerOnlineSchema = z.object({ location: latLngSchema });
export const workerProfileSchema = z.object({
  type: z.enum(['INDEPENDENT', 'COMPANY']).optional(),
  companyName: z.string().trim().min(1).max(200).optional(),
  companyRegNumber: z.string().trim().min(1).max(64).optional(),
  preferredRadiusM: z.number().int().positive().max(200_000).nullable().optional(),
  autoUseEarnings: z.boolean().optional(),
});
export const idListSchema = z.object({ ids: z.array(uuidSchema).max(50) });

// ── Заказы ──
export const createOrderSchema = z
  .object({
    categoryId: uuidSchema,
    cityId: uuidSchema,
    description: z.string().trim().min(3).max(2_000),
    address: z.object({
      formatted: z.string().trim().min(3).max(500),
      details: z.string().trim().max(300).optional(),
      placeId: z.string().max(300).optional(),
      location: latLngSchema,
    }),
    timing: z.enum(['ASAP', 'SCHEDULED']).default('ASAP'),
    scheduledAt: z.iso.datetime().optional(),
    paymentMethod: z.enum(['CASH', 'CARD']).default('CASH'),
    photoKeys: z.array(z.string().max(300)).max(10).default([]),
  })
  .refine((o) => o.timing === 'ASAP' || o.scheduledAt !== undefined, {
    message: 'scheduledAt is required for SCHEDULED orders',
    path: ['scheduledAt'],
  });
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const clientCancelSchema = z.object({
  reason: z.enum(CLIENT_CANCEL_REASONS),
  comment: z.string().max(1_000).optional(),
});
export const workerCancelSchema = z.object({
  reason: z.enum(WORKER_CANCEL_REASONS),
  comment: z.string().max(1_000).optional(),
});

export const workerStatusSchema = z.object({
  status: z.enum(['EN_ROUTE', 'ARRIVED', 'IN_PROGRESS']),
  location: latLngSchema,
});

export const estimateSchema = z.object({
  note: z.string().max(1_000).optional(),
  items: z
    .array(
      z.object({
        type: z.enum(['LABOR', 'MATERIAL', 'TRAVEL', 'OTHER']),
        title: z.string().trim().min(1).max(200),
        quantity: z.number().int().positive().max(1_000),
        unitCents: centsSchema,
        photoKeys: z.array(z.string().max(300)).max(10).default([]),
      }),
    )
    .min(1)
    .max(50),
});

export const completeOrderSchema = z.object({
  cashReceivedCents: centsSchema,
  location: latLngSchema,
});
export const confirmPaymentSchema = z.object({ cashPaidCents: centsSchema });
export const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  text: z.string().trim().max(2_000).optional(),
});
export const expandRadiusSchema = z.object({ radiusM: z.number().int().positive().max(200_000) });

// ── Отслеживание ──
export const locationPointSchema = latLngSchema.extend({
  accuracyM: z.number().nonnegative().max(10_000).optional(),
  speedMps: z.number().min(0).max(100).nullable().optional(),
  heading: z.number().min(0).max(360).nullable().optional(),
  recordedAt: z.iso.datetime(),
});
export type LocationPointInput = z.infer<typeof locationPointSchema>;
export const locationBatchSchema = z.object({
  /** необязателен: активный заказ сервер определяет сам по исполнителю */
  orderId: uuidSchema.optional(),
  points: z.array(locationPointSchema).min(1).max(500),
});

// ── Чат ──
export const chatMessageSchema = z.object({ body: z.string().trim().min(1).max(2_000) });

// ── Деньги ──
export const topupSchema = z.object({ amountCents: centsSchema.min(1) });
export const grantSchema = z
  .object({
    workerId: uuidSchema,
    amountCents: centsSchema.min(1).optional(),
    presetIndex: z.number().int().min(0).max(9).optional(),
    reason: z.string().trim().min(3).max(500),
    expiresInDays: z.number().int().positive().max(3_650).optional(),
  })
  .refine((g) => (g.amountCents === undefined) !== (g.presetIndex === undefined), {
    message: 'exactly one of amountCents or presetIndex is required',
  });

// ── Админка ──
export const updateSettingSchema = z.object({
  value: z.unknown(),
  scope: z.enum(['GLOBAL', 'COUNTRY', 'CITY', 'CATEGORY', 'CITY_CATEGORY']).default('GLOBAL'),
  scopeRef: z.string().max(80).default(''),
  comment: z.string().max(500).optional(),
});

export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

// ── Файлы и документы ──
export const UPLOAD_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'] as const;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const uploadUrlSchema = z.object({
  purpose: z.enum(['document', 'order_photo', 'avatar', 'dispute_evidence', 'incident']),
  contentType: z.enum(UPLOAD_CONTENT_TYPES),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});
export type UploadPurpose = z.infer<typeof uploadUrlSchema>['purpose'];

export const DOCUMENT_KINDS = ['ID_DOCUMENT', 'SELFIE', 'LICENSE', 'INSURANCE', 'COMPANY_REGISTRATION', 'QUALIFICATION', 'OTHER'] as const;
export const registerDocumentSchema = z
  .object({
    kind: z.enum(DOCUMENT_KINDS),
    fileKey: z.string().min(10).max(300),
    categoryId: uuidSchema.optional(),
    number: z.string().trim().max(100).optional(),
    issuer: z.string().trim().max(200).optional(),
    validUntil: z.iso.datetime().optional(),
    insurance: z
      .object({
        insurerName: z.string().trim().min(2).max(200),
        policyNumber: z.string().trim().min(2).max(100),
        validFrom: z.iso.datetime(),
        validUntil: z.iso.datetime(),
        coveredRisks: z.array(z.string().trim().min(2).max(100)).min(1).max(20),
      })
      .optional(),
  })
  .refine((d) => d.kind !== 'LICENSE' || d.categoryId !== undefined, { message: 'categoryId is required for LICENSE', path: ['categoryId'] })
  .refine((d) => d.kind !== 'INSURANCE' || d.insurance !== undefined, { message: 'insurance details are required', path: ['insurance'] });

export const reviewDocumentSchema = z
  .object({ decision: z.enum(['approve', 'reject']), reason: z.string().trim().min(3).max(500).optional() })
  .refine((r) => r.decision === 'approve' || r.reason !== undefined, { message: 'reason is required when rejecting', path: ['reason'] });

export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be YYYY-MM');

// ── Клиент: адреса, поиск адресов ──
export const addressSchema = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  formatted: z.string().trim().min(3).max(500),
  details: z.string().trim().max(300).optional(),
  placeId: z.string().max(300).optional(),
  location: latLngSchema,
});
export type AddressInput = z.infer<typeof addressSchema>;

export const geoAutocompleteSchema = z.object({
  q: z.string().trim().min(2).max(200),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  session: z.string().max(100).optional(),
});
export const geoReverseSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});
