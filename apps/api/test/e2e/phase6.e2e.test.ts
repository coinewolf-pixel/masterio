/**
 * Фаза 6: единый процесс споров (18.5), «клиент не вышел» (12), инциденты и поддержка (19.4), юридические документы
 * и согласия (18.6), правила страхования и сроки документов (18.3, 19.4), месячные бонусы (20.4), GDPR (19.6).
 */
import { previousMonth } from '../../src/bonuses/bonuses.service';
import { BonusesService } from '../../src/bonuses/bonuses.service';
import { InsuranceService } from '../../src/compliance/insurance.service';
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
let root: { id: string; token: string };

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

async function upload(token: string, purpose: 'dispute_evidence' | 'incident' | 'document') {
  const body = Buffer.from('fake-image-bytes');
  const presign = await ctx.http.post('/api/v1/uploads').set(auth(token)).send({ purpose, contentType: 'image/jpeg', sizeBytes: body.length });
  expect(presign.status).toBe(201);
  const form = new FormData();
  for (const [k, v] of Object.entries(presign.body.fields as Record<string, string>)) form.append(k, v);
  form.append('file', new Blob([body], { type: 'image/jpeg' }), 'file');
  const res = await fetch(presign.body.url as string, { method: 'POST', body: form });
  expect(res.status).toBeLessThan(300);
  return presign.body.key as string;
}

async function acceptedOrder(suffix: string) {
  const worker = await readyWorker(ctx, `+3749130${suffix}`, north(YEREVAN_CENTER, 1_500), { name: 'Aram' });
  const client = await login(ctx, `+3749930${suffix}`, 'client');
  const order = await createOrder(ctx, client.token);
  const [offer] = await offersOf(ctx, order.body.id);
  await ctx.http.post(`/api/v1/offers/${offer!.id}/accept`).set(auth(worker.token)).expect(200);
  return { worker, client, orderId: order.body.id as string };
}

async function arrived(suffix: string) {
  const o = await acceptedOrder(suffix);
  const w = auth(o.worker.token);
  await ctx.http.post(`/api/v1/orders/${o.orderId}/status`).set(w).send({ status: 'EN_ROUTE', location: north(YEREVAN_CENTER, 1_500) }).expect(200);
  await ctx.http.post('/api/v1/tracking/batch').set(w).send({ points: [{ ...north(YEREVAN_CENTER, 20), recordedAt: new Date().toISOString() }] }).expect(200);
  await ctx.http.post(`/api/v1/orders/${o.orderId}/status`).set(w).send({ status: 'ARRIVED', location: north(YEREVAN_CENTER, 20) }).expect(200);
  return o;
}

/** Заказ 50,00 наличными, комиссия 10,00; клиент подтверждает cashPaid. */
async function completed(suffix: string, cashPaid = 5_000) {
  const o = await arrived(suffix);
  const w = auth(o.worker.token);
  await ctx.http.post(`/api/v1/orders/${o.orderId}/messages`).set(auth(o.client.token)).send({ body: 'Please fix the tap' }).expect(201);
  await ctx.http.post(`/api/v1/orders/${o.orderId}/status`).set(w).send({ status: 'IN_PROGRESS', location: north(YEREVAN_CENTER, 10) }).expect(200);
  await ctx.http.post(`/api/v1/orders/${o.orderId}/estimates`).set(w).send({ items: [{ type: 'LABOR', title: 'Repair', quantity: 1, unitCents: 5_000 }] }).expect(201);
  await ctx.http.post(`/api/v1/orders/${o.orderId}/estimates/1/approve`).set(auth(o.client.token)).expect(200);
  await ctx.http.post(`/api/v1/orders/${o.orderId}/complete`).set(w).send({ cashReceivedCents: 5_000, location: YEREVAN_CENTER }).expect(200);
  await ctx.http.post(`/api/v1/orders/${o.orderId}/confirm-payment`).set(auth(o.client.token)).send({ cashPaidCents: cashPaid }).expect(200);
  return o;
}

