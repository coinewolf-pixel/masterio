/** Деньги (разделы 20–22): ledger, приветственный кредит, лимиты и 4 eyes, вывод отсутствует, webhooks Stripe, флаги запуска. */
import Stripe from 'stripe';
import { LedgerService } from '../../src/wallet/ledger.service';
import { WalletService } from '../../src/wallet/wallet.service';
import { BootstrapService } from '../../src/bootstrap.service';
import {
  auth,
  createAdmin,
  createOrder,
  login,
  north,
  readyWorker,
  resetState,
  startApp,
  stopApp,
  YEREVAN_CENTER,
  type TestCtx,
} from '../helpers';

let ctx: TestCtx;
let root: { id: string; token: string };

beforeAll(async () => {
  ctx = await startApp();
});
afterAll(async () => {
  await stopApp(ctx);
});
beforeEach(async () => {
  await resetState(ctx);
  root = await createAdmin(ctx, 'super@masterio.test', ['SUPERADMIN']);
});

async function integrity() {
  return ctx.prisma.$transaction((tx) => ctx.app.get(LedgerService).verifyIntegrity(tx));
}

function signed(event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET as string });
  return { payload, header };
}

describe('welcome credit (manual starting balance)', () => {
  it('preset 100 goes only to the promo pocket, counts towards access and cannot be withdrawn', async () => {
    const w = await login(ctx, '+37492000001', 'worker');
    await ctx.http.put('/api/v1/worker/cities').set(auth(w.token)).send({ ids: [ctx.cityId] }).expect(200);
    const res = await ctx.http
      .post('/api/v1/admin/grants')
      .set(auth(root.token))
      .send({ workerId: w.userId, presetIndex: 1, reason: 'Launch: first orders' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'APPROVED', amountCents: 10_000 });

    const wallet = await ctx.http.get('/api/v1/wallet').set(auth(w.token)).expect(200);
    expect(wallet.body).toMatchObject({ promoCents: 10_000, topupCents: 0, earningsCents: 0, bonusCents: 0 });
    expect(wallet.body.promoLots[0].remainingCents).toBe(10_000);
    const elig = await ctx.http.get('/api/v1/worker/eligibility').set(auth(w.token)).expect(200);
    expect(elig.body.accessBalanceCents).toBe(10_000);

    // операции вывода с промо/пополнения/бонуса в API не существует
    for (const path of ['/api/v1/wallet/withdraw', '/api/v1/wallet/payouts', '/api/v1/wallet/promo/withdraw', '/api/v1/payouts']) {
      const r = await ctx.http.post(path).set(auth(w.token)).send({ amountCents: 100 });
      expect(r.status).toBe(404);
    }
    const accounts = await ctx.prisma.ledgerAccount.findMany({ where: { ownerId: w.userId } });
    expect(accounts.map((a) => a.type)).toEqual(['WORKER_PROMO']);
    expect(await integrity()).toEqual({ totalCents: 0, mismatchedAccounts: 0 });
  });

  it('above the threshold requires a second admin; the creator cannot approve; nobody can credit themselves', async () => {
    await ctx.settings.set('GRANT_SECOND_APPROVAL_ABOVE', 5_000, 'GLOBAL', '', root.id);
    const second = await createAdmin(ctx, 'second@masterio.test', ['SUPERADMIN']);
    const w = await login(ctx, '+37492000002', 'worker');
    const created = await ctx.http.post('/api/v1/admin/grants').set(auth(root.token)).send({ workerId: w.userId, amountCents: 8_000, reason: 'Big start' }).expect(201);
    expect(created.body.status).toBe('PENDING_APPROVAL');
    expect((await ctx.http.get('/api/v1/wallet').set(auth(w.token))).body.promoCents).toBe(0);

    const self = await ctx.http.post(`/api/v1/admin/grants/${created.body.id}/approve`).set(auth(root.token));
    expect(self.body.code).toBe('GRANT_SECOND_APPROVER_REQUIRED');
    await ctx.http.post(`/api/v1/admin/grants/${created.body.id}/approve`).set(auth(second.token)).expect(200);
    expect((await ctx.http.get('/api/v1/wallet').set(auth(w.token))).body.promoCents).toBe(8_000);

    // админ не может начислить самому себе / на связанный аккаунт (общее устройство)
    const own = await ctx.http.post('/api/v1/admin/grants').set(auth(root.token)).send({ workerId: root.id, amountCents: 100, reason: 'self' });
    expect(own.status).toBe(404); // админ не является мастером
    const linked = await login(ctx, '+37492000003', 'worker', 'shared-device-1');
    await ctx.prisma.device.create({ data: { userId: root.id, fingerprint: 'shared-device-1', platform: 'web' } });
    const rel = await ctx.http.post('/api/v1/admin/grants').set(auth(root.token)).send({ workerId: linked.userId, amountCents: 100, reason: 'related' });
    expect(rel.body.code).toBe('GRANT_SELF_FORBIDDEN');
  });

  it('per-worker limit and finance daily limit are enforced; support cannot grant', async () => {
    const w = await login(ctx, '+37492000004', 'worker');
    const over = await ctx.http.post('/api/v1/admin/grants').set(auth(root.token)).send({ workerId: w.userId, amountCents: 10_001, reason: 'too much' });
    expect(over.body.code).toBe('GRANT_LIMIT_EXCEEDED');
    const support = await createAdmin(ctx, 'support@masterio.test', ['SUPPORT']);
    const denied = await ctx.http.post('/api/v1/admin/grants').set(auth(support.token)).send({ workerId: w.userId, amountCents: 100, reason: 'nope' });
    expect(denied.status).toBe(403);
    await ctx.settings.set('GRANT_FINANCE_DAILY_LIMIT', 1_000, 'GLOBAL', '', root.id);
    const finance = await createAdmin(ctx, 'finance@masterio.test', ['FINANCE']);
    await ctx.http.post('/api/v1/admin/grants').set(auth(finance.token)).send({ workerId: w.userId, amountCents: 900, reason: 'within limit' }).expect(201);
    const daily = await ctx.http.post('/api/v1/admin/grants').set(auth(finance.token)).send({ workerId: w.userId, amountCents: 200, reason: 'over daily' });
    expect(daily.body.code).toBe('GRANT_LIMIT_EXCEEDED');
  });

  it('promo expires and burns with a ledger record; blocking a pro burns the rest', async () => {
    const w = await readyWorker(ctx, '+37492000005', YEREVAN_CENTER, { promoCents: 5_000 });
    await ctx.prisma.balanceLot.updateMany({ data: { expiresAt: new Date(Date.now() - 1_000) } });
    const burned = await ctx.app.get(BootstrapService).expireLots();
    expect(burned).toBe(5_000);
    expect((await ctx.http.get('/api/v1/wallet').set(auth(w.token))).body.promoCents).toBe(0);
    expect(await ctx.prisma.ledgerTransaction.count({ where: { kind: 'PROMO_EXPIRY' } })).toBe(1);

    const w2 = await readyWorker(ctx, '+37492000006', YEREVAN_CENTER, { promoCents: 7_000 });
    await ctx.http.post(`/api/v1/admin/users/${w2.userId}/block`).set(auth(root.token)).send({ reason: 'fraud' }).expect(200);
    const pockets = await ctx.app.get(WalletService).pockets(ctx.prisma, w2.userId, 'AMD');
    expect(pockets.promoCents).toBe(0);
    await ctx.http.get('/api/v1/wallet').set(auth(w2.token)).expect(403);
    expect(await integrity()).toEqual({ totalCents: 0, mismatchedAccounts: 0 });
  });
});

