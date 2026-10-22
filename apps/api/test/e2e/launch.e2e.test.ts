/** Профиль запуска в Армении: города, суммы в драмах на уровне страны, повторный запуск ничего не меняет. */
import { AM_CITIES, AM_SETTINGS, applyArmeniaLaunch } from '../../prisma/launch-am';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { createOrder, login, offersOf, readyWorker, resetState, startApp, stopApp, YEREVAN_CENTER, type TestCtx } from '../helpers';

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

describe('Armenia launch profile', () => {
  it('creates cities, hides foreign ones, sets AMD amounts for AM only, and is idempotent', async () => {
    const prisma = ctx.prisma as unknown as PrismaClient;
    const first = await applyArmeniaLaunch(prisma, ctx.adminId);
    expect(first.citiesCreated).toHaveLength(AM_CITIES.length - 1); // Ереван уже есть в seed
    expect(first.citiesDisabled).toEqual(expect.arrayContaining(['Berlin', 'Madrid', 'Vienna']));
    expect(first.settingsChanged).toHaveLength(Object.keys(AM_SETTINGS).length);
    await ctx.settings.reload();

    expect(ctx.settings.get('CASH_MIN_BALANCE', { countryCode: 'AM' })).toBe(800_000);
    expect(ctx.settings.get('TOPUP_MIN_AMOUNT', { countryCode: 'AM' })).toBe(400_000);
    expect(ctx.settings.get('CASH_MIN_BALANCE', { countryCode: 'DE' })).toBe(2_000);
    expect(ctx.settings.get('COMMISSION_PERCENT', { countryCode: 'AM' })).toBe(20);

    const active = await ctx.prisma.city.findMany({ where: { isActive: true }, select: { countryCode: true, currency: true, emergencyNumber: true } });
    expect(active).toHaveLength(AM_CITIES.length);
    expect(active.every((c) => c.countryCode === 'AM' && c.currency === 'AMD' && c.emergencyNumber === '112')).toBe(true);
    const history = await ctx.prisma.settingHistory.count({ where: { comment: 'launch profile: Armenia (AMD)' } });

    const again = await applyArmeniaLaunch(prisma, ctx.adminId);
    expect(again).toEqual({ citiesCreated: [], citiesDisabled: [], settingsChanged: [] });
    expect(await ctx.prisma.settingHistory.count({ where: { comment: 'launch profile: Armenia (AMD)' } })).toBe(history);
  });

  it('a worker with the launch balance threshold in AMD receives orders in Yerevan', async () => {
    await applyArmeniaLaunch(ctx.prisma as unknown as PrismaClient, ctx.adminId);
    await ctx.settings.reload();
    // порог доступа в AMD: 10 000 драмов приветственного кредита достаточно (минимум 8 000)
    const worker = await readyWorker(ctx, '+37491999001', YEREVAN_CENTER, { promoCents: 1_000_000 });
    const client = await login(ctx, '+37499999002', 'client');
    const order = await createOrder(ctx, client.token);
    expect(order.status).toBe(201);
    const offers = await offersOf(ctx, order.body.id);
    expect(offers[0]?.workerId).toBe(worker.userId);
  });
});
