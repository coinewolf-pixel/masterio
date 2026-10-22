import { z } from 'zod';
import { LOCALES, latLngSchema } from './schemas';

/** Схемы запросов CRM. Одни и те же проверки в браузере админки и на сервере. */

export const ADMIN_SUB_ROLES = ['SUPPORT', 'MODERATOR', 'FINANCE', 'SUPERADMIN'] as const;
export type AdminSubRoleName = (typeof ADMIN_SUB_ROLES)[number];

/** Названия справочников на всех 5 языках приложения — без пустых значений. */
export const namesSchema = z.object(
  Object.fromEntries(LOCALES.map((l) => [l, z.string().trim().min(1).max(80)])) as Record<(typeof LOCALES)[number], z.ZodString>,
);
export type LocalizedNames = z.infer<typeof namesSchema>;

const codeSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,39}$/, 'code: lowercase latin letters, digits and _');

export const categoryGroupInputSchema = z.object({
  code: codeSchema,
  names: namesSchema,
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});
export type CategoryGroupInput = z.infer<typeof categoryGroupInputSchema>;

export const categoryInputSchema = z.object({
  code: codeSchema,
  groupId: z.uuid(),
  names: namesSchema,
  icon: z.string().trim().max(60).nullable().default(null),
  isUrgent: z.boolean().default(false),
  requiresLicense: z.boolean().default(false),
  requiresInsurance: z.boolean().default(false),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});
export type CategoryInput = z.infer<typeof categoryInputSchema>;

export const cityInputSchema = z.object({
  countryCode: z
    .string()
    .trim()
    .regex(/^[A-Z]{2}$/, 'ISO 3166-1 alpha-2, e.g. DE'),
  names: namesSchema,
  timezone: z.string().trim().min(3).max(60).refine(isValidTimeZone, 'unknown IANA time zone'),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, 'ISO 4217, e.g. EUR'),
  center: latLngSchema,
  emergencyNumber: z
    .string()
    .trim()
    .regex(/^[0-9]{2,6}$/),
  isActive: z.boolean().default(true),
});
export type CityInput = z.infer<typeof cityInputSchema>;

/** Какие услуги доступны в городе (заказы, радиус и статистика делятся по городам). */
export const cityCategoriesSchema = z.object({
  categoryIds: z.array(z.uuid()).max(500),
});

export const adminCreateSchema = z.object({
  email: z.email().max(200),
  password: z.string().min(12).max(200),
  subRoles: z.array(z.enum(ADMIN_SUB_ROLES)).min(1).max(4),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .default('AM'),
  dailyGrantLimitCents: z.number().int().nonnegative().max(100_000_000).default(0),
});
export type AdminCreateInput = z.infer<typeof adminCreateSchema>;

export const adminUpdateSchema = z.object({
  subRoles: z.array(z.enum(ADMIN_SUB_ROLES)).min(1).max(4).optional(),
  dailyGrantLimitCents: z.number().int().nonnegative().max(100_000_000).optional(),
  active: z.boolean().optional(),
});
export type AdminUpdateInput = z.infer<typeof adminUpdateSchema>;

export const adminCancelOrderSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export const resolveFraudFlagSchema = z.object({
  note: z.string().trim().min(3).max(1_000),
});

export const blockUserSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const resetSettingSchema = z.object({
  scope: z.enum(['COUNTRY', 'CITY', 'CATEGORY', 'CITY_CATEGORY']),
  scopeRef: z.string().min(1).max(80),
  comment: z.string().max(500).optional(),
});

export const periodSchema = z
  .object({
    from: z.iso.datetime(),
    to: z.iso.datetime(),
  })
  .refine((p) => new Date(p.from) < new Date(p.to), { message: 'from must be before to', path: ['to'] })
  .refine((p) => new Date(p.to).getTime() - new Date(p.from).getTime() <= 400 * 86_400_000, { message: 'period is limited to 400 days', path: ['to'] });

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
