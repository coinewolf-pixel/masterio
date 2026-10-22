/** E2E: CRM (раздел 14) — роли, дашборд, заказы, отмена поддержкой, люди, админы, справочники, финансы, настройки, карта. */
import { authenticator } from 'otplib';
import { RT_EVENTS, type AdminMapPayload } from '@masterio/shared';
import {
  auth,
  connectSocket,
  createAdmin,
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
let root: { id: string; token: string };

const NAMES = { en: 'Locksmith pro', ru: 'Слесарь', de: 'Schlosser', es: 'Cerrajero', hy: 'Փականագործ' };

beforeAll(async () => {
  ctx = await startApp();
});
afterAll(async () => {
  await stopApp(ctx);
});
beforeEach(async () => {
  await resetState(ctx);
  root = await createAdmin(ctx, 'boss@masterio.test', ['SUPERADMIN']);
});

async function acceptedOrder(suffix: string) {
  const worker = await readyWorker(ctx, `+3749120${suffix}`, north(YEREVAN_CENTER, 1_500), { name: 'Aram' });
  const client = await login(ctx, `+3749920${suffix}`, 'client');
  await ctx.http.patch('/api/v1/me').set(auth(client.token)).send({ firstName: 'Anna' }).expect(200);
  const order = await createOrder(ctx, client.token);
  const [offer] = await offersOf(ctx, order.body.id);
  await ctx.http.post(`/api/v1/offers/${offer!.id}/accept`).set(auth(worker.token)).expect(200);
  return { worker, client, orderId: order.body.id as string };
}

/** Заказ до подтверждения клиентом: смета 50,00 → комиссия 10,00 из приветственного кредита. */
async function completedOrder(suffix: string, chat?: string) {
  const o = await acceptedOrder(suffix);
  const w = auth(o.worker.token);
  if (chat) await ctx.http.post(`/api/v1/orders/${o.orderId}/messages`).set(auth(o.client.token)).send({ body: chat }).expect(201);
  await ctx.http.post(`/api/v1/orders/${o.orderId}/status`).set(w).send({ status: 'EN_ROUTE', location: north(YEREVAN_CENTER, 1_500) }).expect(200);
  await ctx.http.post('/api/v1/tracking/batch').set(w).send({ points: [{ ...north(YEREVAN_CENTER, 20), recordedAt: new Date().toISOString() }] }).expect(200);
  await ctx.http.post(`/api/v1/orders/${o.orderId}/status`).set(w).send({ status: 'ARRIVED', location: north(YEREVAN_CENTER, 20) }).expect(200);
  await ctx.http.post(`/api/v1/orders/${o.orderId}/status`).set(w).send({ status: 'IN_PROGRESS', location: north(YEREVAN_CENTER, 10) }).expect(200);
  await ctx.http
    .post(`/api/v1/orders/${o.orderId}/estimates`)
    .set(w)
    .send({ items: [{ type: 'LABOR', title: 'Repair', quantity: 1, unitCents: 5_000 }] })
    .expect(201);
  await ctx.http.post(`/api/v1/orders/${o.orderId}/estimates/1/approve`).set(auth(o.client.token)).expect(200);
  await ctx.http.post(`/api/v1/orders/${o.orderId}/complete`).set(w).send({ cashReceivedCents: 5_000, location: YEREVAN_CENTER }).expect(200);
  await ctx.http.post(`/api/v1/orders/${o.orderId}/confirm-payment`).set(auth(o.client.token)).send({ cashPaidCents: 5_000 }).expect(200);
  return o;
}

describe('CRM access by role', () => {
  it('each sub-role sees only its sections', async () => {
    const support = await createAdmin(ctx, 'support@masterio.test', ['SUPPORT']);
    const finance = await createAdmin(ctx, 'finance@masterio.test', ['FINANCE']);
    const period = `from=${encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`;

    const me = await ctx.http.get('/api/v1/admin/me').set(auth(support.token)).expect(200);
    expect(me.body).toMatchObject({ email: 'support@masterio.test', subRoles: ['SUPPORT'] });

    expect((await ctx.http.get(`/api/v1/admin/finance/summary?${period}`).set(auth(support.token))).status).toBe(403);
    await ctx.http.get(`/api/v1/admin/finance/summary?${period}`).set(auth(finance.token)).expect(200);
    expect((await ctx.http.get('/api/v1/admin/admins').set(auth(finance.token))).status).toBe(403);
    expect((await ctx.http.post('/api/v1/admin/catalog/groups').set(auth(support.token)).send({ code: 'x1', names: NAMES })).status).toBe(403);
    await ctx.http.get('/api/v1/admin/catalog').set(auth(support.token)).expect(200);
    await ctx.http.get('/api/v1/admin/orders').set(auth(support.token)).expect(200);

    // клиент и мастер в CRM не попадают
    const client = await login(ctx, '+37499200999', 'client');
    expect((await ctx.http.get('/api/v1/admin/dashboard').set(auth(client.token))).status).toBe(403);
  });
});

describe('dashboard and live map', () => {
  it('counts today, online workers per city and warns when a city has too few', async () => {
    const before = await ctx.http.get('/api/v1/admin/dashboard?tz=Asia/Yerevan').set(auth(root.token)).expect(200);
    const city = before.body.cities.find((c: { cityId: string }) => c.cityId === ctx.cityId);
    expect(city).toMatchObject({ online: 0, lowWorkers: true, minimum: 3 });
    expect(before.body.commissionToday).toEqual([]);
    expect((await ctx.http.get('/api/v1/admin/dashboard?tz=Mars/Base').set(auth(root.token))).status).toBe(400);

    await acceptedOrder('001');
    const after = await ctx.http.get('/api/v1/admin/dashboard?tz=Asia/Yerevan').set(auth(root.token)).expect(200);
    expect(after.body.today.created).toBe(1);
    expect(after.body.now.performing).toBe(1);
    expect(after.body.now.onlineWorkers).toBe(1);
    expect(after.body.cities.find((c: { cityId: string }) => c.cityId === ctx.cityId)).toMatchObject({ online: 1, active: 1 });

    // финансовые цифры видны только finance/superadmin
    const support = await createAdmin(ctx, 'support@masterio.test', ['SUPPORT']);
    const forSupport = await ctx.http.get('/api/v1/admin/dashboard').set(auth(support.token)).expect(200);
    expect(forSupport.body.commissionToday).toBeNull();
  });

  it('map snapshot shows online workers with names and active orders; admins receive live deltas', async () => {
    const { worker, orderId } = await acceptedOrder('002');
    const snap = await ctx.http.get('/api/v1/admin/map/snapshot').set(auth(root.token)).expect(200);
    expect(snap.body.workers).toEqual([expect.objectContaining({ userId: worker.userId, name: 'Aram', busy: true })]);
    expect(snap.body.orders).toEqual([expect.objectContaining({ id: orderId, status: 'ACCEPTED', workerId: worker.userId })]);

    const socket = await connectSocket(ctx, root.token);
    const delta = nextEvent<AdminMapPayload>(socket, RT_EVENTS.adminMap);
    await ctx.http.post('/api/v1/tracking/batch').set(auth(worker.token)).send({ points: [{ ...north(YEREVAN_CENTER, 900), recordedAt: new Date().toISOString() }] }).expect(200);
    const event = await delta;
    expect(['worker', 'performer']).toContain(event.kind);
    expect(event.userId).toBe(worker.userId);
    socket.disconnect();
  });
});

describe('orders in CRM', () => {
  it('lists with filters and opens the full card: dispatch log, chat, track, ledger', async () => {
    const { worker, orderId } = await completedOrder('003', 'Call me +37499111222');

    const list = await ctx.http.get(`/api/v1/admin/orders?status=CONFIRMED&cityId=${ctx.cityId}`).set(auth(root.token)).expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0]).toMatchObject({ id: orderId, client: { name: 'Anna' }, worker: { name: 'Aram' }, commissionCents: 1_000 });
    const byNumber = await ctx.http.get(`/api/v1/admin/orders?number=${list.body.items[0].number}`).set(auth(root.token)).expect(200);
    expect(byNumber.body.items).toHaveLength(1);
    expect((await ctx.http.get('/api/v1/admin/orders?status=SEARCHING').set(auth(root.token))).body.total).toBe(0);
    expect((await ctx.http.get('/api/v1/admin/orders?status=WRONG').set(auth(root.token))).status).toBe(400);

    const card = await ctx.http.get(`/api/v1/admin/orders/${orderId}`).set(auth(root.token)).expect(200);
    expect(card.body.offers[0]).toMatchObject({ workerId: worker.userId, workerName: 'Aram', status: 'ACCEPTED' });
    expect(card.body.messages[0].filtered).toBe(true);
    expect(card.body.messages[0].body).not.toContain('37499111222');
    expect(card.body.track.length).toBeGreaterThanOrEqual(1);
    expect(card.body.ledger).toEqual([
      expect.objectContaining({ kind: 'COMMISSION', entries: expect.arrayContaining([expect.objectContaining({ account: 'PLATFORM_REVENUE', amountCents: 1_000 })]) }),
    ]);
    expect(card.body.events.map((e: { type: string }) => e.type)).toContain('created');
    expect(card.body.location).toEqual({ lat: expect.any(Number), lng: expect.any(Number) });
  });

  it('support cancels an active order without fees; the worker is free again; completed orders cannot be cancelled', async () => {
    const support = await createAdmin(ctx, 'support@masterio.test', ['SUPPORT']);
    const { worker, orderId } = await acceptedOrder('004');
    expect((await ctx.http.post(`/api/v1/admin/orders/${orderId}/cancel`).set(auth(support.token)).send({ reason: '' })).status).toBe(400);
    const res = await ctx.http.post(`/api/v1/admin/orders/${orderId}/cancel`).set(auth(support.token)).send({ reason: 'Client called support: duplicate order' }).expect(200);
    expect(res.body.status).toBe('CANCELLED_BY_ADMIN');
    const order = await ctx.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { cancellation: true } });
    expect(order.cancellation).toMatchObject({ actor: 'ADMIN', penaltyCents: 0, compensationCents: 0 });
    const eligibility = await ctx.http.get('/api/v1/worker/eligibility').set(auth(worker.token)).expect(200);
    expect(eligibility.body.reasons).not.toContain('active_order');
    expect(await ctx.prisma.adminAuditLog.count({ where: { action: 'order.cancel', entityId: orderId } })).toBe(1);

    await ctx.http.post('/api/v1/worker/offline').set(auth(worker.token)).expect(200);
    const done = await completedOrder('005');
    const again = await ctx.http.post(`/api/v1/admin/orders/${done.orderId}/cancel`).set(auth(support.token)).send({ reason: 'Too late to cancel' });
    expect(again.body.code).toBe('ORDER_NOT_CANCELLABLE');
  });
});

