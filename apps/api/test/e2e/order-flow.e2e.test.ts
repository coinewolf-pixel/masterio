/** E2E: заказ → принятие → живой трек → смета → завершение с наличными → комиссия → подтверждение → отзыв. */
import { RT_EVENTS, type WorkerLocationPayload } from '@masterio/shared';
import { OrdersService } from '../../src/orders/orders.service';
import { TrackingService } from '../../src/tracking/tracking.service';
import {
  auth,
  connectSocket,
  createOrder,
  login,
  nextEvent,
  north,
  offersOf,
  readyWorker,
  resetState,
  startApp,
  stopApp,
  YEREVAN_CENTER,
  type TestCtx,
} from '../helpers';

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

async function acceptedOrder(phoneSuffix: string) {
  const worker = await readyWorker(ctx, `+3749110${phoneSuffix}`, north(YEREVAN_CENTER, 1_500), { name: 'Aram' });
  const client = await login(ctx, `+3749910${phoneSuffix}`, 'client');
  const order = await createOrder(ctx, client.token);
  const [offer] = await offersOf(ctx, order.body.id);
  await ctx.http.post(`/api/v1/offers/${offer!.id}/accept`).set(auth(worker.token)).expect(200);
  return { worker, client, orderId: order.body.id as string };
}