describe('ledger', () => {
  it('entries are append-only (DB rejects UPDATE and DELETE) and every transaction balances to zero', async () => {
    await readyWorker(ctx, '+37492000010', YEREVAN_CENTER, { promoCents: 3_000 });
    await expect(ctx.prisma.$executeRawUnsafe('UPDATE "LedgerEntry" SET "amountCents" = 1')).rejects.toThrow(/append-only/);
    await expect(ctx.prisma.$executeRawUnsafe('DELETE FROM "LedgerTransaction"')).rejects.toThrow(/append-only/);
    const ledger = ctx.app.get(LedgerService);
    await expect(
      ctx.prisma.$transaction((tx) =>
        ledger.post(tx, {
          kind: 'REVERSAL',
          idempotencyKey: 'bad',
          currency: 'AMD',
          legs: [{ type: 'PLATFORM_REVENUE', ownerId: null, amountCents: 100 }],
        }),
      ),
    ).rejects.toThrow(/balance to zero/);
    expect(await integrity()).toEqual({ totalCents: 0, mismatchedAccounts: 0 });
  });

  it('commission order: bonus (max 50%) → promo → top-up → debt; pocket never goes negative', async () => {
    const w = await readyWorker(ctx, '+37492000011', YEREVAN_CENTER, { promoCents: 300 });
    const wallet = ctx.app.get(WalletService);
    const ledger = ctx.app.get(LedgerService);
    await ctx.prisma.$transaction(async (tx) => {
      await ledger.post(tx, {
        kind: 'BONUS_ACCRUAL',
        idempotencyKey: 'bonus-1',
        currency: 'AMD',
        legs: [
          { type: 'BONUS_EXPENSE', ownerId: null, amountCents: -5_000 },
          { type: 'WORKER_BONUS', ownerId: w.userId, amountCents: 5_000 },
        ],
      });
      await ledger.post(tx, {
        kind: 'TOPUP',
        idempotencyKey: 'topup-x',
        currency: 'AMD',
        legs: [
          { type: 'STRIPE_CLEARING', ownerId: null, amountCents: -200 },
          { type: 'WORKER_TOPUP', ownerId: w.userId, amountCents: 200 },
        ],
      });
    });
    const order = await ctx.prisma.order.create({
      data: { clientId: (await login(ctx, '+37499200011', 'client')).userId, categoryId: ctx.categoryId, cityId: ctx.cityId, description: 'x', addressFormatted: 'x', searchRadiusM: 1_000, currency: 'AMD' },
    });
    const plan = await ctx.prisma.$transaction((tx) =>
      wallet.chargeCommission(tx, { orderId: order.id, workerId: w.userId, currency: 'AMD', commissionCents: 2_000, ctx: { countryCode: 'AM', cityId: ctx.cityId, categoryId: ctx.categoryId } }),
    );
    expect(plan).toMatchObject({ fromBonus: 1_000, fromPromo: 300, fromTopup: 200, fromEarnings: 0, toDebt: 500, replayed: false });
    // повтор по тому же заказу ничего не списывает
    const again = await ctx.prisma.$transaction((tx) =>
      wallet.chargeCommission(tx, { orderId: order.id, workerId: w.userId, currency: 'AMD', commissionCents: 2_000, ctx: { countryCode: 'AM', cityId: ctx.cityId, categoryId: ctx.categoryId } }),
    );
    expect(again.replayed).toBe(true);
    const pockets = await wallet.pockets(ctx.prisma, w.userId, 'AMD');
    expect(pockets).toMatchObject({ bonusCents: 4_000, promoCents: 0, topupCents: 0, debtCents: 500 });
    const elig = await ctx.http.get('/api/v1/worker/eligibility').set(auth(w.token)).expect(200);
    expect(elig.body.reasons).toContain('balance');
    expect(await integrity()).toEqual({ totalCents: 0, mismatchedAccounts: 0 });
  });
});