describe('people', () => {
  it('finds workers and clients by phone, shows details, blocks and unblocks', async () => {
    const { worker, client } = await acceptedOrder('006');
    const found = await ctx.http.get('/api/v1/admin/workers?q=9120006').set(auth(root.token)).expect(200);
    expect(found.body.items).toEqual([expect.objectContaining({ id: worker.userId, name: 'Aram', kycStatus: 'VERIFIED', isOnline: true })]);
    expect((await ctx.http.get('/api/v1/admin/workers?q=000000000').set(auth(root.token))).body.items).toEqual([]);

    const detail = await ctx.http.get(`/api/v1/admin/workers/${worker.userId}`).set(auth(root.token)).expect(200);
    expect(detail.body.stats).toMatchObject({ total: 1, active: 1 });
    expect(detail.body.eligibility.reasons).toContain('active_order');
    expect(detail.body.grants).toHaveLength(1);

    const clients = await ctx.http.get(`/api/v1/admin/clients?q=${encodeURIComponent('+3749920006')}`).set(auth(root.token)).expect(200);
    expect(clients.body.items[0]).toMatchObject({ id: client.userId, name: 'Anna' });
    const clientCard = await ctx.http.get(`/api/v1/admin/clients/${client.userId}`).set(auth(root.token)).expect(200);
    expect(clientCard.body.orders).toHaveLength(1);

    await ctx.http.post(`/api/v1/admin/users/${client.userId}/block`).set(auth(root.token)).send({ reason: 'Abusive messages' }).expect(200);
    expect((await ctx.http.get('/api/v1/me').set(auth(client.token))).body.code).toBe('ACCOUNT_BLOCKED');
    await ctx.http.post(`/api/v1/admin/users/${client.userId}/unblock`).set(auth(root.token)).send({ reason: 'Appeal accepted' }).expect(200);
    await ctx.http.get('/api/v1/me').set(auth(client.token)).expect(200);
    expect(await ctx.prisma.adminAuditLog.count({ where: { entityId: client.userId, action: { in: ['user.block', 'user.unblock'] } } })).toBe(2);
  });
});

