import type { INestApplication } from '@nestjs/common';
import type Redis from 'ioredis';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import type { LatLng } from '@masterio/shared';
import { ConsoleSmsVerifier, SMS_VERIFIER } from '../src/auth/sms';
import { loadEnv, resetEnvCache } from '../src/config/env';
import { JobsService } from '../src/jobs/jobs.service';
import { createApp } from '../src/main';
import { LogPushSender, PUSH_SENDER } from '../src/notifications/push';
import { PrismaService } from '../src/prisma/prisma.service';
import { REDIS } from '../src/redis/redis.module';
import { SettingsService } from '../src/settings/settings.service';
import { WalletService } from '../src/wallet/wallet.service';
import { seed } from '../prisma/seed';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { PiiCipher } from '../src/common/crypto';

export const YEREVAN_CENTER: LatLng = { lat: 40.1776, lng: 44.5126 };

/** Точка в `meters` метрах к северу от base. */
export function north(base: LatLng, meters: number): LatLng {
  return { lat: base.lat + meters / 111_320, lng: base.lng };
}

export interface TestCtx {
  app: INestApplication;
  http: ReturnType<typeof request>;
  url: string;
  prisma: PrismaService;
  redis: Redis;
  settings: SettingsService;
  jobs: JobsService;
  wallet: WalletService;
  sms: ConsoleSmsVerifier;
  push: LogPushSender;
  cityId: string;
  categoryId: string;
  adminId: string;
}

export async function startApp(): Promise<TestCtx> {
  resetEnvCache();
  const env = loadEnv();
  const app = await createApp(env);
  await app.listen(0, '127.0.0.1');
  const server = app.getHttpServer() as { address(): { port: number } };
  const url = `http://127.0.0.1:${server.address().port}`;
  const prisma = app.get(PrismaService);
  const ctx: TestCtx = {
    app,
    http: request(app.getHttpServer()),
    url,
    prisma,
    redis: app.get<Redis>(REDIS),
    settings: app.get(SettingsService),
    jobs: app.get(JobsService),
    wallet: app.get(WalletService),
    sms: app.get<ConsoleSmsVerifier>(SMS_VERIFIER),
    push: app.get<LogPushSender>(PUSH_SENDER),
    cityId: '',
    categoryId: '',
    adminId: '',
  };
  await refreshRefs(ctx);
  return ctx;
}

async function refreshRefs(ctx: TestCtx): Promise<void> {
  const city = await ctx.prisma.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "City" WHERE "names"->>'en' = 'Yerevan'`;
  const cat = await ctx.prisma.category.findUnique({ where: { code: 'plumber' } });
  ctx.cityId = city[0]?.id ?? '';
  ctx.categoryId = cat?.id ?? '';
  const admin = await ctx.prisma.user.findFirst({ where: { email: 'root@masterio.test' } });
  ctx.adminId = admin?.id ?? '';
}

/** Чистое состояние: пустые таблицы, пустой Redis (включая очереди), заново seed и настройки по умолчанию. */
export async function resetState(ctx: TestCtx): Promise<void> {
  const tables = await ctx.prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('spatial_ref_sys', '_prisma_migrations')`;
  await ctx.prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  await ctx.jobs.stopWorker();
  await ctx.redis.flushdb();
  ctx.jobs.startWorker();
  await seed(ctx.prisma as never, { log: false });
  await ctx.settings.reload();
  ctx.sms.lastCodes.clear();
  ctx.push.sent.length = 0;
  await createAdmin(ctx, 'root@masterio.test', ['SUPERADMIN']);
  await refreshRefs(ctx);
}