describe('Stripe top-up webhook', () => {
  function succeeded(id: string, intent: string, userId: string, amount: number) {
    return {
      id,
      object: 'event',
      type: 'payment_intent.succeeded',
      data: { object: { id: intent, object: 'payment_intent', amount, amount_received: amount, currency: 'amd', metadata: { purpose: 'worker_topup', userId }, latest_charge: null } },
    };
  }

  it('credits top-up after repaying debt; the same webhook twice does not duplicate; bad signature is rejected', async () => {
    const w = await readyWorker(ctx, '+37492000020', YEREVAN_CENTER, { promoCents: 0 });
    // долг 700
    await ctx.prisma.$transaction((tx) =>
      ctx.app.get(LedgerService).post(tx, {
        kind: 'PENALTY',
        idempotencyKey: 'debt-1',
        currency: 'AMD',
        legs: [
          { type: 'WORKER_DEBT', ownerId: w.userId, amountCents: -700 },
          { type: 'PENALTIES', ownerId: null, amountCents: 700 },
        ],
      }),
    );
    const { payload, header } = signed(succeeded('evt_1', 'pi_1', w.userId, 5_000));
    const r1 = await ctx.http.post('/api/v1/webhooks/stripe').set('stripe-signature', header).set('content-type', 'application/json').send(payload);
    expect(r1.status).toBe(200);
    expect(r1.body.duplicate).toBe(false);
    const r2 = await ctx.http.post('/api/v1/webhooks/stripe').set('stripe-signature', header).set('content-type', 'application/json').send(payload);
    expect(r2.body.duplicate).toBe(true);
    // тот же платёж под другим id события — тоже без дубля (идемпотентность по PaymentIntent)
    const other = signed(succeeded('evt_2', 'pi_1', w.userId, 5_000));
    await ctx.http.post('/api/v1/webhooks/stripe').set('stripe-signature', other.header).set('content-type', 'application/json').send(other.payload).expect(200);

    const pockets = await ctx.app.get(WalletService).pockets(ctx.prisma, w.userId, 'AMD');
    expect(pockets).toMatchObject({ topupCents: 4_300, debtCents: 0 });
    expect(await ctx.prisma.ledgerTransaction.count({ where: { kind: 'TOPUP' } })).toBe(1);

    const bad = await ctx.http.post('/api/v1/webhooks/stripe').set('stripe-signature', 't=1,v1=deadbeef').set('content-type', 'application/json').send(payload);
    expect(bad.status).toBe(403);
    expect(await integrity()).toEqual({ totalCents: 0, mismatchedAccounts: 0 });
  });

  it('chargeback on a top-up takes it back; the shortage becomes debt', async () => {
    const w = await readyWorker(ctx, '+37492000021', YEREVAN_CENTER, { promoCents: 0 });
    const ok = signed(succeeded('evt_10', 'pi_10', w.userId, 3_000));
    await ctx.http.post('/api/v1/webhooks/stripe').set('stripe-signature', ok.header).set('content-type', 'application/json').send(ok.payload).expect(200);
    // часть пополнения уже ушла на комиссию
    await ctx.prisma.$transaction((tx) =>
      ctx.app.get(LedgerService).post(tx, {
        kind: 'COMMISSION',
        idempotencyKey: 'c-x',
        currency: 'AMD',
        legs: [
          { type: 'WORKER_TOPUP', ownerId: w.userId, amountCents: -2_000 },
          { type: 'PLATFORM_REVENUE', ownerId: null, amountCents: 2_000 },
        ],
      }),
    );
    const cb = signed({ id: 'evt_11', object: 'event', type: 'charge.dispute.created', data: { object: { id: 'dp_1', object: 'dispute', amount: 3_000, payment_intent: 'pi_10' } } });
    await ctx.http.post('/api/v1/webhooks/stripe').set('stripe-signature', cb.header).set('content-type', 'application/json').send(cb.payload).expect(200);
    const pockets = await ctx.app.get(WalletService).pockets(ctx.prisma, w.userId, 'AMD');
    expect(pockets).toMatchObject({ topupCents: 0, debtCents: 2_000 });
    // системные счета платформы не дублируются (уникальность при ownerId = NULL)
    expect(await ctx.prisma.ledgerAccount.count({ where: { type: 'STRIPE_CLEARING', ownerId: null } })).toBe(1);
    expect(await integrity()).toEqual({ totalCents: 0, mismatchedAccounts: 0 });
  });
});