describe('order lifecycle with cash payment', () => {
  it('full flow: tracking, geofence, estimate, completion, 20% commission, confirmation, review', async () => {
    const { worker, client, orderId } = await acceptedOrder('001');

    // телефоны открываются только после принятия
    const card = await ctx.http.get(`/api/v1/orders/${orderId}`).set(auth(client.token)).expect(200);
    expect(card.body.performer.name).toBe('Aram');
    expect(card.body.contacts.workerPhone).toBe('+3749110001');

    // клиент подписывается на живую карту
    const clientSocket = await connectSocket(ctx, client.token);
    const joined = await clientSocket.emitWithAck(RT_EVENTS.orderJoin, { orderId });
    expect(joined.ok).toBe(true);

    await ctx.http
      .post(`/api/v1/orders/${orderId}/status`)
      .set(auth(worker.token))
      .send({ status: 'EN_ROUTE', location: north(YEREVAN_CENTER, 1_500) })
      .expect(200);

    // исполнитель шлёт геопозицию по сокету — клиент видит движение, расстояние и ETA
    const workerSocket = await connectSocket(ctx, worker.token);
    const seen = nextEvent<WorkerLocationPayload>(clientSocket, RT_EVENTS.locationWorker);
    const ack = await workerSocket.emitWithAck(RT_EVENTS.locationUpdate, {
      ...north(YEREVAN_CENTER, 800),
      speedMps: 8,
      heading: 180,
      recordedAt: new Date().toISOString(),
    });
    expect(ack).toEqual({ ok: true, orderId });
    const loc = await seen;
    expect(loc.orderId).toBe(orderId);
    expect(loc.distanceM).toBeGreaterThan(800);
    expect(loc.etaSeconds).toBeGreaterThan(0);

    // «мастер рядом» (500 м) — одно событие
    await workerSocket.emitWithAck(RT_EVENTS.locationUpdate, { ...north(YEREVAN_CENTER, 300), recordedAt: new Date().toISOString() });
    await workerSocket.emitWithAck(RT_EVENTS.locationUpdate, { ...north(YEREVAN_CENTER, 250), recordedAt: new Date().toISOString() });
    expect(await ctx.prisma.orderEvent.count({ where: { orderId, type: 'worker_nearby' } })).toBe(1);

    // «Прибыл» вне геозоны запрещено
    const far = await ctx.http
      .post(`/api/v1/orders/${orderId}/status`)
      .set(auth(worker.token))
      .send({ status: 'ARRIVED', location: north(YEREVAN_CENTER, 400) });
    expect(far.status).toBe(422);
    expect(far.body.code).toBe('OUTSIDE_GEOFENCE');
    await workerSocket.emitWithAck(RT_EVENTS.locationUpdate, { ...north(YEREVAN_CENTER, 30), recordedAt: new Date().toISOString() });
    await ctx.http.post(`/api/v1/orders/${orderId}/status`).set(auth(worker.token)).send({ status: 'ARRIVED', location: north(YEREVAN_CENTER, 50) }).expect(200);
    await ctx.http.post(`/api/v1/orders/${orderId}/status`).set(auth(worker.token)).send({ status: 'IN_PROGRESS', location: north(YEREVAN_CENTER, 10) }).expect(200);

    // время событий из сырых запросов (now()) в UTC, как у остальных колонок, при любом TimeZone сервера БД
    const events = await ctx.prisma.orderEvent.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
    for (const e of events) expect(Math.abs(e.createdAt.getTime() - Date.now())).toBeLessThan(60_000);
    expect(events.map((e) => e.type).slice(-2)).toEqual(['status_arrived', 'status_in_progress']);

    // завершить без подтверждённой сметы нельзя
    const early = await ctx.http.post(`/api/v1/orders/${orderId}/complete`).set(auth(worker.token)).send({ cashReceivedCents: 5_000, location: YEREVAN_CENTER });
    expect(early.body.code).toBe('NO_APPROVED_ESTIMATE');

    // смета: работа 30,00 + материалы 2 × 10,00 = 50,00
    const est = await ctx.http
      .post(`/api/v1/orders/${orderId}/estimates`)
      .set(auth(worker.token))
      .send({ items: [{ type: 'LABOR', title: 'Pipe repair', quantity: 1, unitCents: 3_000 }, { type: 'MATERIAL', title: 'Fitting', quantity: 2, unitCents: 1_000 }] })
      .expect(201);
    expect(est.body.totalCents).toBe(5_000);
    await ctx.http.post(`/api/v1/orders/${orderId}/estimates/1/approve`).set(auth(client.token)).expect(200);

    // «Завершил, получил наличными 50,00» → комиссия 20% = 10,00 списана из приветственного кредита 100,00
    const done = await ctx.http.post(`/api/v1/orders/${orderId}/complete`).set(auth(worker.token)).send({ cashReceivedCents: 5_000, location: YEREVAN_CENTER });
    expect(done.status).toBe(200);
    expect(done.body.commission).toEqual({ commissionCents: 1_000, bonusDiscountCents: 0, chargedCents: 1_000, toDebtCents: 0 });
    const wallet = await ctx.http.get('/api/v1/wallet').set(auth(worker.token)).expect(200);
    expect(wallet.body.promoCents).toBe(9_000);
    expect(wallet.body.withdrawable).toEqual({ topup: false, promo: false, bonus: false });

    // после завершения позиция клиенту больше не передаётся
    const rejoin = await clientSocket.emitWithAck(RT_EVENTS.orderJoin, { orderId });
    expect(rejoin.ok).toBe(false);

    // отзыв до подтверждения невозможен
    const tooEarly = await ctx.http.post(`/api/v1/orders/${orderId}/review`).set(auth(client.token)).send({ rating: 5 });
    expect(tooEarly.body.code).toBe('REVIEW_NOT_ALLOWED');

    const confirmed = await ctx.http.post(`/api/v1/orders/${orderId}/confirm-payment`).set(auth(client.token)).send({ cashPaidCents: 5_000 });
    expect(confirmed.body.status).toBe('CONFIRMED');
    const before = await ctx.http.get(`/api/v1/orders/${orderId}`).set(auth(client.token)).expect(200);
    expect(before.body.reviewedByMe).toBe(false);
    await ctx.http.post(`/api/v1/orders/${orderId}/review`).set(auth(client.token)).send({ rating: 5, text: 'Great' }).expect(200);
    const again = await ctx.http.post(`/api/v1/orders/${orderId}/review`).set(auth(client.token)).send({ rating: 1 });
    expect(again.body.code).toBe('REVIEW_NOT_ALLOWED');
    const after = await ctx.http.get(`/api/v1/orders/${orderId}`).set(auth(client.token)).expect(200);
    expect(after.body.reviewedByMe).toBe(true);
    const workerView = await ctx.http.get(`/api/v1/orders/${orderId}`).set(auth(worker.token)).expect(200);
    expect(workerView.body.reviewedByMe).toBe(false);
    const profile = await ctx.prisma.workerProfile.findUniqueOrThrow({ where: { userId: worker.userId } });
    expect(Number(profile.ratingAvg)).toBe(5);

    clientSocket.disconnect();
    workerSocket.disconnect();
  });

  it('cash amounts that do not match open a dispute automatically', async () => {
    const { worker, client, orderId } = await acceptedOrder('002');
    for (const status of ['EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] as const) {
      await ctx.http.post(`/api/v1/orders/${orderId}/status`).set(auth(worker.token)).send({ status, location: YEREVAN_CENTER }).expect(200);
    }
    await ctx.http.post(`/api/v1/orders/${orderId}/estimates`).set(auth(worker.token)).send({ items: [{ type: 'LABOR', title: 'Work', quantity: 1, unitCents: 8_000 }] }).expect(201);
    await ctx.http.post(`/api/v1/orders/${orderId}/estimates/1/approve`).set(auth(client.token)).expect(200);
    await ctx.http.post(`/api/v1/orders/${orderId}/complete`).set(auth(worker.token)).send({ cashReceivedCents: 8_000, location: YEREVAN_CENTER }).expect(200);
    const res = await ctx.http.post(`/api/v1/orders/${orderId}/confirm-payment`).set(auth(client.token)).send({ cashPaidCents: 6_000 });
    expect(res.body.status).toBe('DISPUTED');
    const dispute = await ctx.prisma.dispute.findFirstOrThrow({ where: { orderId } });
    expect(dispute).toMatchObject({ reason: 'CASH_AMOUNT_MISMATCH', isAutomatic: true, status: 'AWAITING_RESPONSE' });
  });

  it('auto-confirmation by timer marks the order "not confirmed by client"', async () => {
    const { worker, client, orderId } = await acceptedOrder('003');
    for (const status of ['EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] as const) {
      await ctx.http.post(`/api/v1/orders/${orderId}/status`).set(auth(worker.token)).send({ status, location: YEREVAN_CENTER }).expect(200);
    }
    await ctx.http.post(`/api/v1/orders/${orderId}/estimates`).set(auth(worker.token)).send({ items: [{ type: 'LABOR', title: 'Work', quantity: 1, unitCents: 4_000 }] }).expect(201);
    await ctx.http.post(`/api/v1/orders/${orderId}/estimates/1/approve`).set(auth(client.token)).expect(200);
    await ctx.http.post(`/api/v1/orders/${orderId}/complete`).set(auth(worker.token)).send({ cashReceivedCents: 4_000, location: YEREVAN_CENTER }).expect(200);
    expect(await ctx.jobs.exists(`autoconfirm_${orderId}`)).toBe(true);
    await ctx.app.get(OrdersService).autoConfirm(orderId);
    const order = await ctx.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('AUTO_CONFIRMED');
    expect(order.clientUnconfirmed).toBe(true);
  });

  it('client cancellation after the free window costs a penalty; when the pro has arrived — travel compensation', async () => {
    const { worker, client, orderId } = await acceptedOrder('004');
    await ctx.prisma.order.update({ where: { id: orderId }, data: { acceptedAt: new Date(Date.now() - 10 * 60_000) } });
    const preview = await ctx.http.get(`/api/v1/orders/${orderId}/cancel-preview`).query({ reason: 'changed_mind' }).set(auth(client.token)).expect(200);
    expect(preview.body).toEqual({ penaltyCents: 300, compensationCents: 0, createsReview: false });

    await ctx.http.post(`/api/v1/orders/${orderId}/status`).set(auth(worker.token)).send({ status: 'EN_ROUTE', location: YEREVAN_CENTER }).expect(200);
    await ctx.http.post(`/api/v1/orders/${orderId}/status`).set(auth(worker.token)).send({ status: 'ARRIVED', location: YEREVAN_CENTER }).expect(200);
    const cancel = await ctx.http.post(`/api/v1/orders/${orderId}/cancel`).set(auth(client.token)).send({ reason: 'changed_mind' }).expect(200);
    expect(cancel.body.compensationCents).toBe(1_500);
    const record = await ctx.prisma.cancellation.findUniqueOrThrow({ where: { orderId } });
    expect(record.statusAtCancel).toBe('ARRIVED');
  });

  it('complaint reason ("asks to pay outside the app") creates a review instead of a penalty', async () => {
    const { client, orderId } = await acceptedOrder('005');
    await ctx.prisma.order.update({ where: { id: orderId }, data: { acceptedAt: new Date(Date.now() - 30 * 60_000) } });
    const cancel = await ctx.http.post(`/api/v1/orders/${orderId}/cancel`).set(auth(client.token)).send({ reason: 'off_platform_payment' }).expect(200);
    expect(cancel.body).toMatchObject({ penaltyCents: 0, createsReview: true });
    expect(await ctx.prisma.fraudFlag.count({ where: { orderId, type: 'OFF_PLATFORM_ATTEMPT' } })).toBe(1);
  });

  it('pro cancels after acceptance: the order goes back to search, the pro never gets it again', async () => {
    const { worker, orderId } = await acceptedOrder('006');
    const other = await readyWorker(ctx, '+374911000099', north(YEREVAN_CENTER, 2_500));
    const res = await ctx.http.post(`/api/v1/orders/${orderId}/worker-cancel`).set(auth(worker.token)).send({ reason: 'vehicle_problem' }).expect(200);
    expect(res.body.status).toBe('CANCELLED_BY_WORKER');
    const offers = await offersOf(ctx, orderId);
    const pending = offers.filter((o) => o.status === 'PENDING');
    expect(pending.map((o) => o.workerId)).toEqual([other.userId]);
  });

  it('chat filter hides phones and messengers and flags the attempt', async () => {
    const { worker, client, orderId } = await acceptedOrder('007');
    const res = await ctx.http.post(`/api/v1/orders/${orderId}/messages`).set(auth(worker.token)).send({ body: 'Pay me via WhatsApp +374 91 22 33 44' }).expect(201);
    expect(res.body.filtered).toBe(true);
    expect(res.body.body).not.toContain('22 33 44');
    expect(res.body.warningKey).toBe('chat.off_platform_warning');
    const history = await ctx.http.get(`/api/v1/orders/${orderId}/messages`).set(auth(client.token)).expect(200);
    expect(history.body).toHaveLength(1);
    const stranger = await login(ctx, '+374990000777', 'client');
    await ctx.http.get(`/api/v1/orders/${orderId}/messages`).set(auth(stranger.token)).expect(404);
  });

  it('IDOR: another client cannot see the order or the track', async () => {
    const { orderId } = await acceptedOrder('008');
    const stranger = await login(ctx, '+374990000888', 'client');
    await ctx.http.get(`/api/v1/orders/${orderId}`).set(auth(stranger.token)).expect(404);
    await ctx.http.get(`/api/v1/orders/${orderId}/track`).set(auth(stranger.token)).expect(404);
    expect(await ctx.app.get(TrackingService).canJoinOrderRoom(stranger.userId, 'CLIENT', orderId)).toBe(false);
  });

  it('track retention deletes old points except for orders with an open dispute; watchdog marks lost connection', async () => {
    const { worker, orderId } = await acceptedOrder('009');
    const tracking = ctx.app.get(TrackingService);
    await tracking.ingest(worker.userId, [{ ...YEREVAN_CENTER, recordedAt: new Date().toISOString() }]);
    await ctx.prisma.$executeRaw`UPDATE "LocationPoint" SET "recordedAt" = now() - interval '200 days'`;
    await ctx.prisma.dispute.create({ data: { orderId, openedById: worker.userId, reason: 'OTHER', description: 'keep evidence' } });
    expect(await tracking.purgeOldTracks()).toBe(0);
    await ctx.prisma.dispute.updateMany({ data: { status: 'CLOSED' } });
    expect(await tracking.purgeOldTracks()).toBe(1);

    await ctx.redis.set(`trk:last:${orderId}`, String(Date.now() - 120_000));
    expect(await tracking.watchdog()).toBe(1);
    expect(await tracking.watchdog()).toBe(0);
  });
});
