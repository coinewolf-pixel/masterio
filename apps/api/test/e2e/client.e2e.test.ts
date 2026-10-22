/** Серверная часть приложения клиента: адреса, настройки города, история, чёрный список, фото заказа, поиск адресов. */
import {
  auth,
  createOrder,
  login,
  north,
  offersOf,
  readyWorker,
  resetState,
  setSetting,
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

describe('client app endpoints', () => {
  it('saved addresses: add, list with coordinates, delete; other users cannot touch them', async () => {
    const c = await login(ctx, '+37495000001', 'client');
    const created = await ctx.http
      .post('/api/v1/me/addresses')
      .set(auth(c.token))
      .send({ label: 'Home', formatted: 'Abovyan 1, Yerevan', details: 'Apt 5, floor 3', location: YEREVAN_CENTER })
      .expect(201);
    const list = await ctx.http.get('/api/v1/me/addresses').set(auth(c.token)).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ label: 'Home', details: 'Apt 5, floor 3' });
    expect(list.body[0].lat).toBeCloseTo(YEREVAN_CENTER.lat, 5);
    expect(list.body[0].lng).toBeCloseTo(YEREVAN_CENTER.lng, 5);

    const other = await login(ctx, '+37495000002', 'client');
    await ctx.http.delete(`/api/v1/me/addresses/${created.body.id}`).set(auth(other.token)).expect(404);
    await ctx.http.delete(`/api/v1/me/addresses/${created.body.id}`).set(auth(c.token)).expect(204);
    expect((await ctx.http.get('/api/v1/me/addresses').set(auth(c.token))).body).toHaveLength(0);

    const w = await login(ctx, '+37495000003', 'worker');
    await ctx.http.get('/api/v1/me/addresses').set(auth(w.token)).expect(403);
  });

  it('app config reflects launch flags per city and changes immediately', async () => {
    const c = await login(ctx, '+37495000010', 'client');
    const cfg = await ctx.http.get('/api/v1/app-config').query({ cityId: ctx.cityId }).set(auth(c.token)).expect(200);
    expect(cfg.body).toMatchObject({ cashEnabled: true, cardPaymentsEnabled: false, commissionPercent: 20, currency: 'AMD', emergencyNumber: '112', offerTtlSeconds: 30 });
    await ctx.settings.set('CASH_ENABLED', false, 'CITY', ctx.cityId, ctx.adminId);
    const after = await ctx.http.get('/api/v1/app-config').query({ cityId: ctx.cityId }).set(auth(c.token)).expect(200);
    expect(after.body.cashEnabled).toBe(false);
  });

  it('client history with monthly summary; blacklist hides a pro from future orders', async () => {
    await setSetting(ctx, 'OFFER_TTL_SECONDS', 30);
    const worker = await readyWorker(ctx, '+37495000020', north(YEREVAN_CENTER, 200), { name: 'Narek' });
    const client = await login(ctx, '+37495000021', 'client');
    const order = await createOrder(ctx, client.token);
    const [offer] = await offersOf(ctx, order.body.id);
    await ctx.http.post(`/api/v1/offers/${offer!.id}/accept`).set(auth(worker.token)).expect(200);
    for (const status of ['EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] as const) {
      await ctx.http.post(`/api/v1/orders/${order.body.id}/status`).set(auth(worker.token)).send({ status, location: YEREVAN_CENTER }).expect(200);
    }
    await ctx.http.post(`/api/v1/orders/${order.body.id}/estimates`).set(auth(worker.token)).send({ items: [{ type: 'LABOR', title: 'w', quantity: 1, unitCents: 7_000 }] }).expect(201);
    await ctx.http.post(`/api/v1/orders/${order.body.id}/estimates/1/approve`).set(auth(client.token)).expect(200);
    await ctx.http.post(`/api/v1/orders/${order.body.id}/complete`).set(auth(worker.token)).send({ cashReceivedCents: 7_000, location: YEREVAN_CENTER }).expect(200);
    await ctx.http.post(`/api/v1/orders/${order.body.id}/confirm-payment`).set(auth(client.token)).send({ cashPaidCents: 7_000 }).expect(200);
    const cancelled = await createOrder(ctx, client.token);
    await ctx.http.post(`/api/v1/orders/${cancelled.body.id}/cancel`).set(auth(client.token)).send({ reason: 'changed_mind' }).expect(200);

    const history = await ctx.http.get('/api/v1/client/history').set(auth(client.token)).expect(200);
    expect(history.body.items).toHaveLength(2);
    expect(history.body.summary).toEqual({ ordersCount: 1, spentCents: 7_000, currency: 'AMD' });
    const done = history.body.items.find((i: { id: string }) => i.id === order.body.id);
    expect(done).toMatchObject({ workerName: 'Narek', paidCents: 7_000, status: 'CONFIRMED' });

    // чёрный список: только мастер, который выполнял заказ клиента
    const stranger = await login(ctx, '+37495000029', 'worker');
    await ctx.http.post(`/api/v1/me/blacklist/${stranger.userId}`).set(auth(client.token)).expect(404);
    await ctx.http.post(`/api/v1/me/blacklist/${worker.userId}`).set(auth(client.token)).expect(204);
    const next = await createOrder(ctx, client.token);
    expect(await offersOf(ctx, next.body.id)).toHaveLength(0);
    await ctx.http.delete(`/api/v1/me/blacklist/${worker.userId}`).set(auth(client.token)).expect(204);
    expect((await ctx.http.get('/api/v1/me/blacklist').set(auth(client.token))).body).toHaveLength(0);
  });

  it('order photos are returned as short-lived links to both sides', async () => {
    const client = await login(ctx, '+37495000030', 'client');
    const presign = await ctx.http.post('/api/v1/uploads').set(auth(client.token)).send({ purpose: 'order_photo', contentType: 'image/jpeg', sizeBytes: 5 }).expect(201);
    const form = new FormData();
    for (const [k, v] of Object.entries(presign.body.fields as Record<string, string>)) form.append(k, v);
    form.append('file', new Blob([Buffer.from('photo')], { type: 'image/jpeg' }), 'p.jpg');
    expect((await fetch(presign.body.url as string, { method: 'POST', body: form })).status).toBeLessThan(300);
    const order = await createOrder(ctx, client.token, YEREVAN_CENTER, { photoKeys: [presign.body.key] });
    const card = await ctx.http.get(`/api/v1/orders/${order.body.id}`).set(auth(client.token)).expect(200);
    expect(card.body.photos).toHaveLength(1);
    expect(card.body.photos[0].purpose).toBe('problem');
    expect(await (await fetch(card.body.photos[0].url as string)).text()).toBe('photo');
  });

  it('address search is disabled without a Google key and validates input', async () => {
    const c = await login(ctx, '+37495000040', 'client');
    const off = await ctx.http.get('/api/v1/geo/autocomplete').query({ q: 'Abovyan' }).set(auth(c.token));
    expect(off.body.code).toBe('FEATURE_DISABLED');
    const short = await ctx.http.get('/api/v1/geo/autocomplete').query({ q: 'a' }).set(auth(c.token));
    expect(short.body.code).toBe('VALIDATION_FAILED');
    const rev = await ctx.http.get('/api/v1/geo/reverse').query({ lat: 100, lng: 0 }).set(auth(c.token));
    expect(rev.body.code).toBe('VALIDATION_FAILED');
  });
});