const LONG = 'This is a reviewed legal text for testing purposes. '.repeat(3);
const bodies = { en: LONG, ru: LONG, de: LONG, es: LONG, hy: LONG };

describe('disputes (18.5)', () => {
  it('client opens, worker explains, support proposes and settles with a commission refund by finance', async () => {
    const o = await completed('001');
    const photo = await upload(o.client.token, 'dispute_evidence');

    // мастер не может выбрать «причину клиента», чужой — не видит заказ
    const wrongSide = await ctx.http.post(`/api/v1/orders/${o.orderId}/disputes`).set(auth(o.worker.token)).send({ reason: 'POOR_QUALITY', description: 'not allowed' });
    expect(wrongSide.status).toBe(400);
    const stranger = await login(ctx, '+37499309999', 'client');
    expect((await ctx.http.post(`/api/v1/orders/${o.orderId}/disputes`).set(auth(stranger.token)).send({ reason: 'POOR_QUALITY', description: 'nope' })).status).toBe(404);
    // чужой файл подставить нельзя
    const foreign = await ctx.http.post(`/api/v1/orders/${o.orderId}/disputes`).set(auth(o.client.token)).send({ reason: 'POOR_QUALITY', description: 'Leak again', photoKeys: [`private/dispute/${o.worker.userId}/x.jpg`] });
    expect(foreign.body.code).toBe('VALIDATION_FAILED');

    const opened = await ctx.http
      .post(`/api/v1/orders/${o.orderId}/disputes`)
      .set(auth(o.client.token))
      .send({ reason: 'POOR_QUALITY', description: 'The tap leaks again the next day', photoKeys: [photo] })
      .expect(201);
    expect(opened.body.status).toBe('AWAITING_RESPONSE');
    const disputeId = opened.body.id as string;

    const order = await ctx.prisma.order.findUniqueOrThrow({ where: { id: o.orderId } });
    expect(order.status).toBe('DISPUTED');
    const kinds = (await ctx.prisma.disputeEvidence.findMany({ where: { disputeId } })).map((e) => e.kind).sort();
    expect(kinds).toEqual(['chat_export', 'estimate_snapshot', 'gps_snapshot', 'order_snapshot', 'photo', 'text', 'timeline_snapshot']);
    const chat = await ctx.prisma.disputeEvidence.findFirstOrThrow({ where: { disputeId, kind: 'chat_export' } });
    expect(JSON.stringify(chat.content)).toContain('Please fix the tap');
    expect(await ctx.prisma.supportTicket.count({ where: { disputeId } })).toBe(1);
    expect(ctx.push.sent.some((p) => p.message.data.type === 'push.dispute_opened')).toBe(true);

    // второй спор по тому же заказу не открыть
    const again = await ctx.http.post(`/api/v1/orders/${o.orderId}/disputes`).set(auth(o.client.token)).send({ reason: 'OTHER', description: 'second one' });
    expect(again.body.code).toBe('DISPUTE_ALREADY_OPEN');

    // объяснение второй стороны → «на рассмотрении»
    await ctx.http.post(`/api/v1/disputes/${disputeId}/responses`).set(auth(o.worker.token)).send({ text: 'The gasket was old, I warned the client' }).expect(201);
    const support = await createAdmin(ctx, 'support@masterio.test', ['SUPPORT']);
    await ctx.http.post(`/api/v1/admin/disputes/${disputeId}/actions`).set(auth(support.token)).send({ action: 'note', text: 'Internal: check photos' }).expect(200);
    await ctx.http.post(`/api/v1/admin/disputes/${disputeId}/actions`).set(auth(support.token)).send({ action: 'proposal', text: 'Free repeat visit within a week' }).expect(200);

    const partyView = await ctx.http.get(`/api/v1/disputes/${disputeId}`).set(auth(o.client.token)).expect(200);
    expect(partyView.body.status).toBe('UNDER_REVIEW');
    expect(partyView.body.timeline.map((e: { type: string }) => e.type)).toEqual(['opened', 'response', 'proposal']);
    expect(JSON.stringify(partyView.body)).not.toContain('Internal: check photos');
    expect(partyView.body.photos).toHaveLength(1);

    // карточка поддержки: все материалы, просмотр записан в журнал
    const card = await ctx.http.get(`/api/v1/admin/disputes/${disputeId}`).set(auth(support.token)).expect(200);
    expect(card.body.order.commissionChargedCents).toBe(1_000);
    expect(await ctx.prisma.adminAuditLog.count({ where: { action: 'dispute.view', entityId: disputeId } })).toBeGreaterThan(0);

    // возврат комиссии — только finance; больше удержанного — нельзя
    const bySupport = await ctx.http.post(`/api/v1/admin/disputes/${disputeId}/actions`).set(auth(support.token)).send({ action: 'settle', resolution: 'partial', summary: 'Repeat visit agreed', commissionRefundCents: 500 });
    expect(bySupport.status).toBe(403);
    const finance = await createAdmin(ctx, 'finance@masterio.test', ['FINANCE']);
    const tooMuch = await ctx.http.post(`/api/v1/admin/disputes/${disputeId}/actions`).set(auth(finance.token)).send({ action: 'settle', resolution: 'partial', summary: 'x'.repeat(5), commissionRefundCents: 1_001 });
    expect(tooMuch.body.code).toBe('VALIDATION_FAILED');
    expect((await ctx.prisma.dispute.findUniqueOrThrow({ where: { id: disputeId } })).status).toBe('UNDER_REVIEW');

    const before = await ctx.http.get('/api/v1/wallet').set(auth(o.worker.token)).expect(200);
    await ctx.http.post(`/api/v1/admin/disputes/${disputeId}/actions`).set(auth(finance.token)).send({ action: 'settle', resolution: 'partial', summary: 'Repeat visit agreed', commissionRefundCents: 500 }).expect(200);
    const after = await ctx.http.get('/api/v1/wallet').set(auth(o.worker.token)).expect(200);
    expect(after.body.topupCents - before.body.topupCents).toBe(500);
    expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id: o.orderId } })).status).toBe('CLOSED');
    const integrity = await ctx.http.get('/api/v1/admin/finance/ledger-integrity').set(auth(finance.token)).expect(200);
    expect(integrity.body).toEqual({ totalCents: 0, mismatchedAccounts: 0 });

    const late = await ctx.http.post(`/api/v1/disputes/${disputeId}/responses`).set(auth(o.client.token)).send({ text: 'one more thing' });
    expect(late.body.code).toBe('DISPUTE_CLOSED');
    expect((await ctx.http.get(`/api/v1/disputes/${disputeId}`).set(auth(o.client.token))).body.outcome.resolution).toBe('partial');
  });

  it('cash mismatch opens an automatic dispute with the same evidence and ticket', async () => {
    const o = await completed('002', 4_000);
    const d = await ctx.prisma.dispute.findFirstOrThrow({ where: { orderId: o.orderId } });
    expect(d).toMatchObject({ reason: 'CASH_AMOUNT_MISMATCH', isAutomatic: true, status: 'AWAITING_RESPONSE' });
    expect(await ctx.prisma.disputeEvidence.count({ where: { disputeId: d.id, kind: 'gps_snapshot' } })).toBe(1);
    expect(await ctx.prisma.supportTicket.count({ where: { disputeId: d.id } })).toBe(1);
    // спор можно передать вовне — стороны увидят, куда обращаться
    await ctx.http.post(`/api/v1/admin/disputes/${d.id}/actions`).set(auth(root.token)).send({ action: 'refer', summary: 'No agreement on the amount' }).expect(200);
    expect((await ctx.http.get(`/api/v1/disputes/${d.id}`).set(auth(o.worker.token))).body.status).toBe('UNRESOLVED_REFERRED');
  });

  it('client no-show: only after waiting, in the geofence, with a photo', async () => {
    const o = await arrived('003');
    const photo = await upload(o.worker.token, 'dispute_evidence');
    const early = await ctx.http.post(`/api/v1/orders/${o.orderId}/no-show`).set(auth(o.worker.token)).send({ location: north(YEREVAN_CENTER, 10), photoKey: photo });
    expect(early.body.code).toBe('NO_SHOW_TOO_EARLY');
    await ctx.prisma.order.update({ where: { id: o.orderId }, data: { arrivedAt: new Date(Date.now() - 20 * 60_000) } });
    const far = await ctx.http.post(`/api/v1/orders/${o.orderId}/no-show`).set(auth(o.worker.token)).send({ location: north(YEREVAN_CENTER, 900), photoKey: photo });
    expect(far.body.code).toBe('OUTSIDE_GEOFENCE');
    expect((await ctx.http.post(`/api/v1/orders/${o.orderId}/no-show`).set(auth(o.client.token)).send({ location: YEREVAN_CENTER, photoKey: photo })).status).toBe(403);
    await ctx.http.post(`/api/v1/orders/${o.orderId}/no-show`).set(auth(o.worker.token)).send({ location: north(YEREVAN_CENTER, 15), photoKey: photo, comment: 'Rang 5 times' }).expect(201);
    const d = await ctx.prisma.dispute.findFirstOrThrow({ where: { orderId: o.orderId } });
    expect(d.reason).toBe('CLIENT_NO_SHOW');
    expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id: o.orderId } })).status).toBe('DISPUTED');
    const card = await ctx.http.get(`/api/v1/orders/${o.orderId}`).set(auth(o.client.token)).expect(200);
    expect(card.body.dispute).toMatchObject({ id: d.id, reason: 'CLIENT_NO_SHOW' });
  });
});