describe('launch flags and settings without release', () => {
  it('card payments are off at launch; cash can be switched off by admin and takes effect immediately', async () => {
    const client = await login(ctx, '+37499200030', 'client');
    const card = await createOrder(ctx, client.token, YEREVAN_CENTER, { paymentMethod: 'CARD' });
    expect(card.body.code).toBe('FEATURE_DISABLED');

    await ctx.http.put('/api/v1/admin/settings/CASH_ENABLED').set(auth(root.token)).send({ value: false }).expect(200);
    const cash = await createOrder(ctx, client.token);
    expect(cash.body.code).toBe('FEATURE_DISABLED');
    await ctx.http.put('/api/v1/admin/settings/CASH_ENABLED').set(auth(root.token)).send({ value: true, scope: 'GLOBAL' }).expect(200);
    expect((await createOrder(ctx, client.token)).status).toBe(201);

    // по городу можно выключить отдельно
    await ctx.http.put('/api/v1/admin/settings/CASH_ENABLED').set(auth(root.token)).send({ value: false, scope: 'CITY', scopeRef: ctx.cityId }).expect(200);
    expect((await createOrder(ctx, client.token)).body.code).toBe('FEATURE_DISABLED');
    const history = await ctx.http.get('/api/v1/admin/settings/CASH_ENABLED/history').set(auth(root.token)).expect(200);
    expect(history.body.length).toBe(3);
  });

  it('commission above 20% is rejected; changes are logged; top-up creation respects its flag', async () => {
    const bad = await ctx.http.put('/api/v1/admin/settings/COMMISSION_PERCENT').set(auth(root.token)).send({ value: 25 });
    expect(bad.body.code).toBe('VALIDATION_FAILED');
    await ctx.http.put('/api/v1/admin/settings/COMMISSION_PERCENT').set(auth(root.token)).send({ value: 15 }).expect(200);
    expect(ctx.settings.get('COMMISSION_PERCENT')).toBe(15);
    expect(await ctx.prisma.adminAuditLog.count({ where: { action: 'setting.update' } })).toBe(1);

    const support = await createAdmin(ctx, 'support2@masterio.test', ['SUPPORT']);
    const forbidden = await ctx.http.put('/api/v1/admin/settings/COMMISSION_PERCENT').set(auth(support.token)).send({ value: 10 });
    expect(forbidden.status).toBe(403);

    await ctx.http.put('/api/v1/admin/settings/WORKER_TOPUP_ENABLED').set(auth(root.token)).send({ value: false }).expect(200);
    const w = await login(ctx, '+37492000031', 'worker');
    const topup = await ctx.http.post('/api/v1/wallet/topups').set(auth(w.token)).send({ amountCents: 2_000 });
    expect(topup.body.code).toBe('FEATURE_DISABLED');
  });

  it('commission percent from settings is applied when the order completes', async () => {
    await ctx.http.put('/api/v1/admin/settings/COMMISSION_PERCENT').set(auth(root.token)).send({ value: 10 }).expect(200);
    const worker = await readyWorker(ctx, '+37492000040', north(YEREVAN_CENTER, 100));
    const client = await login(ctx, '+37499200040', 'client');
    const order = await createOrder(ctx, client.token);
    const offer = await ctx.prisma.offer.findFirstOrThrow({ where: { orderId: order.body.id } });
    await ctx.http.post(`/api/v1/offers/${offer.id}/accept`).set(auth(worker.token)).expect(200);
    for (const status of ['EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] as const) {
      await ctx.http.post(`/api/v1/orders/${order.body.id}/status`).set(auth(worker.token)).send({ status, location: YEREVAN_CENTER }).expect(200);
    }
    await ctx.http.post(`/api/v1/orders/${order.body.id}/estimates`).set(auth(worker.token)).send({ items: [{ type: 'LABOR', title: 'w', quantity: 1, unitCents: 10_000 }] }).expect(201);
    await ctx.http.post(`/api/v1/orders/${order.body.id}/estimates/1/approve`).set(auth(client.token)).expect(200);
    const done = await ctx.http.post(`/api/v1/orders/${order.body.id}/complete`).set(auth(worker.token)).send({ cashReceivedCents: 10_000, location: YEREVAN_CENTER }).expect(200);
    expect(done.body.commission.commissionCents).toBe(1_000);
    const saved = await ctx.prisma.order.findUniqueOrThrow({ where: { id: order.body.id } });
    expect(saved.commissionPercentBp).toBe(1_000);
  });
});
