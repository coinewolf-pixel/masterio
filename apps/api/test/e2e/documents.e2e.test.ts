/** Документы и файлы (разделы 6, 15, 19.3) + история и сводка мастера за месяц (раздел 21.5). */
import {
  auth,
  createAdmin,
  createOrder,
  login,
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

/** Загрузка файла по подписанной форме прямо в хранилище — так же делает приложение. */
async function upload(token: string, purpose: 'document' | 'order_photo', contentType = 'image/jpeg', body = Buffer.from('fake-image-bytes')) {
  const presign = await ctx.http.post('/api/v1/uploads').set(auth(token)).send({ purpose, contentType, sizeBytes: body.length });
  expect(presign.status).toBe(201);
  const form = new FormData();
  for (const [k, v] of Object.entries(presign.body.fields as Record<string, string>)) form.append(k, v);
  form.append('file', new Blob([body], { type: contentType }), 'file');
  const res = await fetch(presign.body.url as string, { method: 'POST', body: form });
  expect(res.status).toBeLessThan(300);
  return presign.body.key as string;
}

describe('documents', () => {
  it('KYC: upload ID and selfie, moderator approves both → pro is verified; every view is logged', async () => {
    const w = await login(ctx, '+37494000001', 'worker');
    const idKey = await upload(w.token, 'document');
    const selfieKey = await upload(w.token, 'document');
    const id = await ctx.http.post('/api/v1/documents').set(auth(w.token)).send({ kind: 'ID_DOCUMENT', fileKey: idKey }).expect(201);
    const selfie = await ctx.http.post('/api/v1/documents').set(auth(w.token)).send({ kind: 'SELFIE', fileKey: selfieKey }).expect(201);

    const mod = await createAdmin(ctx, 'mod@masterio.test', ['MODERATOR']);
    const queue = await ctx.http.get('/api/v1/admin/documents').set(auth(mod.token)).expect(200);
    expect(queue.body).toHaveLength(2);

    const view = await ctx.http.get(`/api/v1/documents/${id.body.id}/view-url`).set(auth(mod.token)).expect(200);
    expect(view.body.url).toContain('X-Amz-Signature');
    expect(view.body.expiresIn).toBe(300);
    const file = await fetch(view.body.url as string);
    expect(await file.text()).toBe('fake-image-bytes');

    await ctx.http.post(`/api/v1/admin/documents/${id.body.id}/review`).set(auth(mod.token)).send({ decision: 'approve' }).expect(200);
    let profile = await ctx.prisma.workerProfile.findUniqueOrThrow({ where: { userId: w.userId } });
    expect(profile.kycStatus).toBe('NOT_VERIFIED');
    await ctx.http.post(`/api/v1/admin/documents/${selfie.body.id}/review`).set(auth(mod.token)).send({ decision: 'approve' }).expect(200);
    profile = await ctx.prisma.workerProfile.findUniqueOrThrow({ where: { userId: w.userId } });
    expect(profile.kycStatus).toBe('VERIFIED');

    expect(await ctx.prisma.documentAccessLog.count({ where: { documentId: id.body.id } })).toBe(2); // просмотр + решение
    expect(await ctx.prisma.adminAuditLog.count({ where: { action: 'document.approve' } })).toBe(2);
  });

  it('rejection needs a reason and sets KYC to rejected; only the owner and staff can view', async () => {
    const w = await login(ctx, '+37494000002', 'worker');
    const key = await upload(w.token, 'document');
    const doc = await ctx.http.post('/api/v1/documents').set(auth(w.token)).send({ kind: 'ID_DOCUMENT', fileKey: key }).expect(201);
    const mod = await createAdmin(ctx, 'mod2@masterio.test', ['MODERATOR']);
    const noReason = await ctx.http.post(`/api/v1/admin/documents/${doc.body.id}/review`).set(auth(mod.token)).send({ decision: 'reject' });
    expect(noReason.body.code).toBe('VALIDATION_FAILED');
    await ctx.http.post(`/api/v1/admin/documents/${doc.body.id}/review`).set(auth(mod.token)).send({ decision: 'reject', reason: 'Photo is blurry' }).expect(200);
    const list = await ctx.http.get('/api/v1/documents').set(auth(w.token)).expect(200);
    expect(list.body[0]).toMatchObject({ status: 'REJECTED', rejectReason: 'Photo is blurry' });
    expect((await ctx.prisma.workerProfile.findUniqueOrThrow({ where: { userId: w.userId } })).kycStatus).toBe('REJECTED');

    await ctx.http.get(`/api/v1/documents/${doc.body.id}/view-url`).set(auth(w.token)).expect(200);
    const stranger = await login(ctx, '+37494000003', 'worker');
    await ctx.http.get(`/api/v1/documents/${doc.body.id}/view-url`).set(auth(stranger.token)).expect(404);
    const support = await createAdmin(ctx, 'fin@masterio.test', ['FINANCE']);
    await ctx.http.get(`/api/v1/documents/${doc.body.id}/view-url`).set(auth(support.token)).expect(404);
  });

  it("cannot register someone else's file or a file that was never uploaded; license needs a category", async () => {
    const a = await login(ctx, '+37494000004', 'worker');
    const b = await login(ctx, '+37494000005', 'worker');
    const aKey = await upload(a.token, 'document');
    const foreign = await ctx.http.post('/api/v1/documents').set(auth(b.token)).send({ kind: 'ID_DOCUMENT', fileKey: aKey });
    expect(foreign.status).toBe(403);
    const ghost = await ctx.http.post('/api/v1/documents').set(auth(a.token)).send({ kind: 'SELFIE', fileKey: `private/doc/${a.userId}/missing.jpg` });
    expect(ghost.body.code).toBe('VALIDATION_FAILED');
    const license = await ctx.http.post('/api/v1/documents').set(auth(a.token)).send({ kind: 'LICENSE', fileKey: aKey });
    expect(license.body.code).toBe('VALIDATION_FAILED');
    const ok = await ctx.http.post('/api/v1/documents').set(auth(a.token)).send({ kind: 'LICENSE', fileKey: aKey, categoryId: ctx.categoryId, number: 'EL-123' });
    expect(ok.status).toBe(201);
    // клиент не может загружать документы, а файл больше 10 МБ не принимается
    const client = await login(ctx, '+37499400001', 'client');
    await ctx.http.post('/api/v1/uploads').set(auth(client.token)).send({ purpose: 'document', contentType: 'image/jpeg', sizeBytes: 100 }).expect(403);
    const big = await ctx.http.post('/api/v1/uploads').set(auth(a.token)).send({ purpose: 'document', contentType: 'image/jpeg', sizeBytes: 11 * 1024 * 1024 });
    expect(big.body.code).toBe('VALIDATION_FAILED');
  });

  it('a license unlocks orders in a category that requires it', async () => {
    const electrician = await ctx.prisma.category.findUniqueOrThrow({ where: { code: 'electrician' } });
    expect(electrician.requiresLicense).toBe(true);
    const w = await readyWorker(ctx, '+37494000006', north(YEREVAN_CENTER, 300), { categoryId: electrician.id });
    const client = await login(ctx, '+37499400006', 'client');
    const first = await createOrder(ctx, client.token, YEREVAN_CENTER, { categoryId: electrician.id });
    expect(await offersOf(ctx, first.body.id)).toHaveLength(0);

    const key = await upload(w.token, 'document', 'application/pdf');
    const lic = await ctx.http.post('/api/v1/documents').set(auth(w.token)).send({ kind: 'LICENSE', fileKey: key, categoryId: electrician.id }).expect(201);
    const mod = await createAdmin(ctx, 'mod3@masterio.test', ['MODERATOR']);
    await ctx.http.post(`/api/v1/admin/documents/${lic.body.id}/review`).set(auth(mod.token)).send({ decision: 'approve' }).expect(200);
    const second = await createOrder(ctx, client.token, YEREVAN_CENTER, { categoryId: electrician.id });
    const offers = await offersOf(ctx, second.body.id);
    expect(offers.map((o) => o.workerId)).toEqual([w.userId]);

    const card = await ctx.http.post(`/api/v1/offers/${offers[0]!.id}/accept`).set(auth(w.token)).expect(200);
    const order = await ctx.http.get(`/api/v1/orders/${card.body.orderId}`).set(auth(client.token)).expect(200);
    expect(order.body.performer.badges).toEqual({ licenseVerified: true, insured: false });
  });

  it('order photos: only own uploaded photos can be attached', async () => {
    const client = await login(ctx, '+37499400007', 'client');
    const other = await login(ctx, '+37499400008', 'client');
    const own = await upload(client.token, 'order_photo', 'image/png');
    const theirs = await upload(other.token, 'order_photo', 'image/png');
    const bad = await createOrder(ctx, client.token, YEREVAN_CENTER, { photoKeys: [theirs] });
    expect(bad.status).toBe(403);
    const good = await createOrder(ctx, client.token, YEREVAN_CENTER, { photoKeys: [own] });
    expect(good.status).toBe(201);
    expect(await ctx.prisma.orderPhoto.count({ where: { orderId: good.body.id } })).toBe(1);
  });
});

describe('worker history and monthly summary', () => {
  it('lists completed orders with commission breakdown, summary, bonus progress and CSV export', async () => {
    const worker = await readyWorker(ctx, '+37494000010', north(YEREVAN_CENTER, 200));
    const client = await login(ctx, '+37499400010', 'client');
    for (const amount of [10_000, 5_000]) {
      const order = await createOrder(ctx, client.token);
      const [offer] = await offersOf(ctx, order.body.id);
      await ctx.http.post(`/api/v1/offers/${offer!.id}/accept`).set(auth(worker.token)).expect(200);
      for (const status of ['EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] as const) {
        await ctx.http.post(`/api/v1/orders/${order.body.id}/status`).set(auth(worker.token)).send({ status, location: YEREVAN_CENTER }).expect(200);
      }
      await ctx.http.post(`/api/v1/orders/${order.body.id}/estimates`).set(auth(worker.token)).send({ items: [{ type: 'LABOR', title: 'w', quantity: 1, unitCents: amount }] }).expect(201);
      await ctx.http.post(`/api/v1/orders/${order.body.id}/estimates/1/approve`).set(auth(client.token)).expect(200);
      await ctx.http.post(`/api/v1/orders/${order.body.id}/complete`).set(auth(worker.token)).send({ cashReceivedCents: amount, location: YEREVAN_CENTER }).expect(200);
      await ctx.http.post(`/api/v1/orders/${order.body.id}/confirm-payment`).set(auth(client.token)).send({ cashPaidCents: amount }).expect(200);
      await ctx.http.post(`/api/v1/orders/${order.body.id}/review`).set(auth(client.token)).send({ rating: amount === 10_000 ? 5 : 4 }).expect(200);
    }

    const history = await ctx.http.get('/api/v1/worker/history').set(auth(worker.token)).expect(200);
    expect(history.body).toHaveLength(2);
    expect(history.body.map((o: { amountCents: number; commissionCents: number; netCents: number }) => [o.amountCents, o.commissionCents, o.netCents])).toEqual([
      [5_000, 1_000, 4_000],
      [10_000, 2_000, 8_000],
    ]);

    const stats = await ctx.http.get('/api/v1/worker/stats').set(auth(worker.token)).expect(200);
    expect(stats.body.current).toMatchObject({ ordersCount: 2, grossCents: 15_000, commissionCents: 3_000, netCents: 12_000, avgRating: 4.5, cashCount: 2 });
    expect(stats.body.previous.ordersCount).toBe(0);
    expect(stats.body.bonus.nextTier.minOrders).toBe(10);
    expect(stats.body.bonus.ordersToNext).toBe(8);

    // сводка сходится с журналом операций: комиссия в истории = записи COMMISSION
    const commissionTx = await ctx.prisma.ledgerEntry.aggregate({
      where: { account: { type: 'PLATFORM_REVENUE' }, transaction: { kind: 'COMMISSION' } },
      _sum: { amountCents: true },
    });
    expect(Number(commissionTx._sum.amountCents)).toBe(stats.body.current.commissionCents);

    const csv = await ctx.http.get('/api/v1/worker/history/export').set(auth(worker.token)).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    const lines = (csv.text as string).trim().split('\n');
    expect(lines[0]).toBe('number;completed_at;category;payment_method;currency;amount;commission;bonus_discount;net');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(';50.00;10.00;0.00;40.00');

    const bad = await ctx.http.get('/api/v1/worker/history').query({ month: '2026-13' }).set(auth(worker.token));
    expect(bad.body.code).toBe('VALIDATION_FAILED');

    const notes = await ctx.http.get('/api/v1/notifications').set(auth(worker.token)).expect(200);
    expect(notes.body.length).toBeGreaterThan(0);
    await ctx.http.post('/api/v1/notifications/read').set(auth(worker.token)).send({}).expect(204);
    expect(await ctx.prisma.notification.count({ where: { userId: worker.userId, readAt: null } })).toBe(0);
  });
});