describe('incidents and support (19.4)', () => {
  it('incident creates a ticket and returns the emergency number; support replies; internal notes stay internal', async () => {
    const o = await arrived('004');
    const photo = await upload(o.worker.token, 'incident');
    const inc = await ctx.http
      .post(`/api/v1/orders/${o.orderId}/incidents`)
      .set(auth(o.worker.token))
      .send({ type: 'INJURY', description: 'Cut my hand on broken glass', emergencyCalled: true, location: north(YEREVAN_CENTER, 10), photoKeys: [photo] })
      .expect(201);
    expect(inc.body.emergencyNumber).toBe('112');
    const support = await createAdmin(ctx, 'support@masterio.test', ['SUPPORT']);
    const list = await ctx.http.get('/api/v1/admin/incidents').set(auth(support.token)).expect(200);
    expect(list.body.items[0]).toMatchObject({ type: 'INJURY', reporterRole: 'worker', emergencyCalled: true, photos: 1 });
    const card = await ctx.http.get(`/api/v1/admin/incidents/${inc.body.id}`).set(auth(support.token)).expect(200);
    expect(card.body.location.lat).toBeCloseTo(north(YEREVAN_CENTER, 10).lat, 4);
    expect(card.body.photos).toHaveLength(1);
    // финансисту инциденты не видны
    const finance = await createAdmin(ctx, 'finance@masterio.test', ['FINANCE']);
    expect((await ctx.http.get('/api/v1/admin/incidents').set(auth(finance.token))).status).toBe(403);

    const ticketId = inc.body.ticketId as string;
    await ctx.http.post(`/api/v1/admin/tickets/${ticketId}/messages`).set(auth(support.token)).send({ body: 'Internal: called the worker', internal: true }).expect(200);
    await ctx.http.post(`/api/v1/admin/tickets/${ticketId}/messages`).set(auth(support.token)).send({ body: 'We saved the materials. Please see a doctor.' }).expect(200);
    const mine = await ctx.http.get(`/api/v1/support/tickets/${ticketId}`).set(auth(o.worker.token)).expect(200);
    expect(mine.body.status).toBe('PENDING_USER');
    expect(mine.body.messages.map((m: { body: string }) => m.body)).toEqual(['Cut my hand on broken glass', 'We saved the materials. Please see a doctor.']);
    await ctx.http.post(`/api/v1/support/tickets/${ticketId}/messages`).set(auth(o.worker.token)).send({ body: 'Thanks' }).expect(201);
    expect((await ctx.http.get(`/api/v1/admin/tickets/${ticketId}`).set(auth(support.token))).body.status).toBe('OPEN');
    // чужой тикет не открыть
    expect((await ctx.http.get(`/api/v1/support/tickets/${ticketId}`).set(auth(o.client.token))).status).toBe(404);
  });

  it('general ticket from the app', async () => {
    const c = await login(ctx, '+37499300050', 'client');
    const t = await ctx.http.post('/api/v1/support/tickets').set(auth(c.token)).send({ subject: 'How do I pay by card?', body: 'Is card payment available?' }).expect(201);
    expect(t.body.messages).toHaveLength(1);
    const support = await createAdmin(ctx, 'support@masterio.test', ['SUPPORT']);
    const list = await ctx.http.get('/api/v1/admin/tickets?kind=general').set(auth(support.token)).expect(200);
    expect(list.body.items[0]).toMatchObject({ id: t.body.id, waitingSupport: true });
  });
});