export async function createAdmin(ctx: TestCtx, email: string, subRoles: Array<'SUPERADMIN' | 'FINANCE' | 'SUPPORT' | 'MODERATOR'>): Promise<{ id: string; token: string }> {
  const secret = authenticator.generateSecret();
  const cipher = new PiiCipher(loadEnv().PII_ENCRYPTION_KEY);
  const user = await ctx.prisma.user.create({
    data: {
      role: 'ADMIN',
      email,
      countryCode: 'AM',
      admin: { create: { subRoles, passwordHash: await bcrypt.hash('Admin-Pass-123', 4), totpSecretEnc: cipher.encrypt(secret) } },
    },
  });
  const res = await ctx.http.post('/api/v1/auth/admin/login').send({ email, password: 'Admin-Pass-123', totp: authenticator.generate(secret) });
  if (res.status !== 200) throw new Error(`admin login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { id: user.id, token: res.body.accessToken as string };
}

export async function login(ctx: TestCtx, phone: string, appType: 'client' | 'worker', deviceId = `device-${phone}`): Promise<{ token: string; userId: string; refreshToken: string }> {
  const r1 = await ctx.http.post('/api/v1/auth/otp/request').send({ phone, appType, deviceId });
  if (r1.status !== 200) throw new Error(`otp request failed: ${r1.status} ${JSON.stringify(r1.body)}`);
  const code = ctx.sms.lastCodes.get(phone);
  const r2 = await ctx.http.post('/api/v1/auth/otp/verify').send({ phone, appType, deviceId, code, locale: 'ru', countryCode: 'AM' });
  if (r2.status !== 200) throw new Error(`otp verify failed: ${r2.status} ${JSON.stringify(r2.body)}`);
  return { token: r2.body.accessToken as string, userId: r2.body.userId as string, refreshToken: r2.body.refreshToken as string };
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Мастер, готовый получать заказы: KYC, категория, город, приветственный кредит, онлайн в точке `at`. */
export async function readyWorker(
  ctx: TestCtx,
  phone: string,
  at: LatLng,
  opts: { promoCents?: number; name?: string; categoryId?: string } = {},
): Promise<{ token: string; userId: string }> {
  const w = await login(ctx, phone, 'worker');
  await ctx.http.patch('/api/v1/me').set(auth(w.token)).send({ firstName: opts.name ?? `Worker ${phone.slice(-3)}` }).expect(200);
  await ctx.http
    .post('/api/v1/me/devices')
    .set(auth(w.token))
    .send({ deviceId: `device-${phone}`, platform: 'android', pushToken: `push-${phone}` })
    .expect(204);
  await ctx.http.put('/api/v1/worker/categories').set(auth(w.token)).send({ ids: [opts.categoryId ?? ctx.categoryId] }).expect(200);
  await ctx.http.put('/api/v1/worker/cities').set(auth(w.token)).send({ ids: [ctx.cityId] }).expect(200);
  await ctx.prisma.workerProfile.update({ where: { userId: w.userId }, data: { kycStatus: 'VERIFIED' } });
  const promo = opts.promoCents ?? 10_000;
  if (promo > 0) {
    const grant = await ctx.prisma.walletGrant.create({
      data: { workerId: w.userId, amountCents: promo, reason: 'test', expiresAt: new Date(Date.now() + 86_400_000), createdById: ctx.adminId, status: 'APPROVED' },
    });
    await ctx.prisma.$transaction((tx) =>
      ctx.wallet.creditPromo(tx, { workerId: w.userId, currency: 'AMD', amountCents: promo, grantId: grant.id, expiresAt: grant.expiresAt, actorId: ctx.adminId }),
    );
  }
  await ctx.http.post('/api/v1/worker/online').set(auth(w.token)).send({ location: at }).expect(200);
  return w;
}

export async function createOrder(ctx: TestCtx, clientToken: string, at: LatLng = YEREVAN_CENTER, extra: Record<string, unknown> = {}) {
  const res = await ctx.http
    .post('/api/v1/orders')
    .set(auth(clientToken))
    .send({
      categoryId: ctx.categoryId,
      cityId: ctx.cityId,
      description: 'Leaking pipe in the kitchen',
      address: { formatted: 'Abovyan 1, Yerevan', location: at },
      ...extra,
    });
  return res;
}

export async function setSetting(ctx: TestCtx, key: string, value: unknown): Promise<void> {
  await ctx.settings.set(key, value, 'GLOBAL', '', ctx.adminId, 'test');
}

export async function offersOf(ctx: TestCtx, orderId: string) {
  return ctx.prisma.offer.findMany({ where: { orderId }, orderBy: [{ round: 'asc' }, { position: 'asc' }, { sentAt: 'asc' }] });
}

export async function waitFor<T>(fn: () => Promise<T>, check: (v: T) => boolean, timeoutMs = 10_000, stepMs = 100): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (check(value)) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor timed out; last value: ${JSON.stringify(value)}`);
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

export function connectSocket(ctx: TestCtx, token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(`${ctx.url}/rt`, { auth: { token }, transports: ['websocket'], forceNew: true });
    // ждём подтверждения авторизации от сервера, а не только TCP-подключения
    socket.once('rt:ready', () => resolve(socket));
    socket.once('rt:error', () => reject(new Error('socket unauthorized')));
    socket.once('connect_error', reject);
  });
}

export function nextEvent<T = unknown>(socket: Socket, event: string, timeoutMs = 10_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event} within ${timeoutMs} ms`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

export async function stopApp(ctx: TestCtx): Promise<void> {
  await ctx.app.close();
}
