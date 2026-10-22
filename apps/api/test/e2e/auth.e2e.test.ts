/** Авторизация и безопасность (раздел 15): SMS-код, защита от перебора, ротация refresh, блокировка, роли. */
import { auth, createAdmin, login, resetState, startApp, stopApp, type TestCtx } from '../helpers';

let ctx: TestCtx;

beforeAll(async () => {
  ctx = await startApp();
});
afterAll(async () => {
  await stopApp(ctx);
});
beforeEach(async () => {
  await resetState(ctx);
});

describe('auth', () => {
  it('SMS code login creates a client; wrong code attempts are limited (brute-force protection)', async () => {
    const phone = '+37493000001';
    await ctx.http.post('/api/v1/auth/otp/request').send({ phone, appType: 'client', deviceId: 'device-abc-1' }).expect(200);
    const body = { phone, appType: 'client', deviceId: 'device-abc-1', locale: 'hy', countryCode: 'AM' };
    for (let i = 0; i < 5; i += 1) {
      const wrong = await ctx.http.post('/api/v1/auth/otp/verify').send({ ...body, code: '000000' === ctx.sms.lastCodes.get(phone) ? '111111' : '000000' });
      expect(wrong.body.code).toBe('OTP_INVALID');
    }
    const blocked = await ctx.http.post('/api/v1/auth/otp/verify').send({ ...body, code: ctx.sms.lastCodes.get(phone) });
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('OTP_TOO_MANY_ATTEMPTS');
  });

  it('SMS sending is rate limited per phone', async () => {
    const phone = '+37493000002';
    for (let i = 0; i < 5; i += 1) {
      await ctx.http.post('/api/v1/auth/otp/request').send({ phone, appType: 'client', deviceId: `d-rate-${i}0000` }).expect(200);
    }
    const sixth = await ctx.http.post('/api/v1/auth/otp/request').send({ phone, appType: 'client', deviceId: 'd-rate-x0000' });
    expect(sixth.status).toBe(429);
  });

  it('refresh tokens rotate; reusing an old one revokes the whole session', async () => {
    const s = await login(ctx, '+37493000003', 'client');
    const r1 = await ctx.http.post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken }).expect(200);
    expect(r1.body.refreshToken).not.toBe(s.refreshToken);
    const reuse = await ctx.http.post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken });
    expect(reuse.body.code).toBe('TOKEN_REUSED');
    const afterTheft = await ctx.http.post('/api/v1/auth/refresh').send({ refreshToken: r1.body.refreshToken });
    expect(afterTheft.body.code).toBe('TOKEN_REUSED');
  });

  it('one phone — one role; blocked users are rejected; roles guard endpoints', async () => {
    const client = await login(ctx, '+37493000004', 'client');
    await ctx.http.post('/api/v1/auth/otp/request').send({ phone: '+37493000004', appType: 'worker', deviceId: 'device-role-1' }).expect(200);
    const asWorker = await ctx.http.post('/api/v1/auth/otp/verify').send({
      phone: '+37493000004',
      appType: 'worker',
      deviceId: 'device-role-1',
      code: ctx.sms.lastCodes.get('+37493000004'),
      countryCode: 'AM',
    });
    expect(asWorker.status).toBe(403);

    await ctx.http.get('/api/v1/worker/eligibility').set(auth(client.token)).expect(403);
    await ctx.http.get('/api/v1/admin/settings').set(auth(client.token)).expect(403);

    await ctx.prisma.user.update({ where: { id: client.userId }, data: { status: 'BLOCKED' } });
    const me = await ctx.http.get('/api/v1/me').set(auth(client.token));
    expect(me.body.code).toBe('ACCOUNT_BLOCKED');
  });

  it('admin login requires password and TOTP; personal data is stored encrypted', async () => {
    await createAdmin(ctx, 'ops@masterio.test', ['SUPPORT']);
    const wrong = await ctx.http.post('/api/v1/auth/admin/login').send({ email: 'ops@masterio.test', password: 'Admin-Pass-123', totp: '000000' });
    expect(wrong.status).toBe(401);

    const s = await login(ctx, '+37493000005', 'client');
    await ctx.http.patch('/api/v1/me').set(auth(s.token)).send({ firstName: 'Anahit' }).expect(200);
    const raw = await ctx.prisma.user.findUniqueOrThrow({ where: { id: s.userId } });
    expect(Buffer.from(raw.firstNameEnc ?? new Uint8Array()).toString('utf8')).not.toContain('Anahit');
    const me = await ctx.http.get('/api/v1/me').set(auth(s.token)).expect(200);
    expect(me.body.firstName).toBe('Anahit');
  });

  it('errors come with an i18n key, never with internal details', async () => {
    const res = await ctx.http.get('/api/v1/orders/00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ code: 'UNAUTHORIZED', messageKey: 'errors.UNAUTHORIZED' });
    const health = await ctx.http.get('/api/v1/health').expect(200);
    expect(health.body.status).toBe('ok');
  });
});
