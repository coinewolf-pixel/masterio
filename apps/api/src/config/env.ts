import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    PUBLIC_URL: z.url().default('http://localhost:3000'),
    CORS_ORIGINS: z.string().default('http://localhost:5173'),

    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
    /** Обработчики очередей в этом процессе (на Railway можно вынести в отдельный сервис) */
    QUEUE_WORKERS_ENABLED: bool.default(true),

    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
    /** 32 байта в base64 для шифрования персональных данных (AES-256-GCM) */
    PII_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes base64'),

    SMS_PROVIDER: z.enum(['twilio', 'console']).default('console'),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_VERIFY_SERVICE_SID: z.string().optional(),

    /** expo — Expo Push Service (рекомендуется для приложений на Expo), fcm — напрямую Firebase, log — только разработка */
    PUSH_PROVIDER: z.enum(['expo', 'fcm', 'log']).default('log'),
    /** необязательный access token Expo Push (Enhanced Security в настройках проекта EAS) */
    EXPO_ACCESS_TOKEN: z.string().optional(),
    /** JSON сервисного аккаунта Firebase в base64 */
    FIREBASE_SERVICE_ACCOUNT_B64: z.string().optional(),

    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),

    /** S3-совместимое хранилище для фото и документов (закрытый бакет, доступ по временным ссылкам) */
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('eu-central-1'),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: bool.default(false),
    /** создать бакет при старте, если его нет (удобно для локальной разработки) */
    S3_CREATE_BUCKET: bool.default(false),

    GOOGLE_MAPS_API_KEY: z.string().optional(),
    SENTRY_DSN: z.string().optional(),
    LOG_LEVEL: z.enum(['error', 'warn', 'log', 'debug', 'verbose']).default('log'),
    /**
     * Аккаунты для проверки в App Store и Google Play: номера E.164 через запятую. Для них SMS не отправляется,
     * вход — по REVIEW_OTP_CODE; их заказы видят только такие же тестовые мастера (реальным не уходят).
     */
    REVIEW_PHONES: z
      .string()
      .default('')
      .transform((v) => v.split(',').map((x) => x.trim()).filter(Boolean))
      .pipe(z.array(z.string().regex(/^\+[1-9]\d{7,14}$/, 'REVIEW_PHONES: E.164 numbers separated by commas'))),
    REVIEW_OTP_CODE: z.string().regex(/^\d{6}$/, 'REVIEW_OTP_CODE: 6 digits').optional(),
  })
  .superRefine((env, ctx) => {
    if (env.SMS_PROVIDER === 'twilio' && (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_VERIFY_SERVICE_SID)) {
      ctx.addIssue({ code: 'custom', message: 'TWILIO_* variables are required when SMS_PROVIDER=twilio' });
    }
    if (env.PUSH_PROVIDER === 'fcm' && !env.FIREBASE_SERVICE_ACCOUNT_B64) {
      ctx.addIssue({ code: 'custom', message: 'FIREBASE_SERVICE_ACCOUNT_B64 is required when PUSH_PROVIDER=fcm' });
    }
    if (env.REVIEW_PHONES.length > 0) {
      const weak = ['000000', '111111', '123456', '654321', '123123', '999999'];
      if (!env.REVIEW_OTP_CODE || weak.includes(env.REVIEW_OTP_CODE) || /^(\d)\1{5}$/.test(env.REVIEW_OTP_CODE)) {
        ctx.addIssue({ code: 'custom', message: 'REVIEW_OTP_CODE (6 random digits, not trivial) is required when REVIEW_PHONES is set' });
      }
    }
    if (env.NODE_ENV === 'production') {
      if (env.SMS_PROVIDER !== 'twilio') ctx.addIssue({ code: 'custom', message: 'SMS_PROVIDER must be twilio in production' });
      if (env.PUSH_PROVIDER === 'log') ctx.addIssue({ code: 'custom', message: 'PUSH_PROVIDER must be expo or fcm in production' });
      if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
        ctx.addIssue({ code: 'custom', message: 'S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required in production' });
      }
      if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
        ctx.addIssue({ code: 'custom', message: 'STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required in production' });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached && source === process.env) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  if (source === process.env) cached = parsed.data;
  return parsed.data;
}

export function resetEnvCache(): void {
  cached = null;
}

export const ENV = Symbol('ENV');
