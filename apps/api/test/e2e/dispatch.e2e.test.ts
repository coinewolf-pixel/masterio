/**
 * Обязательные тесты рассылки (раздел 15):
 * строго по одному мастеру; через TTL предложение исчезает и уходит следующему; второй круг идёт по не ответившим
 * и пропускает отказавшихся; одновременное принятие двумя даёт ровно одного победителя; перезапуск не ломает очередь.
 */
import { RT_EVENTS, settingDefault, type OfferClosedPayload, type OfferNewPayload } from '@masterio/shared';
import { DispatchService } from '../../src/dispatch/dispatch.service';
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
  setSetting,
  startApp,
  stopApp,
  waitFor,
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

describe('dispatch: one pro at a time, in rounds', () => {
  it('default offer TTL is 30 seconds', () => {
    expect(settingDefault('OFFER_TTL_SECONDS')).toBe(30);
    expect(ctx.settings.get('OFFER_TTL_SECONDS')).toBe(30);
  });

  it('offers the order to exactly one pro — the nearest/best — and nobody else', async () => {
    const near = await readyWorker(ctx, '+37491000001', north(YEREVAN_CENTER, 300));
    await readyWorker(ctx, '+37491000002', north(YEREVAN_CENTER, 2_000));
    await readyWorker(ctx, '+37491000003', north(YEREVAN_CENTER, 4_000));
    const client = await login(ctx, '+37499000001', 'client');

    const res = await createOrder(ctx, client.token);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('SEARCHING');

    const offers = await offersOf(ctx, res.body.id);
    expect(offers).toHaveLength(1);
    expect(offers[0]?.workerId).toBe(near.userId);
    expect(offers[0]?.status).toBe('PENDING');
    const ttl = (offers[0]!.expiresAt.getTime() - offers[0]!.sentAt.getTime()) / 1000;
    expect(ttl).toBeGreaterThan(29);
    expect(ttl).toBeLessThanOrEqual(30.5);
    // push высокого приоритета ушёл только первому
    const offerPushes = ctx.push.sent.filter((p) => p.message.data.type === 'push.offer_new');
    expect(offerPushes).toHaveLength(1);
    expect(offerPushes[0]?.tokens).toEqual(['push-+37491000001']);
    expect(offerPushes[0]?.message.priority).toBe('high');
    expect(offerPushes[0]?.message.title).toBe('Новый заказ');
  });

  it('after TTL the offer disappears (card closed) and goes to the next pro', async () => {
    await setSetting(ctx, 'OFFER_TTL_SECONDS', 1);
    const first = await readyWorker(ctx, '+37491000011', north(YEREVAN_CENTER, 200));
    const second = await readyWorker(ctx, '+37491000012', north(YEREVAN_CENTER, 1_500));
    const socket = await connectSocket(ctx, first.token);
    const client = await login(ctx, '+37499000011', 'client');

    const newOffer = nextEvent<OfferNewPayload>(socket, RT_EVENTS.offerNew);
    const res = await createOrder(ctx, client.token);
    const announced = await newOffer;
    expect(announced.orderId).toBe(res.body.id);
    const closed = await nextEvent<OfferClosedPayload>(socket, RT_EVENTS.offerClosed, 5_000);
    expect(closed.reason).toBe('expired');

    const offers = await waitFor(() => offersOf(ctx, res.body.id), (o) => o.length === 2);
    expect(offers[0]).toMatchObject({ workerId: first.userId, status: 'EXPIRED' });
    expect(offers[1]).toMatchObject({ workerId: second.userId, status: 'PENDING', round: 1 });
    socket.disconnect();
  });

  it('opening details does not extend the timer; accepting after expiry is rejected by server time', async () => {
    await setSetting(ctx, 'OFFER_TTL_SECONDS', 1);
    const w = await readyWorker(ctx, '+37491000021', north(YEREVAN_CENTER, 200));
    await readyWorker(ctx, '+37491000022', north(YEREVAN_CENTER, 900));
    const client = await login(ctx, '+37499000021', 'client');
    const res = await createOrder(ctx, client.token);
    const [offer] = await offersOf(ctx, res.body.id);

    const details = await ctx.http.get('/api/v1/offers/current').set(auth(w.token)).expect(200);
    expect(details.body.offer.expiresAt).toBe(offer!.expiresAt.toISOString());
    // останавливаем обработчик очереди, чтобы проверить именно проверку времени при принятии
    await ctx.jobs.stopWorker();
    await new Promise((r) => setTimeout(r, 1_200));
    const late = await ctx.http.post(`/api/v1/offers/${offer!.id}/accept`).set(auth(w.token));
    expect(late.status).toBe(410);
    expect(late.body.code).toBe('OFFER_EXPIRED');
    ctx.jobs.startWorker();
    const offers = await waitFor(() => offersOf(ctx, res.body.id), (o) => o.length === 2);
    expect(offers[0]?.status).toBe('EXPIRED');
  });

  it('round 2 goes to those who did not answer and skips those who declined; then "no pros now"', async () => {
    await setSetting(ctx, 'OFFER_TTL_SECONDS', 1);
    await setSetting(ctx, 'MAX_ROUNDS', 2);
    const a = await readyWorker(ctx, '+37491000031', north(YEREVAN_CENTER, 100));
    const b = await readyWorker(ctx, '+37491000032', north(YEREVAN_CENTER, 1_000));
    const c = await readyWorker(ctx, '+37491000033', north(YEREVAN_CENTER, 2_000));
    const client = await login(ctx, '+37499000031', 'client');
    const res = await createOrder(ctx, client.token);
    const orderId = res.body.id as string;

    const [toA] = await offersOf(ctx, orderId);
    expect(toA?.workerId).toBe(a.userId);
    await ctx.http.post(`/api/v1/offers/${toA!.id}/decline`).set(auth(a.token)).expect(204);

    const final = await waitFor(
      () => ctx.prisma.order.findUniqueOrThrow({ where: { id: orderId } }),
      (o) => o.status === 'NO_WORKERS',
      15_000,
    );
    expect(final.dispatchRound).toBe(2);
    const offers = await offersOf(ctx, orderId);
    const round1 = offers.filter((o) => o.round === 1).map((o) => o.workerId);
    const round2 = offers.filter((o) => o.round === 2).map((o) => o.workerId);
    expect(round1).toEqual([a.userId, b.userId, c.userId]);
    expect(round2).toEqual([b.userId, c.userId]);
    expect(round2).not.toContain(a.userId);
    expect(offers.filter((o) => o.workerId === a.userId)).toHaveLength(1);
    expect(offers.filter((o) => o.status === 'PENDING')).toHaveLength(0);
  });

  it('two pros accepting at the same time: exactly one winner, the other gets "already taken"', async () => {
    await setSetting(ctx, 'BATCH_SIZE', 2);
    const w1 = await readyWorker(ctx, '+37491000041', north(YEREVAN_CENTER, 300));
    const w2 = await readyWorker(ctx, '+37491000042', north(YEREVAN_CENTER, 600));
    const client = await login(ctx, '+37499000041', 'client');
    const res = await createOrder(ctx, client.token);
    const offers = await offersOf(ctx, res.body.id);
    expect(offers).toHaveLength(2);
    const byWorker = new Map(offers.map((o) => [o.workerId, o.id]));

    const [r1, r2] = await Promise.all([
      ctx.http.post(`/api/v1/offers/${byWorker.get(w1.userId)}/accept`).set(auth(w1.token)),
      ctx.http.post(`/api/v1/offers/${byWorker.get(w2.userId)}/accept`).set(auth(w2.token)),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = r1.status === 409 ? r1 : r2;
    expect(loser.body.code).toBe('ORDER_ALREADY_TAKEN');

    const order = await ctx.prisma.order.findUniqueOrThrow({ where: { id: res.body.id } });
    const winnerId = r1.status === 200 ? w1.userId : w2.userId;
    expect(order.status).toBe('ACCEPTED');
    expect(order.workerId).toBe(winnerId);
    const after = await offersOf(ctx, res.body.id);
    expect(after.filter((o) => o.status === 'ACCEPTED')).toHaveLength(1);
  });

  it('many simultaneous accepts of the same offer and a parallel accept race still give one winner', async () => {
    await setSetting(ctx, 'BATCH_SIZE', 3);
    const ws = await Promise.all(
      ['+37491000051', '+37491000052', '+37491000053'].map((p, i) => readyWorker(ctx, p, north(YEREVAN_CENTER, 200 + i * 200))),
    );
    const client = await login(ctx, '+37499000051', 'client');
    const res = await createOrder(ctx, client.token);
    const offers = await offersOf(ctx, res.body.id);
    expect(offers).toHaveLength(3);
    const results = await Promise.all(
      offers.flatMap((o) => {
        const w = ws.find((x) => x.userId === o.workerId)!;
        return [0, 1].map(() => ctx.http.post(`/api/v1/offers/${o.id}/accept`).set(auth(w.token)));
      }),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  });

  it('client cancels while the offer is open: the pro sees "order unavailable"', async () => {
    const w = await readyWorker(ctx, '+37491000061', north(YEREVAN_CENTER, 300));
    const socket = await connectSocket(ctx, w.token);
    const client = await login(ctx, '+37499000061', 'client');
    const offered = nextEvent<OfferNewPayload>(socket, RT_EVENTS.offerNew);
    const res = await createOrder(ctx, client.token);
    const offer = await offered;
    const closed = nextEvent<OfferClosedPayload>(socket, RT_EVENTS.offerClosed);
    const cancel = await ctx.http.post(`/api/v1/orders/${res.body.id}/cancel`).set(auth(client.token)).send({ reason: 'changed_mind' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.penaltyCents).toBe(0);
    expect((await closed).reason).toBe('cancelled');
    const accept = await ctx.http.post(`/api/v1/offers/${offer.offerId}/accept`).set(auth(w.token));
    expect(accept.status).toBe(410);
    expect(accept.body.code).toBe('OFFER_NOT_ACTIVE');
    socket.disconnect();
  });

  it('pros with too little balance, offline, without KYC or out of radius get nothing', async () => {
    await readyWorker(ctx, '+37491000071', north(YEREVAN_CENTER, 300), { promoCents: 500 });
    const noKyc = await readyWorker(ctx, '+37491000072', north(YEREVAN_CENTER, 300));
    await ctx.prisma.workerProfile.update({ where: { userId: noKyc.userId }, data: { kycStatus: 'NOT_VERIFIED' } });
    const offline = await readyWorker(ctx, '+37491000073', north(YEREVAN_CENTER, 300));
    await ctx.http.post('/api/v1/worker/offline').set(auth(offline.token)).expect(200);
    await readyWorker(ctx, '+37491000074', north(YEREVAN_CENTER, 15_000));
    const client = await login(ctx, '+37499000071', 'client');

    const availability = await ctx.http
      .get('/api/v1/availability')
      .query({ cityId: ctx.cityId, categoryId: ctx.categoryId, lat: YEREVAN_CENTER.lat, lng: YEREVAN_CENTER.lng })
      .set(auth(client.token))
      .expect(200);
    expect(availability.body.availableCount).toBe(0);
    expect(availability.body.suggestExpandRadius).toBe(true);

    const res = await createOrder(ctx, client.token);
    expect(await offersOf(ctx, res.body.id)).toHaveLength(0);
    const order = await ctx.prisma.order.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(order.status).toBe('NO_WORKERS');

    // клиент расширяет радиус — заказ уходит дальнему мастеру
    const restart = await ctx.http.post(`/api/v1/orders/${res.body.id}/restart-search`).set(auth(client.token)).send({ radiusM: 20_000 });
    expect(restart.status).toBe(200);
    expect(restart.body.status).toBe('SEARCHING');
    expect(await offersOf(ctx, res.body.id)).toHaveLength(1);
  });

  it('server restart does not lose timers: expired offers are closed and dispatch continues', async () => {
    await setSetting(ctx, 'OFFER_TTL_SECONDS', 2);
    const first = await readyWorker(ctx, '+37491000081', north(YEREVAN_CENTER, 200));
    const second = await readyWorker(ctx, '+37491000082', north(YEREVAN_CENTER, 1_000));
    const client = await login(ctx, '+37499000081', 'client');
    const res = await createOrder(ctx, client.token);
    const orderId = res.body.id as string;
    expect((await offersOf(ctx, orderId))[0]?.workerId).toBe(first.userId);

    // «падение» сервера: процесс закрыт, задача таймера осталась в Redis
    await stopApp(ctx);
    await new Promise((r) => setTimeout(r, 2_500));
    ctx = await startApp();

    const offers = await waitFor(() => offersOf(ctx, orderId), (o) => o.length === 2 && o[1]?.status === 'PENDING');
    expect(offers[0]).toMatchObject({ workerId: first.userId, status: 'EXPIRED' });
    expect(offers[1]).toMatchObject({ workerId: second.userId, status: 'PENDING' });
  });

  it('restart with lost Redis timers: recover() recreates them', async () => {
    await setSetting(ctx, 'OFFER_TTL_SECONDS', 2);
    const first = await readyWorker(ctx, '+37491000091', north(YEREVAN_CENTER, 200));
    await readyWorker(ctx, '+37491000092', north(YEREVAN_CENTER, 1_000));
    const client = await login(ctx, '+37499000091', 'client');
    const res = await createOrder(ctx, client.token);
    const orderId = res.body.id as string;

    await ctx.jobs.stopWorker();
    await ctx.redis.flushdb(); // Redis потерял все задачи
    ctx.jobs.startWorker();
    const recovered = await ctx.app.get(DispatchService).recover();
    expect(recovered.rescheduled).toBe(1);

    const offers = await waitFor(() => offersOf(ctx, orderId), (o) => o.length === 2, 8_000);
    expect(offers[0]).toMatchObject({ workerId: first.userId, status: 'EXPIRED' });
  });
});
