/**
 * Фаза 7: команды и помощники (разделы 18.2, 19.2, 19.6): приглашение, режим участника, назначение только
 * проверенного участника, замена с согласием клиента, «пришёл не тот», ёмкость команды, автоназначение,
 * страховка участника или компании, журнал, удаление аккаунта.
 */
import { TeamsService } from '../../src/teams/teams.service';
import { auth, createOrder, login, north, offersOf, readyWorker, resetState, startApp, stopApp, YEREVAN_CENTER, type TestCtx } from '../helpers';

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

const pushTypes = (token: string) =>
  ctx.push.sent.filter((p) => p.tokens.includes(token)).map((p) => (p.message.data as Record<string, string> | undefined)?.type?.replace(/^push\./, ''));

/** Руководитель с командой и участником, принявшим приглашение. */
async function teamWithMember(suffix: string, opts: { verified?: boolean; role?: 'HELPER' | 'MASTER' | 'EMPLOYEE' } = {}) {
  const owner = await readyWorker(ctx, `+3749140${suffix}`, north(YEREVAN_CENTER, 1_000), { name: 'Levon' });
  const o = auth(owner.token);
  await ctx.http.post('/api/v1/team').set(o).send({ name: 'Levon & Co' }).expect(201);
  const memberPhone = `+3749150${suffix}`;
  const invite = await ctx.http.post('/api/v1/team/invites').set(o).send({ phone: memberPhone, role: opts.role ?? 'HELPER' });
  expect(invite.status).toBe(201);
  const member = await login(ctx, memberPhone, 'worker');
  const m = auth(member.token);
  await ctx.http.patch('/api/v1/me').set(m).send({ firstName: 'Gor' }).expect(200);
  await ctx.http.post('/api/v1/me/devices').set(m).send({ deviceId: `device-${memberPhone}`, platform: 'android', pushToken: `push-${memberPhone}` }).expect(204);
  if (opts.verified !== false) await ctx.prisma.workerProfile.update({ where: { userId: member.userId }, data: { kycStatus: 'VERIFIED' } });
  const mine = await ctx.http.get('/api/v1/team/invites/mine').set(m).expect(200);
  expect(mine.body).toHaveLength(1);
  expect(mine.body[0].team.name).toBe('Levon & Co');
  await ctx.http.post(`/api/v1/team/invites/${mine.body[0].id as string}/accept`).set(m).expect(201);
  const team = await ctx.http.get('/api/v1/team').set(o).expect(200);
  const memberRow = (team.body.members as Array<{ id: string; userId: string; role: string }>).find((x) => x.userId === member.userId)!;
  const leaderRow = (team.body.members as Array<{ id: string; role: string }>).find((x) => x.role === 'LEADER')!;
  return { owner, member, memberPhone, memberId: memberRow.id, leaderId: leaderRow.id };
}

async function acceptedByTeam(t: Awaited<ReturnType<typeof teamWithMember>>, clientPhone: string) {
  const client = await login(ctx, clientPhone, 'client');
  await ctx.http.post('/api/v1/me/devices').set(auth(client.token)).send({ deviceId: `device-${clientPhone}`, platform: 'ios', pushToken: `push-${clientPhone}` }).expect(204);
  const order = await createOrder(ctx, client.token);
  const [offer] = await offersOf(ctx, order.body.id);
  expect(offer?.workerId).toBe(t.owner.userId);
  await ctx.http.post(`/api/v1/offers/${offer!.id}/accept`).set(auth(t.owner.token)).expect(200);
  return { client, orderId: order.body.id as string };
}

