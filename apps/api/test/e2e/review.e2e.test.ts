/**
 * Аккаунты для проверки в App Store / Google Play: вход без SMS по постоянному коду и полная изоляция от реальных
 * пользователей (заказы тестового клиента получают только тестовые мастера, и наоборот).
 */
import { ConsoleSmsVerifier } from '../../src/auth/sms';
import { loadEnv, resetEnvCache } from '../../src/config/env';
import { auth, createOrder, login, north, offersOf, readyWorker, resetState, startApp, stopApp, YEREVAN_CENTER, type TestCtx } from '../helpers';

const REVIEW_CLIENT = '+37455000101';
const REVIEW_WORKER = '+37455000102';
const CODE = '482915';
const saved = { phones: process.env.REVIEW_PHONES, code: process.env.REVIEW_OTP_CODE };
let ctx: TestCtx;

/** Вход тестового аккаунта так же, как в магазине: запрос кода и постоянный код. */
async function reviewLogin(phone: string, appType: 'client' | 'worker') {
  await ctx.http.post('/api/v1/auth/otp/request').send({ phone, appType, deviceId: `review-${phone}` }).expect(200);
  const res = await ctx.http.post('/api/v1/auth/otp/verify').send({ phone, appType, deviceId: `review-${phone}`, code: CODE, locale: 'en', countryCode: 'AM' });
  expect(res.status).toBe(200);
  return { token: res.body.accessToken as string, userId: res.body.userId as string };
}

beforeAll(async () => {
  process.env.REVIEW_PHONES = `${REVIEW_CLIENT},${REVIEW_WORKER}`;
  process.env.REVIEW_OTP_CODE = CODE;
  ctx = await startApp();
  // обычные номера по-прежнему получают код от настоящего (здесь — тестового) провайдера
  ctx.sms = ctx.app.get(ConsoleSmsVerifier);
});
afterAll(async () => {
  await stopApp(ctx);
  if (saved.phones === undefined) delete process.env.REVIEW_PHONES;
  else process.env.REVIEW_PHONES = saved.phones;
  if (saved.code === undefined) delete process.env.REVIEW_OTP_CODE;
  else process.env.REVIEW_OTP_CODE = saved.code;
  resetEnvCache();
});
beforeEach(async () => {
  await resetState(ctx);
});

describe('store review accounts', () => {
  it('log in with the fixed code without sending an SMS; a wrong code is rejected', async () => {
    await ctx.http.post('/api/v1/auth/otp/request').send({ phone: REVIEW_CLIENT, appType: 'client', deviceId: 'review-device-1' }).expect(200);
    expect(ctx.sms.lastCodes.has(REVIEW_CLIENT)).toBe(false);
    const wrong = await ctx.http.post('/api/v1/auth/otp/verify').send({ phone: REVIEW_CLIENT, appType: 'client', deviceId: 'review-device-1', code: '000001', locale: 'en', countryCode: 'AM' });
    expect(wrong.status).toBe(401);
    await reviewLogin(REVIEW_CLIENT, 'client');
  });

  it('review and real accounts never see each other’s orders', async () => {
    const real = await readyWorker(ctx, '+37491300201', north(YEREVAN_CENTER, 300), { name: 'Real' });
    const rw = await reviewLogin(REVIEW_WORKER, 'worker');
    await ctx.http.patch('/api/v1/me').set(auth(rw.token)).send({ firstName: 'Review Pro' }).expect(200);
    await ctx.http.put('/api/v1/worker/categories').set(auth(rw.token)).send({ ids: [ctx.categoryId] }).expect(200);
    await ctx.http.put('/api/v1/worker/cities').set(auth(rw.token)).send({ ids: [ctx.cityId] }).expect(200);
    await ctx.prisma.workerProfile.update({ where: { userId: rw.userId }, data: { kycStatus: 'VERIFIED' } });
    const grant = await ctx.prisma.walletGrant.create({ data: { workerId: rw.userId, amountCents: 10_000, reason: 'review', expiresAt: new Date(Date.now() + 86_400_000), createdById: ctx.adminId, status: 'APPROVED' } });
    await ctx.prisma.$transaction((tx) => ctx.wallet.creditPromo(tx, { workerId: rw.userId, currency: 'AMD', amountCents: 10_000, grantId: grant.id, expiresAt: grant.expiresAt, actorId: ctx.adminId }));
    await ctx.http.post('/api/v1/worker/online').set(auth(rw.token)).send({ location: north(YEREVAN_CENTER, 200) }).expect(200);

    const rc = await reviewLogin(REVIEW_CLIENT, 'client');
    const avail = await ctx.http.get('/api/v1/availability').query({ cityId: ctx.cityId, categoryId: ctx.categoryId, lat: YEREVAN_CENTER.lat, lng: YEREVAN_CENTER.lng }).set(auth(rc.token)).expect(200);
    expect(avail.body.availableCount).toBe(1);
    const reviewOrder = await createOrder(ctx, rc.token);
    expect((await offersOf(ctx, reviewOrder.body.id)).map((o) => o.workerId)).toEqual([rw.userId]);

    // ответить на тестовое предложение, чтобы мастер освободился, затем — заказ реального клиента
    const [offer] = await offersOf(ctx, reviewOrder.body.id);
    await ctx.http.post(`/api/v1/offers/${offer!.id}/decline`).set(auth(rw.token)).expect(204);
    const client = await login(ctx, '+37499300202', 'client');
    const realOrder = await createOrder(ctx, client.token);
    const offers = await offersOf(ctx, realOrder.body.id);
    expect(offers.map((o) => o.workerId)).toEqual([real.userId]);
  });

  it('a trivial review code is refused at startup', () => {
    const base = { DATABASE_URL: 'postgres://x', JWT_ACCESS_SECRET: 'x'.repeat(40), PII_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'), REVIEW_PHONES: REVIEW_CLIENT };
    expect(() => loadEnv({ ...base, REVIEW_OTP_CODE: '123456' })).toThrow(/REVIEW_OTP_CODE/);
    expect(() => loadEnv({ ...base })).toThrow(/REVIEW_OTP_CODE/);
    expect(() => loadEnv({ ...base, REVIEW_OTP_CODE: '482915' })).not.toThrow();
  });
});