describe('admins and permissions', () => {
  it('superadmin creates an admin with TOTP, changes roles, resets TOTP, deactivates', async () => {
    const created = await ctx.http
      .post('/api/v1/admin/admins')
      .set(auth(root.token))
      .send({ email: 'Mod@Masterio.test', password: 'Very-Strong-Pass-1', subRoles: ['MODERATOR'] })
      .expect(201);
    expect(created.body.totpUri).toMatch(/^otpauth:\/\/totp\//);
    expect((await ctx.http.post('/api/v1/admin/admins').set(auth(root.token)).send({ email: 'mod@masterio.test', password: 'Very-Strong-Pass-1', subRoles: ['SUPPORT'] })).status).toBe(409);
    expect((await ctx.http.post('/api/v1/admin/admins').set(auth(root.token)).send({ email: 'weak@masterio.test', password: 'short', subRoles: ['SUPPORT'] })).status).toBe(400);

    const loginAs = (secret: string) =>
      ctx.http.post('/api/v1/auth/admin/login').send({ email: 'mod@masterio.test', password: 'Very-Strong-Pass-1', totp: authenticator.generate(secret) });
    const first = await loginAs(created.body.totpSecret).expect(200);
    const modToken = first.body.accessToken as string;
    expect((await ctx.http.get('/api/v1/admin/me').set(auth(modToken))).body.subRoles).toEqual(['MODERATOR']);

    // новые роли действуют сразу, без повторного входа
    await ctx.http.patch(`/api/v1/admin/admins/${created.body.id}`).set(auth(root.token)).send({ subRoles: ['MODERATOR', 'FINANCE'] }).expect(200);
    expect((await ctx.http.get('/api/v1/admin/me').set(auth(modToken))).body.subRoles).toEqual(['MODERATOR', 'FINANCE']);

    const reset = await ctx.http.post(`/api/v1/admin/admins/${created.body.id}/reset-totp`).set(auth(root.token)).expect(200);
    expect((await loginAs(created.body.totpSecret)).status).toBe(401);
    await loginAs(reset.body.totpSecret).expect(200);

    await ctx.http.patch(`/api/v1/admin/admins/${created.body.id}`).set(auth(root.token)).send({ active: false }).expect(200);
    expect((await ctx.http.get('/api/v1/admin/me').set(auth(modToken))).body.code).toBe('ACCOUNT_BLOCKED');
    expect((await loginAs(reset.body.totpSecret)).body.code).toBe('ACCOUNT_BLOCKED');
    expect(await ctx.prisma.adminAuditLog.count({ where: { entityId: created.body.id, action: { startsWith: 'admin.' } } })).toBe(4);
  });

  it('the last active superadmin cannot lose the role', async () => {
    // в тестовом состоянии два superadmin: root@ из resetState и boss@ — оставляем одного
    await ctx.prisma.user.update({ where: { email: 'root@masterio.test' }, data: { status: 'BLOCKED' } });
    const res = await ctx.http.patch(`/api/v1/admin/admins/${root.id}`).set(auth(root.token)).send({ subRoles: ['FINANCE'] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LAST_SUPERADMIN');
    expect((await ctx.http.patch(`/api/v1/admin/admins/${root.id}`).set(auth(root.token)).send({ active: false })).body.code).toBe('LAST_SUPERADMIN');
  });
});

describe('catalog', () => {
  it('superadmin adds a group, category and city in 5 languages; apps see them at once', async () => {
    const missingLang = await ctx.http.post('/api/v1/admin/catalog/groups').set(auth(root.token)).send({ code: 'security', names: { en: 'Security' } });
    expect(missingLang.status).toBe(400);
    const group = await ctx.http.post('/api/v1/admin/catalog/groups').set(auth(root.token)).send({ code: 'security', names: NAMES, sortOrder: 9 }).expect(201);
    const cat = await ctx.http
      .post('/api/v1/admin/catalog/categories')
      .set(auth(root.token))
      .send({ code: 'locksmith_pro', groupId: group.body.id, names: NAMES, isUrgent: true, requiresLicense: true })
      .expect(201);
    expect((await ctx.http.post('/api/v1/admin/catalog/categories').set(auth(root.token)).send({ code: 'locksmith_pro', groupId: group.body.id, names: NAMES })).status).toBe(409);

    const city = await ctx.http
      .post('/api/v1/admin/catalog/cities')
      .set(auth(root.token))
      .send({ countryCode: 'DE', names: { en: 'Berlin', ru: 'Берлин', de: 'Berlin', es: 'Berlín', hy: 'Բեռլին' }, timezone: 'Europe/Berlin', currency: 'EUR', center: { lat: 52.52, lng: 13.405 }, emergencyNumber: '112' })
      .expect(201);
    expect((await ctx.http.post('/api/v1/admin/catalog/cities').set(auth(root.token)).send({ countryCode: 'DE', names: NAMES, timezone: 'Nowhere/City', currency: 'EUR', center: { lat: 0, lng: 0 }, emergencyNumber: '112' })).status).toBe(400);

    await ctx.http.put(`/api/v1/admin/catalog/cities/${city.body.id}/categories`).set(auth(root.token)).send({ categoryIds: [cat.body.id] }).expect(200);
    const forClients = await ctx.http.get(`/api/v1/categories?cityId=${city.body.id}`).expect(200);
    expect(forClients.body).toEqual([expect.objectContaining({ code: 'security', categories: [expect.objectContaining({ code: 'locksmith_pro', isUrgent: true })] })]);
    const cities = await ctx.http.get('/api/v1/cities').expect(200);
    expect(cities.body.find((c: { id: string }) => c.id === city.body.id).center).toEqual({ lat: 52.52, lng: 13.405 });

    // выключенная услуга пропадает из приложений, но остаётся в справочнике CRM
    await ctx.http.put(`/api/v1/admin/catalog/categories/${cat.body.id}`).set(auth(root.token)).send({ code: 'locksmith_pro', groupId: group.body.id, names: NAMES, isActive: false }).expect(200);
    expect((await ctx.http.get(`/api/v1/categories?cityId=${city.body.id}`)).body).toEqual([]);
    const catalog = await ctx.http.get('/api/v1/admin/catalog').set(auth(root.token)).expect(200);
    expect(catalog.body.cities.find((c: { id: string }) => c.id === city.body.id).categoryIds).toEqual([cat.body.id]);

    // валюту города с заказами поменять нельзя
    const yerevan = catalog.body.cities.find((c: { id: string }) => c.id === ctx.cityId);
    const client = await login(ctx, '+37499200777', 'client');
    await createOrder(ctx, client.token);
    const changeCurrency = await ctx.http
      .put(`/api/v1/admin/catalog/cities/${ctx.cityId}`)
      .set(auth(root.token))
      .send({ countryCode: yerevan.countryCode, names: { ...NAMES, ...yerevan.names }, timezone: yerevan.timezone, currency: 'EUR', center: yerevan.center, emergencyNumber: yerevan.emergencyNumber });
    expect(changeCurrency.status).toBe(400);
  });
});

describe('finance', () => {
  it('summary splits commission by pocket, lists transactions and exports CSV with an audit record', async () => {
    const { worker } = await completedOrder('007');
    const from = new Date(Date.now() - 3_600_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

    const summary = await ctx.http.get(`/api/v1/admin/finance/summary?${q}`).set(auth(root.token)).expect(200);
    const amd = summary.body.currencies.find((c: { currency: string }) => c.currency === 'AMD');
    expect(amd).toMatchObject({
      ordersCompleted: 1,
      turnoverCents: 5_000,
      commissionCents: 1_000,
      commissionFromPromoCents: 1_000,
      commissionFromTopupCents: 0,
      commissionToDebtCents: 0,
      promoGrantedCents: 10_000,
      liabilities: { promoCents: 9_000, topupCents: 0, debtCents: 0, bonusCents: 0, earningsCents: 0 },
    });

    const txs = await ctx.http.get(`/api/v1/admin/finance/transactions?${q}&kind=COMMISSION&ownerId=${worker.userId}`).set(auth(root.token)).expect(200);
    expect(txs.body.items).toHaveLength(1);

    const csv = await ctx.http.get(`/api/v1/admin/finance/export.csv?${q}`).set(auth(root.token)).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    const lines = (csv.text as string).trim().split('\n');
    expect(lines[0]).toBe('transaction_id,created_at,kind,order_number,account,owner_id,currency,amount_cents,amount,memo');
    expect(lines.some((l) => l.includes(',COMMISSION,') && l.includes(',PLATFORM_REVENUE,') && l.includes(',1000,10.00,'))).toBe(true);
    expect(await ctx.prisma.adminAuditLog.count({ where: { action: 'finance.export' } })).toBe(1);

    const tooLong = await ctx.http.get(`/api/v1/admin/finance/summary?from=2020-01-01T00:00:00Z&to=${encodeURIComponent(to)}`).set(auth(root.token));
    expect(tooLong.status).toBe(400);
  });
});

describe('settings by scope', () => {
  it('a city override applies at once and can be reset back to the global value with history', async () => {
    await ctx.http.put('/api/v1/admin/settings/FREE_CANCEL_MINUTES').set(auth(root.token)).send({ value: 10, scope: 'CITY', scopeRef: ctx.cityId, comment: 'pilot' }).expect(200);
    const client = await login(ctx, '+37499200888', 'client');
    expect((await ctx.http.get(`/api/v1/app-config?cityId=${ctx.cityId}`).set(auth(client.token))).body.freeCancelMinutes).toBe(10);
    const overrides = await ctx.http.get('/api/v1/admin/settings').set(auth(root.token)).expect(200);
    expect(overrides.body.overrides).toContainEqual({ key: 'FREE_CANCEL_MINUTES', scope: 'CITY', scopeRef: ctx.cityId, value: 10 });

    await ctx.http.post('/api/v1/admin/settings/FREE_CANCEL_MINUTES/reset').set(auth(root.token)).send({ scope: 'CITY', scopeRef: ctx.cityId, comment: 'pilot ended' }).expect(200);
    expect((await ctx.http.get(`/api/v1/app-config?cityId=${ctx.cityId}`).set(auth(client.token))).body.freeCancelMinutes).toBe(3);
    const after = await ctx.http.get('/api/v1/admin/settings').set(auth(root.token)).expect(200);
    expect(after.body.overrides.find((o: { key: string }) => o.key === 'FREE_CANCEL_MINUTES')).toBeUndefined();
    const history = await ctx.http.get('/api/v1/admin/settings/FREE_CANCEL_MINUTES/history').set(auth(root.token)).expect(200);
    expect(history.body).toHaveLength(2);
    expect((await ctx.http.post('/api/v1/admin/settings/FREE_CANCEL_MINUTES/reset').set(auth(root.token)).send({ scope: 'CITY', scopeRef: ctx.cityId })).status).toBe(404);

    // нефинансовый ключ finance менять не может
    const finance = await createAdmin(ctx, 'finance@masterio.test', ['FINANCE']);
    expect((await ctx.http.post('/api/v1/admin/settings/FREE_CANCEL_MINUTES/reset').set(auth(finance.token)).send({ scope: 'CITY', scopeRef: ctx.cityId })).status).toBe(403);
  });
});

describe('suspicious activity', () => {
  it('moderator resolves a flag with a note', async () => {
    const flag = await ctx.prisma.fraudFlag.create({ data: { type: 'HIGH_CANCEL_RATE', details: { source: 'test' } } });
    const open = await ctx.http.get('/api/v1/admin/fraud-flags').set(auth(root.token)).expect(200);
    expect(open.body.map((f: { id: string }) => f.id)).toContain(flag.id);
    await ctx.http.post(`/api/v1/admin/fraud-flags/${flag.id}/resolve`).set(auth(root.token)).send({ note: 'Checked: client cancelled' }).expect(200);
    expect((await ctx.http.get('/api/v1/admin/fraud-flags').set(auth(root.token))).body).toEqual([]);
    expect((await ctx.http.get('/api/v1/admin/fraud-flags?resolved=true').set(auth(root.token))).body).toHaveLength(1);
    expect((await ctx.http.post(`/api/v1/admin/fraud-flags/${flag.id}/resolve`).set(auth(root.token)).send({ note: 'again' })).status).toBe(404);
  });
});