describe('teams and helpers', () => {
  it('invite → member mode: no line, no wallet top-up, membership visible; invalid invites are refused', async () => {
    const t = await teamWithMember('01');
    const m = auth(t.member.token);
    const me = await ctx.http.get('/api/v1/me').set(m).expect(200);
    expect(me.body.team).toMatchObject({ mode: 'member', name: 'Levon & Co', role: 'HELPER' });
    const online = await ctx.http.post('/api/v1/worker/online').set(m).send({ location: YEREVAN_CENTER });
    expect(online.status).toBe(403);
    expect(online.body.code).toBe('TEAM_MEMBER_MODE');
    const topup = await ctx.http.post('/api/v1/wallet/topups').set(m).send({ amountCents: 2_000 });
    expect(topup.body.code).toBe('TEAM_MEMBER_MODE');
    expect(pushTypes(`push-+3749140${'01'}`)).toContain('team_member_joined');

    const o = auth(t.owner.token);
    const own = await ctx.http.post('/api/v1/team/invites').set(o).send({ phone: '+374914001', role: 'HELPER' });
    expect(own.status).toBe(400);
    await login(ctx, '+37499900101', 'client');
    const client = await ctx.http.post('/api/v1/team/invites').set(o).send({ phone: '+37499900101', role: 'HELPER' });
    expect(client.body.details).toMatchObject({ phone: 'not_worker_account' });
    // участник уже в команде — второй руководитель пригласить его не может
    const other = await readyWorker(ctx, '+37491400199', north(YEREVAN_CENTER, 3_000));
    await ctx.http.post('/api/v1/team').set(auth(other.token)).send({ name: 'Other team' }).expect(201);
    const again = await ctx.http.post('/api/v1/team/invites').set(auth(other.token)).send({ phone: t.memberPhone, role: 'HELPER' });
    expect(again.body.code).toBe('ALREADY_IN_TEAM');

    const owner = await ctx.http.get('/api/v1/team').set(o).expect(200);
    expect(owner.body).toMatchObject({ mode: 'owner', capacity: 2 });
    const journal = await ctx.http.get('/api/v1/team/events').set(o).expect(200);
    expect((journal.body as Array<{ type: string }>).map((e) => e.type)).toEqual(expect.arrayContaining(['created', 'invited', 'joined']));
  });

  it('assigning an unverified member is rejected', async () => {
    const t = await teamWithMember('02', { verified: false });
    const { orderId } = await acceptedByTeam(t, '+37499300202');
    const res = await ctx.http.post(`/api/v1/orders/${orderId}/assign`).set(auth(t.owner.token)).send({ teamMemberId: t.memberId });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('TEAM_MEMBER_NOT_ELIGIBLE');
    expect(res.body.details.blockers).toContain('kyc');
    const list = await ctx.http.get(`/api/v1/orders/${orderId}/performers`).set(auth(t.owner.token)).expect(200);
    const row = (list.body.items as Array<{ memberId: string; eligible: boolean }>).find((x) => x.memberId === t.memberId);
    expect(row?.eligible).toBe(false);
  });

  it('assigned member performs; replacement needs client consent and notifies everyone', async () => {
    const t = await teamWithMember('03');
    const { client, orderId } = await acceptedByTeam(t, '+37499300303');
    expect(pushTypes(`push-+3749140${'03'}`)).toContain('team_assign_needed');
    const o = auth(t.owner.token);
    const m = auth(t.member.token);

    const info = await ctx.http.get(`/api/v1/orders/${orderId}`).set(o).expect(200);
    expect(info.body.team).toMatchObject({ needsAssignment: true, current: null });

    await ctx.http.post(`/api/v1/orders/${orderId}/assign`).set(o).send({ teamMemberId: t.memberId }).expect(201);
    expect(pushTypes('push-+37499300303')).toContain('performer_assigned');
    expect(pushTypes(t.memberPhone.replace('+', 'push-+'))).toContain('team_assigned');
    const seen = await ctx.http.get(`/api/v1/orders/${orderId}`).set(auth(client.token)).expect(200);
    expect(seen.body.performer).toMatchObject({ name: 'Gor', role: 'HELPER' });
    // клиенту — только имя, фото, роль и значки, без документов
    expect(Object.keys(seen.body.performer as object).sort()).toEqual(['badges', 'name', 'phone', 'photoKey', 'ratingAvg', 'role', 'userId'].sort());

    // статусы подтверждает назначенный исполнитель, а не руководитель
    const byOwner = await ctx.http.post(`/api/v1/orders/${orderId}/status`).set(o).send({ status: 'EN_ROUTE', location: north(YEREVAN_CENTER, 1_000) });
    expect(byOwner.status).toBe(403);
    await ctx.http.post(`/api/v1/orders/${orderId}/status`).set(m).send({ status: 'EN_ROUTE', location: north(YEREVAN_CENTER, 900) }).expect(200);
    const memberView = await ctx.http.get(`/api/v1/orders/${orderId}`).set(m).expect(200);
    expect(memberView.body.viewer).toBe('performer');
    // телефон участника ведёт геопозицию по назначенному заказу
    const memberElig = await ctx.http.get('/api/v1/worker/eligibility').set(m).expect(200);
    expect(memberElig.body.activeOrderId).toBe(orderId);
    expect(memberElig.body.reasons).toContain('team_member');
    const track = await ctx.http.post('/api/v1/tracking/batch').set(m).send({ points: [{ ...north(YEREVAN_CENTER, 800), recordedAt: new Date().toISOString() }] }).expect(200);
    expect(track.body.orderId).toBe(orderId);
    // участник на месте сообщает о происшествии, руководитель узнаёт сразу
    await ctx.http.post(`/api/v1/orders/${orderId}/incidents`).set(m).send({ type: 'INJURY', description: 'Cut hand on glass', emergencyCalled: false }).expect(201);
    expect(pushTypes(`push-+3749140${'03'}`)).toContain('team_incident');

    // замена после выезда — с согласием клиента
    await ctx.http.post(`/api/v1/orders/${orderId}/assign`).set(o).send({ teamMemberId: t.leaderId, reason: 'car broke down' }).expect(201);
    expect(pushTypes('push-+37499300303')).toContain('performer_change_request');
    const pending = await ctx.http.get(`/api/v1/orders/${orderId}`).set(auth(client.token)).expect(200);
    expect(pending.body.pendingPerformerChange).toMatchObject({ name: 'Levon', role: 'LEADER', reason: 'car broke down' });
    expect(pending.body.performer.name).toBe('Gor');

    await ctx.http.post(`/api/v1/orders/${orderId}/performer-change`).set(auth(client.token)).send({ approve: true }).expect(201);
    const after = await ctx.http.get(`/api/v1/orders/${orderId}`).set(auth(client.token)).expect(200);
    expect(after.body.performer.name).toBe('Levon');
    expect(after.body.pendingPerformerChange).toBeNull();
    expect(pushTypes(t.memberPhone.replace('+', 'push-+'))).toContain('team_unassigned');
    expect(pushTypes(`push-+3749140${'03'}`)).toContain('performer_change_approved');

    const journal = await ctx.http.get('/api/v1/team/events').set(o).expect(200);
    expect((journal.body as Array<{ type: string }>).map((e) => e.type)).toEqual(expect.arrayContaining(['assigned', 'change_requested', 'change_approved']));
    const events = await ctx.prisma.orderEvent.findMany({ where: { orderId }, select: { type: true } });
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['performer_assigned', 'performer_change_requested', 'performer_replaced']));
  });

  it('client declining a replacement keeps the current performer', async () => {
    const t = await teamWithMember('04');
    const { client, orderId } = await acceptedByTeam(t, '+37499300404');
    const o = auth(t.owner.token);
    await ctx.http.post(`/api/v1/orders/${orderId}/assign`).set(o).send({ teamMemberId: t.memberId }).expect(201);
    await ctx.http.post(`/api/v1/orders/${orderId}/assign`).set(o).send({ teamMemberId: t.leaderId }).expect(201);
    await ctx.http.post(`/api/v1/orders/${orderId}/performer-change`).set(auth(client.token)).send({ approve: false }).expect(201);
    const after = await ctx.http.get(`/api/v1/orders/${orderId}`).set(o).expect(200);
    expect(after.body.team.current.name).toBe('Gor');
    expect(after.body.team.pending).toBeNull();
    expect(pushTypes(`push-+3749140${'04'}`)).toContain('performer_change_declined');
  });

  it('wrong person arrived → performer mismatch event and automatic dispute', async () => {
    const t = await teamWithMember('05');
    const { client, orderId } = await acceptedByTeam(t, '+37499300505');
    await ctx.http.post(`/api/v1/orders/${orderId}/assign`).set(auth(t.owner.token)).send({ teamMemberId: t.memberId }).expect(201);
    await ctx.http.post(`/api/v1/orders/${orderId}/status`).set(auth(t.member.token)).send({ status: 'EN_ROUTE', location: north(YEREVAN_CENTER, 900) }).expect(200);
    const res = await ctx.http.post(`/api/v1/orders/${orderId}/performer-mismatch`).set(auth(client.token)).send({ description: 'A different man came' }).expect(201);
    const dispute = await ctx.prisma.dispute.findUniqueOrThrow({ where: { id: res.body.id as string } });
    expect(dispute).toMatchObject({ reason: 'PERFORMER_MISMATCH', isAutomatic: true, againstId: t.owner.userId });
    const order = await ctx.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('DISPUTED');
    const ev = await ctx.prisma.orderEvent.findFirst({ where: { orderId, type: 'performer_mismatch' } });
    expect(ev).not.toBeNull();
    // ожидаемый исполнитель сохранён в доказательствах спора
    const evidence = await ctx.prisma.disputeEvidence.findFirst({ where: { disputeId: dispute.id, kind: 'performer_expected' } });
    expect(evidence?.content).toMatchObject({ name: 'Gor', role: 'HELPER' });
  });

  it('a team takes as many orders at once as it has free verified performers', async () => {
    const t = await teamWithMember('06');
    const first = await acceptedByTeam(t, '+37499300606');
    await ctx.http.post(`/api/v1/orders/${first.orderId}/assign`).set(auth(t.owner.token)).send({ teamMemberId: t.memberId }).expect(201);
    const second = await acceptedByTeam(t, '+37499300607');
    const elig = await ctx.http.get('/api/v1/worker/eligibility').set(auth(t.owner.token)).expect(200);
    expect(elig.body).toMatchObject({ capacity: 2, activeOrderId: second.orderId });
    expect(elig.body.reasons).toContain('active_order');
    const client3 = await login(ctx, '+37499300608', 'client');
    const third = await createOrder(ctx, client3.token);
    expect(await offersOf(ctx, third.body.id)).toHaveLength(0);
    // на второй заказ участник уже занят — назначить его нельзя
    const busy = await ctx.http.post(`/api/v1/orders/${second.orderId}/assign`).set(auth(t.owner.token)).send({ teamMemberId: t.memberId });
    expect(busy.body.details.blockers).toContain('busy');
  });

  it('no assignment within TEAM_ASSIGN_TIMEOUT_MIN → the leader becomes the performer automatically', async () => {
    const t = await teamWithMember('07');
    const { client, orderId } = await acceptedByTeam(t, '+37499300707');
    const order = await ctx.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    await ctx.app.get(TeamsService).assignTimeout(orderId, String(order.acceptedAt?.getTime()));
    const a = await ctx.prisma.orderAssignment.findFirstOrThrow({ where: { orderId, isCurrent: true }, include: { teamMember: true } });
    expect(a).toMatchObject({ automatic: true, state: 'ACTIVE' });
    expect(a.teamMember.role).toBe('LEADER');
    expect(pushTypes('push-+37499300707')).toContain('performer_assigned');
    const seen = await ctx.http.get(`/api/v1/orders/${orderId}`).set(auth(client.token)).expect(200);
    expect(seen.body.performer.name).toBe('Levon');
    // повторный таймер ничего не меняет
    await ctx.app.get(TeamsService).assignTimeout(orderId, String(order.acceptedAt?.getTime()));
    expect(await ctx.prisma.orderAssignment.count({ where: { orderId } })).toBe(1);
  });

  it('insurance: a member needs his own valid policy unless the company policy covers employees', async () => {
    const t = await teamWithMember('08', { role: 'EMPLOYEE' });
    await ctx.prisma.insuranceRule.create({ data: { countryCode: 'AM', categoryId: ctx.categoryId, required: true, requiredRisks: ['liability'] } });
    // руководителю нужен полис, чтобы получить заказ
    const policyFor = async (ownerId: string) => {
      const d = await ctx.prisma.document.create({ data: { ownerId, kind: 'INSURANCE', fileKey: `private/document/${ownerId}/p.jpg`, status: 'VERIFIED', validUntil: new Date(Date.now() + 90 * 86_400_000) } });
      await ctx.prisma.insurancePolicy.create({ data: { documentId: d.id, insurerName: 'Ins', policyNumber: `P-${ownerId.slice(0, 6)}`, validFrom: new Date(), validUntil: d.validUntil!, coveredRisks: ['liability'] } });
    };
    await policyFor(t.owner.userId);
    const { orderId } = await acceptedByTeam(t, '+37499300808');
    const refused = await ctx.http.post(`/api/v1/orders/${orderId}/assign`).set(auth(t.owner.token)).send({ teamMemberId: t.memberId });
    expect(refused.body.details.blockers).toEqual(['insurance']);
    // компания отвечает за своих сотрудников: её полис покрывает участника
    await ctx.prisma.workerProfile.update({ where: { userId: t.owner.userId }, data: { type: 'COMPANY', companyName: 'Levon LLC' } });
    await ctx.http.post(`/api/v1/orders/${orderId}/assign`).set(auth(t.owner.token)).send({ teamMemberId: t.memberId }).expect(201);
  });

  it('a busy member cannot be removed or delete the account; after that the membership closes', async () => {
    const t = await teamWithMember('09');
    const { orderId } = await acceptedByTeam(t, '+37499300909');
    await ctx.http.post(`/api/v1/orders/${orderId}/assign`).set(auth(t.owner.token)).send({ teamMemberId: t.memberId }).expect(201);
    const remove = await ctx.http.delete(`/api/v1/team/members/${t.memberId}`).set(auth(t.owner.token));
    expect(remove.body.code).toBe('TEAM_HAS_ACTIVE_WORK');
    const del = await ctx.http.post('/api/v1/me/delete-account').set(auth(t.member.token)).send({ confirm: true });
    expect(del.body.code).toBe('ACCOUNT_DELETE_BLOCKED');

    await ctx.http.post(`/api/v1/orders/${orderId}/worker-cancel`).set(auth(t.owner.token)).send({ reason: 'cannot_arrive' }).expect(200);
    // участник, уже назначенный на заказ, узнаёт об отмене
    expect(pushTypes(t.memberPhone.replace('+', 'push-+'))).toContain('team_unassigned');
    await ctx.http.delete(`/api/v1/team/members/${t.memberId}`).set(auth(t.owner.token)).expect(204);
    expect(pushTypes(t.memberPhone.replace('+', 'push-+'))).toContain('team_removed');
    const me = await ctx.http.get('/api/v1/me').set(auth(t.member.token)).expect(200);
    expect(me.body.team).toBeNull();
    // журнал команды только дописывается
    await expect(ctx.prisma.teamEvent.deleteMany({})).rejects.toThrow();
  });

  it('CRM sees the team, its members and journal; member documents show the team in the queue', async () => {
    const t = await teamWithMember('10', { verified: false });
    const { createAdmin } = await import('../helpers');
    const support = await createAdmin(ctx, 'support@masterio.test', ['SUPPORT']);
    const res = await ctx.http.get(`/api/v1/admin/workers/${t.owner.userId}/team`).set(auth(support.token)).expect(200);
    expect(res.body.team.members).toHaveLength(2);
    expect(res.body.team.events.length).toBeGreaterThanOrEqual(3);
    const asMember = await ctx.http.get(`/api/v1/admin/workers/${t.member.userId}/team`).set(auth(support.token)).expect(200);
    expect(asMember.body.memberOf).toMatchObject({ teamName: 'Levon & Co', role: 'HELPER' });

    const member = await ctx.prisma.teamMember.findUniqueOrThrow({ where: { id: t.memberId } });
    await ctx.prisma.document.create({ data: { ownerId: t.member.userId, teamMemberId: member.id, kind: 'ID_DOCUMENT', fileKey: `private/document/${t.member.userId}/id.jpg` } });
    const moderator = await createAdmin(ctx, 'mod@masterio.test', ['MODERATOR']);
    const queue = await ctx.http.get('/api/v1/admin/documents?status=NOT_VERIFIED').set(auth(moderator.token)).expect(200);
    const row = (queue.body as Array<{ owner: { id: string }; team: unknown }>).find((d) => d.owner.id === t.member.userId);
    expect(row?.team).toMatchObject({ name: 'Levon & Co', role: 'HELPER', ownerId: t.owner.userId });
  });
});