describe('legal documents and consents (18.6)', () => {
  it('versions are reviewed, published in 5 languages; orders need the current consent; consents record version and time', async () => {
    const mod = await createAdmin(ctx, 'mod@masterio.test', ['MODERATOR']);
    const create = { audience: 'CLIENT', countryCode: 'AM', version: '2026-11-01', bodies, legalReviewedBy: 'Law firm X' };
    expect((await ctx.http.post('/api/v1/admin/legal/versions').set(auth(mod.token)).send(create)).status).toBe(403);
    const v1 = await ctx.http.post('/api/v1/admin/legal/versions').set(auth(root.token)).send(create).expect(201);
    await ctx.http.post('/api/v1/admin/legal/versions').set(auth(root.token)).send({ ...create, audience: 'PRIVACY_POLICY' }).expect(201);

    const c = await login(ctx, '+37499300060', 'client');
    // мастер рядом вышел на линию до публикации условий для мастеров
    await readyWorker(ctx, '+37491300060', north(YEREVAN_CENTER, 500));
    // черновики не требуют согласия
    expect((await ctx.http.get('/api/v1/legal/required?context=registration').set(auth(c.token))).body.required).toEqual([]);
    for (const d of (await ctx.http.get('/api/v1/admin/legal').set(auth(root.token))).body as Array<{ id: string }>) {
      await ctx.http.post(`/api/v1/admin/legal/${d.id}/versions/2026-11-01/publish`).set(auth(root.token)).expect(200);
    }
    const twice = await ctx.http.post(`/api/v1/admin/legal/${v1.body.documentId}/versions/2026-11-01/publish`).set(auth(root.token));
    expect(twice.body.code).toBe('ALREADY_EXISTS');
    expect((await ctx.http.delete(`/api/v1/admin/legal/${v1.body.documentId}/versions/2026-11-01`).set(auth(root.token))).status).toBe(403);

    const blocked = await createOrder(ctx, c.token);
    expect(blocked.body.code).toBe('CONSENT_REQUIRED');
    const req = await ctx.http.get('/api/v1/legal/required?context=registration').set(auth(c.token)).expect(200);
    expect(req.body.required.map((r: { audience: string }) => r.audience).sort()).toEqual(['CLIENT', 'PRIVACY_POLICY']);
    const text = await ctx.http.get(`/api/v1/legal/versions/${req.body.required[0].versionId}`).set(auth(c.token)).expect(200);
    expect(text.body.body).toContain('reviewed legal text');
    await ctx.http.post('/api/v1/legal/consents').set(auth(c.token)).send({ context: 'registration', versionIds: req.body.required.map((r: { versionId: string }) => r.versionId) }).expect(200);
    const consent = await ctx.prisma.userConsent.findFirstOrThrow({ where: { userId: c.userId } });
    expect(consent).toMatchObject({ countryCode: 'AM', context: 'registration' });
    expect(consent.acceptedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect((await createOrder(ctx, c.token)).status).toBe(201);

    // новая редакция — снова нужно согласие
    await ctx.http.post('/api/v1/admin/legal/versions').set(auth(root.token)).send({ ...create, version: '2026-12-01' }).expect(201);
    await ctx.http.post(`/api/v1/admin/legal/${v1.body.documentId}/versions/2026-12-01/publish`).set(auth(root.token)).expect(200);
    const again = await ctx.http.get('/api/v1/legal/required?context=registration').set(auth(c.token)).expect(200);
    expect(again.body.required.map((r: { version: string }) => r.version)).toEqual(['2026-12-01']);
  });
});

describe('insurance rules and document expiry (18.3, 19.4)', () => {
  it('a required policy with the right risks is needed to get orders; reminders and expiry', async () => {
    const plumber = ctx.categoryId;
    await ctx.http
      .post('/api/v1/admin/insurance-rules')
      .set(auth(root.token))
      .send({ countryCode: 'AM', categoryId: plumber, workerType: 'INDEPENDENT', required: true, requiredRisks: ['liability'] })
      .expect(201);
    const dup = await ctx.http.post('/api/v1/admin/insurance-rules').set(auth(root.token)).send({ countryCode: 'AM', categoryId: plumber, workerType: 'INDEPENDENT', required: false, requiredRisks: [] });
    expect(dup.body.code).toBe('ALREADY_EXISTS');

    const w = await readyWorker(ctx, '+37491300070', north(YEREVAN_CENTER, 500));
    const c = await login(ctx, '+37499300070', 'client');
    const o1 = await createOrder(ctx, c.token);
    expect(await offersOf(ctx, o1.body.id)).toHaveLength(0);
    const reqs = await ctx.http.get('/api/v1/worker/insurance-requirements').set(auth(w.token)).expect(200);
    expect(reqs.body.items[0]).toMatchObject({ requiredRisks: ['liability'], satisfied: false });
    await ctx.http.post(`/api/v1/orders/${o1.body.id}/cancel`).set(auth(c.token)).send({ reason: 'changed_mind' }).expect(200);

    // полис действует 10 дней и покрывает ответственность → заказы идут
    const key = await upload(w.token, 'document');
    const doc = await ctx.http
      .post('/api/v1/documents')
      .set(auth(w.token))
      .send({ kind: 'INSURANCE', fileKey: key, insurance: { insurerName: 'Ingo', policyNumber: 'P-1', validFrom: new Date(Date.now() - 86_400_000).toISOString(), validUntil: new Date(Date.now() + 10 * 86_400_000).toISOString(), coveredRisks: ['liability', 'property'] } })
      .expect(201);
    await ctx.prisma.document.update({ where: { id: doc.body.id }, data: { status: 'VERIFIED' } });
    const o2 = await createOrder(ctx, c.token);
    expect(await offersOf(ctx, o2.body.id)).toHaveLength(1);

    const insurance = ctx.app.get(InsuranceService);
    expect((await insurance.runExpiry()).reminded).toBe(1);
    expect((await insurance.runExpiry()).reminded).toBe(0); // повторно за тот же порог не напоминаем
    expect(ctx.push.sent.filter((p) => p.message.data.type === 'push.insurance_expiring')).toHaveLength(1);
    const res = await insurance.runExpiry(new Date(Date.now() + 11 * 86_400_000));
    expect(res.expired).toBe(1);
    expect((await ctx.prisma.document.findUniqueOrThrow({ where: { id: doc.body.id } })).status).toBe('EXPIRED');
  });
});

describe('monthly bonuses (20.4)', () => {
  it('draft by rule, approval by finance credits the bonus pocket; approved run is locked', async () => {
    const finance = await createAdmin(ctx, 'finance@masterio.test', ['FINANCE']);
    await ctx.prisma.bonusRule.updateMany({ data: { isActive: false } });
    await ctx.http
      .post('/api/v1/admin/bonus-rules')
      .set(auth(finance.token))
      .send({ name: 'starter', minOrders: 1, maxOrders: null, percentBp: 600, minRating: 0, maxCancelRateBp: 10_000, maxLostDisputes: 0, isActive: true })
      .expect(201);
    const o = await completed('080');
    // заказ подтверждён в прошлом месяце и окно споров уже прошло
    const period = previousMonth(new Date());
    const [y, m] = period.split('-').map(Number) as [number, number];
    await ctx.prisma.order.update({ where: { id: o.orderId }, data: { confirmedAt: new Date(Date.UTC(y, m - 1, 2)) } });

    const bonuses = ctx.app.get(BonusesService);
    const asOf = new Date(Date.UTC(y, m - 1, 2) + 40 * 86_400_000);
    const run = await bonuses.calculate(period, asOf);
    const view = await ctx.http.get(`/api/v1/admin/bonus-runs/${run.id}`).set(auth(finance.token)).expect(200);
    expect(view.body.status).toBe('DRAFT');
    expect(view.body.awards[0]).toMatchObject({ workerId: o.worker.userId, ordersCount: 1, commissionPaidCents: 1_000, rawCents: 60, finalCents: 60 });
    expect((await ctx.http.get(`/api/v1/admin/bonus-runs/${run.id}`).set(auth(root.token))).status).toBe(200);
    const support = await createAdmin(ctx, 'support@masterio.test', ['SUPPORT']);
    expect((await ctx.http.post(`/api/v1/admin/bonus-runs/${run.id}/approve`).set(auth(support.token))).status).toBe(403);

    await ctx.http.post(`/api/v1/admin/bonus-runs/${run.id}/approve`).set(auth(finance.token)).expect(200);
    const wallet = await ctx.http.get('/api/v1/wallet').set(auth(o.worker.token)).expect(200);
    expect(wallet.body.bonusCents).toBe(60);
    const again = await ctx.http.post(`/api/v1/admin/bonus-runs/${run.id}/approve`).set(auth(finance.token));
    expect(again.body.code).toBe('BONUS_RUN_LOCKED');
    const mine = await ctx.http.get('/api/v1/worker/bonuses').set(auth(o.worker.token)).expect(200);
    expect(mine.body[0]).toMatchObject({ period, finalCents: 60 });
  });
});

describe('personal data (GDPR, 19.6)', () => {
  it('export, delete blocked by active order, delete anonymises and keeps legally required records', async () => {
    const o = await acceptedOrder('090');
    const exp = await ctx.http.post('/api/v1/me/data-export').set(auth(o.client.token)).expect(200);
    const file = await fetch(exp.body.url as string);
    const json = (await file.json()) as { profile: { phone: string }; orders: unknown[] };
    expect(json.profile.phone).toBe('+3749930090');
    expect(json.orders).toHaveLength(1);

    const blocked = await ctx.http.post('/api/v1/me/delete-account').set(auth(o.client.token)).send({ confirm: true });
    expect(blocked.body).toMatchObject({ code: 'ACCOUNT_DELETE_BLOCKED', details: { reason: 'active_order' } });
    await ctx.http.post(`/api/v1/orders/${o.orderId}/cancel`).set(auth(o.client.token)).send({ reason: 'changed_mind' }).expect(200);

    const del = await ctx.http.post('/api/v1/me/delete-account').set(auth(o.client.token)).send({ confirm: true, reason: 'moving away' }).expect(200);
    expect(del.body.status).toBe('partially_retained');
    expect(del.body.retained).toContain('orders');
    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { id: o.client.userId } });
    expect(u).toMatchObject({ status: 'DELETED', phone: null, firstNameEnc: null });
    expect((await ctx.http.get('/api/v1/me').set(auth(o.client.token))).status).toBe(401);
    // номер освободился — можно зарегистрироваться заново как новый пользователь
    const fresh = await login(ctx, '+3749930090', 'client');
    expect(fresh.userId).not.toBe(o.client.userId);
    const support = await createAdmin(ctx, 'support@masterio.test', ['SUPPORT']);
    const reqs = await ctx.http.get('/api/v1/admin/data-requests').set(auth(support.token)).expect(200);
    expect(reqs.body.map((r: { type: string }) => r.type).sort()).toEqual(['delete', 'export']);
  });
});
