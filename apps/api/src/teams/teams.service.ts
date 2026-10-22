import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ACTIVE_ORDER_STATUSES, RT_EVENTS, type MemberBlocker, type TeamInviteRole } from '@masterio/shared';
import { AppException } from '../common/app-exception';
import type { AuthUser } from '../common/auth';
import { PII_CIPHER, PiiCipher } from '../common/crypto';
import { InsuranceService } from '../compliance/insurance.service';
import { DisputesService } from '../disputes/disputes.service';
import type { Order, Prisma, TeamMember } from '../generated/prisma/client';
import { JobsService, jobId } from '../jobs/jobs.service';
import { LegalService } from '../legal/legal.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SettingsService } from '../settings/settings.service';

const ACTIVE = [...ACTIVE_ORDER_STATUSES];
type Db = PrismaService | Tx;

export interface MemberCheck {
  memberId: string;
  userId: string;
  name: string | null;
  role: string;
  eligible: boolean;
  blockers: MemberBlocker[];
  /** номер заказа, на котором участник сейчас работает */
  busyOrderNumber: number | null;
}

/**
 * Команды и помощники (разделы 18.2, 19.2). Предложение заказа уходит руководителю (мастеру или компании),
 * он назначает исполнителя из проверенных участников; без назначения за TEAM_ASSIGN_TIMEOUT_MIN исполнителем
 * становится сам руководитель. Комиссия, баланс, рейтинг и отмены — по аккаунту руководителя.
 * Участник работает в Masterio Pro со своим телефоном: только назначенные заказы, без линии и кошелька.
 */
@Injectable()
export class TeamsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly insurance: InsuranceService,
    private readonly legal: LegalService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly jobs: JobsService,
    private readonly disputes: DisputesService,
    @Inject(PII_CIPHER) private readonly pii: PiiCipher,
  ) {}

  onModuleInit(): void {
    this.jobs.register('team-assign-timeout', (d) => this.assignTimeout(d.orderId ?? '', d.acceptedAt));
  }

  // ───────────── Кто есть кто ─────────────

  /** Активное участие в чужой команде (не руководитель) — «режим участника». */
  async membership(userId: string, db: Db = this.prisma) {
    return db.teamMember.findFirst({ where: { userId, isActive: true, role: { not: 'LEADER' } }, include: { team: true } });
  }

  async assertNotMember(userId: string): Promise<void> {
    if (await this.membership(userId)) throw new AppException('TEAM_MEMBER_MODE');
  }

  /**
   * Сколько заказов команда может вести одновременно: руководитель плюс активные участники с подтверждённой
   * личностью. Без команды — один, как раньше.
   */
  async capacity(ownerId: string, db: Db = this.prisma): Promise<number> {
    const members = await db.teamMember.count({
      where: { team: { ownerId }, isActive: true, role: { not: 'LEADER' }, user: { status: { in: ['ACTIVE', 'WARNED'] }, worker: { kycStatus: 'VERIFIED' } } },
    });
    return 1 + members;
  }

  /** Блокировка команды в транзакции: принятие заказов и назначения не пересекаются. */
  async lock(tx: Tx, ownerId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`team:${ownerId}`}))`;
  }

  // ───────────── Команда руководителя ─────────────

  private teamsEnabled(countryCode: string): boolean {
    return this.settings.get('TEAMS_ENABLED', { countryCode });
  }

  async create(user: AuthUser, name: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { countryCode: true } });
    if (!this.teamsEnabled(u.countryCode)) throw new AppException('TEAMS_DISABLED');
    await this.assertNotMember(user.id);
    const existing = await this.prisma.team.findUnique({ where: { ownerId: user.id } });
    if (existing) return this.mine(user);
    await this.prisma.$transaction(async (tx) => {
      const team = await tx.team.create({ data: { ownerId: user.id, name } });
      await tx.teamMember.create({ data: { teamId: team.id, userId: user.id, role: 'LEADER', kycStatus: (await this.kyc(tx, user.id)) } });
      await tx.teamEvent.create({ data: { teamId: team.id, actorId: user.id, type: 'created', payload: { name } } });
    });
    return this.mine(user);
  }

  async rename(user: AuthUser, name: string) {
    const team = await this.ownTeam(user.id);
    await this.prisma.$transaction([
      this.prisma.team.update({ where: { id: team.id }, data: { name } }),
      this.prisma.teamEvent.create({ data: { teamId: team.id, actorId: user.id, type: 'renamed', payload: { from: team.name, to: name } } }),
    ]);
    return this.mine(user);
  }

  private async ownTeam(ownerId: string) {
    const team = await this.prisma.team.findUnique({ where: { ownerId } });
    if (!team) throw new AppException('NOT_FOUND');
    return team;
  }

  private async kyc(db: Db, userId: string) {
    const w = await db.workerProfile.findUnique({ where: { userId }, select: { kycStatus: true } });
    return w?.kycStatus ?? 'NOT_VERIFIED';
  }

  /** «Моя команда»: для руководителя — участники и приглашения; для участника — его команда и роль. */
  async mine(user: AuthUser) {
    const membership = await this.membership(user.id);
    if (membership) {
      const leader = await this.prisma.user.findUniqueOrThrow({ where: { id: membership.team.ownerId }, select: { firstNameEnc: true, worker: { select: { companyName: true } } } });
      return {
        mode: 'member' as const,
        team: { id: membership.team.id, name: membership.team.name },
        leaderName: leader.worker?.companyName ?? this.pii.decrypt(leader.firstNameEnc),
        role: membership.role,
        memberId: membership.id,
        joinedAt: membership.joinedAt,
      };
    }
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { countryCode: true } });
    const team = await this.prisma.team.findUnique({ where: { ownerId: user.id } });
    if (!team) return { mode: 'none' as const, teamsEnabled: this.teamsEnabled(u.countryCode) };
    const members = await this.prisma.teamMember.findMany({
      where: { teamId: team.id, isActive: true },
      include: { user: { select: { id: true, phone: true, firstNameEnc: true, status: true, worker: { select: { kycStatus: true } } } } },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    });
    const busy = await this.busyMap(team.ownerId);
    const now = new Date();
    const invites = await this.prisma.teamInvite.findMany({ where: { teamId: team.id, status: 'PENDING', expiresAt: { gt: now } }, orderBy: { createdAt: 'desc' } });
    const docs = await this.prisma.document.findMany({
      where: { ownerId: { in: members.map((m) => m.userId) }, status: { in: ['VERIFIED', 'NOT_VERIFIED', 'EXPIRED', 'REJECTED'] }, kind: { in: ['LICENSE', 'INSURANCE'] } },
      select: { ownerId: true, kind: true, status: true, validUntil: true },
    });
    return {
      mode: 'owner' as const,
      teamsEnabled: this.teamsEnabled(u.countryCode),
      team: { id: team.id, name: team.name, createdAt: team.createdAt },
      capacity: await this.capacity(user.id),
      limit: this.settings.get('TEAM_MAX_MEMBERS', { countryCode: u.countryCode }),
      members: members.map((m) => {
        const own = docs.filter((d) => d.ownerId === m.userId && d.status === 'VERIFIED' && (!d.validUntil || d.validUntil > now));
        return {
          id: m.id,
          userId: m.userId,
          role: m.role,
          name: this.pii.decrypt(m.user.firstNameEnc),
          phone: m.user.phone,
          kycStatus: m.user.worker?.kycStatus ?? m.kycStatus,
          blocked: m.user.status !== 'ACTIVE' && m.user.status !== 'WARNED',
          licenses: own.filter((d) => d.kind === 'LICENSE').length,
          insured: own.some((d) => d.kind === 'INSURANCE'),
          busyOrderNumber: busy.get(m.userId) ?? null,
          joinedAt: m.joinedAt,
        };
      }),
      invites: invites.map((i) => ({ id: i.id, phone: i.phone, role: i.role, expiresAt: i.expiresAt, createdAt: i.createdAt })),
    };
  }

  /** Кто из команды сейчас на каком активном заказе (userId → номер заказа). */
  private async busyMap(ownerId: string, db: Db = this.prisma, exceptOrderId?: string): Promise<Map<string, number>> {
    const orders = await db.order.findMany({
      where: { workerId: ownerId, status: { in: ACTIVE }, ...(exceptOrderId ? { NOT: { id: exceptOrderId } } : {}) },
      select: { id: true, number: true, assignments: { where: { state: { in: ['ACTIVE', 'PENDING_CONSENT'] } }, select: { state: true, teamMember: { select: { userId: true } } } } },
    });
    const map = new Map<string, number>();
    for (const o of orders) {
      const current = o.assignments.find((a) => a.state === 'ACTIVE');
      map.set(current ? current.teamMember.userId : ownerId, o.number);
      // кандидат на замену тоже занят, пока клиент не ответил
      const pending = o.assignments.find((a) => a.state === 'PENDING_CONSENT');
      if (pending) map.set(pending.teamMember.userId, o.number);
    }
    return map;
  }

  async events(user: AuthUser, before?: string) {
    const team = await this.ownTeam(user.id);
    const rows = await this.prisma.teamEvent.findMany({
      where: { teamId: team.id, ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const memberIds = [...new Set(rows.map((r) => r.memberId).filter((x): x is string => Boolean(x)))];
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => Boolean(x)))];
    const members = await this.prisma.teamMember.findMany({ where: { id: { in: memberIds } }, select: { id: true, role: true, user: { select: { firstNameEnc: true } } } });
    const actors = await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, role: true, firstNameEnc: true } });
    const orderIds = [...new Set(rows.map((r) => r.orderId).filter((x): x is string => Boolean(x)))];
    const orders = await this.prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, number: true } });
    return rows.map((r) => {
      const m = members.find((x) => x.id === r.memberId);
      const a = actors.find((x) => x.id === r.actorId);
      return {
        id: r.id,
        type: r.type,
        createdAt: r.createdAt,
        memberName: m ? this.pii.decrypt(m.user.firstNameEnc) : null,
        memberRole: m?.role ?? null,
        actor: a ? (a.role === 'CLIENT' ? 'client' : a.id === user.id ? 'you' : this.pii.decrypt(a.firstNameEnc)) : 'system',
        orderId: r.orderId,
        orderNumber: orders.find((o) => o.id === r.orderId)?.number ?? null,
        payload: r.payload,
      };
    });
  }

  // ───────────── Приглашения ─────────────

  async invite(user: AuthUser, phone: string, role: TeamInviteRole) {
    const team = await this.ownTeam(user.id);
    const owner = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { phone: true, countryCode: true } });
    if (!this.teamsEnabled(owner.countryCode)) throw new AppException('TEAMS_DISABLED');
    // руководитель принимает условия для команд перед добавлением помощника (раздел 18.6)
    await this.legal.assertConsented(user, 'add_helper');
    if (owner.phone === phone) throw new AppException('VALIDATION_FAILED', { phone: 'own_number' });
    const target = await this.prisma.user.findUnique({ where: { phone }, select: { id: true, role: true } });
    if (target && target.role !== 'WORKER') throw new AppException('VALIDATION_FAILED', { phone: 'not_worker_account' });
    if (target) {
      const already = await this.prisma.teamMember.findFirst({ where: { userId: target.id, isActive: true, OR: [{ role: { not: 'LEADER' } }, { teamId: team.id }] } });
      if (already) throw new AppException('ALREADY_IN_TEAM');
    }
    const limit = this.settings.get('TEAM_MAX_MEMBERS', { countryCode: owner.countryCode });
    const now = new Date();
    const [members, pending] = await Promise.all([
      this.prisma.teamMember.count({ where: { teamId: team.id, isActive: true, role: { not: 'LEADER' } } }),
      this.prisma.teamInvite.count({ where: { teamId: team.id, status: 'PENDING', expiresAt: { gt: now } } }),
    ]);
    if (members + pending >= limit) throw new AppException('TEAM_LIMIT_REACHED', { limit });
    const ttlH = this.settings.get('TEAM_INVITE_TTL_HOURS', { countryCode: owner.countryCode });
    const invite = await this.prisma.$transaction(async (tx) => {
      // просроченное приглашение на тот же номер освобождает место для нового
      await tx.teamInvite.updateMany({ where: { teamId: team.id, phone, status: 'PENDING', expiresAt: { lte: now } }, data: { status: 'EXPIRED' } });
      const existing = await tx.teamInvite.findFirst({ where: { teamId: team.id, phone, status: 'PENDING' } });
      if (existing) return existing;
      const created = await tx.teamInvite.create({ data: { teamId: team.id, phone, role, invitedById: user.id, expiresAt: new Date(now.getTime() + ttlH * 3_600_000) } });
      await tx.teamEvent.create({ data: { teamId: team.id, actorId: user.id, type: 'invited', payload: { phone: maskPhone(phone), role } } });
      return created;
    });
    if (target) {
      await this.notifications.notify(target.id, { key: 'push.team_invite', params: { team: team.name } });
      this.realtime.toUser(target.id, RT_EVENTS.teamUpdated, { kind: 'invite' });
    }
    return { id: invite.id, phone: invite.phone, role: invite.role, expiresAt: invite.expiresAt, accountExists: target !== null };
  }

  async revokeInvite(user: AuthUser, inviteId: string): Promise<void> {
    const team = await this.ownTeam(user.id);
    const res = await this.prisma.teamInvite.updateMany({ where: { id: inviteId, teamId: team.id, status: 'PENDING' }, data: { status: 'REVOKED', respondedAt: new Date() } });
    if (res.count === 0) throw new AppException('NOT_FOUND');
    await this.prisma.teamEvent.create({ data: { teamId: team.id, actorId: user.id, type: 'invite_revoked', payload: { inviteId } } });
  }

  /** Приглашения на мой номер (видны в Masterio Pro до анкеты). */
  async myInvites(user: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { phone: true } });
    if (!u.phone) return [];
    const rows = await this.prisma.teamInvite.findMany({
      where: { phone: u.phone, status: 'PENDING', expiresAt: { gt: new Date() } },
      include: { team: { include: { owner: { select: { companyName: true, type: true, user: { select: { firstNameEnc: true } } } } } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      role: r.role,
      expiresAt: r.expiresAt,
      team: { name: r.team.name, leaderName: r.team.owner.companyName ?? this.pii.decrypt(r.team.owner.user.firstNameEnc), company: r.team.owner.type === 'COMPANY' },
    }));
  }

  async acceptInvite(user: AuthUser, inviteId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { phone: true, role: true } });
    const invite = await this.prisma.teamInvite.findUnique({ where: { id: inviteId }, include: { team: true } });
    if (!invite || invite.phone !== u.phone || u.role !== 'WORKER') throw new AppException('NOT_FOUND');
    if (invite.status !== 'PENDING' || invite.expiresAt <= new Date()) throw new AppException('NOT_FOUND', { reason: 'invite_not_active' });
    if (invite.team.ownerId === user.id) throw new AppException('VALIDATION_FAILED', { reason: 'own_team' });
    if (await this.membership(user.id)) throw new AppException('ALREADY_IN_TEAM');
    // своя команда с участниками или своя работа мешают перейти в режим участника
    const ownMembers = await this.prisma.teamMember.count({ where: { team: { ownerId: user.id }, isActive: true, role: { not: 'LEADER' } } });
    if (ownMembers > 0) throw new AppException('ALREADY_IN_TEAM', { reason: 'leads_team' });
    const activeOrders = await this.prisma.order.count({ where: { workerId: user.id, status: { in: ACTIVE } } });
    const pendingOffers = await this.prisma.offer.count({ where: { workerId: user.id, status: 'PENDING' } });
    if (activeOrders + pendingOffers > 0) throw new AppException('TEAM_HAS_ACTIVE_WORK');

    const member = await this.prisma.$transaction(async (tx) => {
      const taken = await tx.teamInvite.updateMany({ where: { id: invite.id, status: 'PENDING' }, data: { status: 'ACCEPTED', acceptedById: user.id, respondedAt: new Date() } });
      if (taken.count === 0) throw new AppException('NOT_FOUND', { reason: 'invite_not_active' });
      await tx.workerProfile.update({ where: { userId: user.id }, data: { isOnline: false } });
      const kycStatus = await this.kyc(tx, user.id);
      const m = await tx.teamMember.upsert({
        where: { teamId_userId: { teamId: invite.teamId, userId: user.id } },
        create: { teamId: invite.teamId, userId: user.id, role: invite.role, kycStatus },
        update: { role: invite.role, isActive: true, leftAt: null, joinedAt: new Date(), kycStatus },
      });
      await tx.teamEvent.create({ data: { teamId: invite.teamId, actorId: user.id, memberId: m.id, type: 'joined', payload: { role: invite.role } } });
      // остальные приглашения на этот номер больше не нужны
      await tx.teamInvite.updateMany({ where: { phone: invite.phone, status: 'PENDING', NOT: { id: invite.id } }, data: { status: 'DECLINED', respondedAt: new Date() } });
      return m;
    });
    const name = this.pii.decrypt((await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { firstNameEnc: true } })).firstNameEnc);
    await this.notifications.notify(invite.team.ownerId, { key: 'push.team_member_joined', params: { name: name ?? u.phone ?? '' } });
    this.realtime.toUser(invite.team.ownerId, RT_EVENTS.teamUpdated, { kind: 'member' });
    this.realtime.toAdmins(RT_EVENTS.adminMap, { kind: 'offline', userId: user.id });
    return { memberId: member.id, teamId: invite.teamId };
  }

  async declineInvite(user: AuthUser, inviteId: string): Promise<void> {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { phone: true } });
    const invite = await this.prisma.teamInvite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.phone !== u.phone) throw new AppException('NOT_FOUND');
    const res = await this.prisma.teamInvite.updateMany({ where: { id: inviteId, status: 'PENDING' }, data: { status: 'DECLINED', respondedAt: new Date() } });
    if (res.count === 0) throw new AppException('NOT_FOUND', { reason: 'invite_not_active' });
    await this.prisma.teamEvent.create({ data: { teamId: invite.teamId, actorId: user.id, type: 'declined', payload: { inviteId } } });
  }

  /** Участник не может уйти или быть исключён, пока он исполнитель (или кандидат на замену) активного заказа. */
  private async assertFree(member: TeamMember): Promise<void> {
    const busy = await this.prisma.orderAssignment.count({
      where: { teamMemberId: member.id, state: { in: ['ACTIVE', 'PENDING_CONSENT'] }, order: { status: { in: ACTIVE } } },
    });
    if (busy > 0) throw new AppException('TEAM_HAS_ACTIVE_WORK');
  }

  async removeMember(user: AuthUser, memberId: string): Promise<void> {
    const team = await this.ownTeam(user.id);
    const member = await this.prisma.teamMember.findFirst({ where: { id: memberId, teamId: team.id, isActive: true } });
    if (!member) throw new AppException('NOT_FOUND');
    if (member.role === 'LEADER') throw new AppException('VALIDATION_FAILED', { reason: 'leader' });
    await this.assertFree(member);
    await this.deactivate(member, user.id, 'removed');
    await this.notifications.notify(member.userId, { key: 'push.team_removed', params: { team: team.name } });
    this.realtime.toUser(member.userId, RT_EVENTS.teamUpdated, { kind: 'removed' });
  }

  async leave(user: AuthUser): Promise<void> {
    const member = await this.membership(user.id);
    if (!member) throw new AppException('NOT_FOUND');
    await this.assertFree(member);
    await this.deactivate(member, user.id, 'left');
    this.realtime.toUser(member.team.ownerId, RT_EVENTS.teamUpdated, { kind: 'member' });
  }

  private async deactivate(member: TeamMember, actorId: string, type: 'removed' | 'left'): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.teamMember.update({ where: { id: member.id }, data: { isActive: false, leftAt: new Date() } }),
      this.prisma.teamEvent.create({ data: { teamId: member.teamId, actorId, memberId: member.id, type } }),
    ]);
  }

  /** Удаление аккаунта (GDPR): участие закрывается; команда руководителя распускается. */
  async onAccountDeleted(tx: Tx, userId: string): Promise<void> {
    const memberships = await tx.teamMember.findMany({ where: { userId, isActive: true } });
    for (const m of memberships) {
      await tx.teamMember.update({ where: { id: m.id }, data: { isActive: false, leftAt: new Date() } });
      await tx.teamEvent.create({ data: { teamId: m.teamId, memberId: m.id, type: 'left', payload: { reason: 'account_deleted' } } });
    }
    const team = await tx.team.findUnique({ where: { ownerId: userId } });
    if (team) {
      await tx.teamMember.updateMany({ where: { teamId: team.id, isActive: true }, data: { isActive: false, leftAt: new Date() } });
      await tx.teamInvite.updateMany({ where: { teamId: team.id, status: 'PENDING' }, data: { status: 'REVOKED', respondedAt: new Date() } });
    }
  }

  // ───────────── Назначение исполнителя ─────────────

  /** Можно ли назначить участника на заказ: личность, блокировка, лицензия, страховка, занятость (раздел 19.2). */
  async check(order: Order, members: Array<TeamMember & { user: { firstNameEnc: Uint8Array | null; status: string } }>, db: Db = this.prisma): Promise<MemberCheck[]> {
    if (!order.workerId) return [];
    const owner = await db.workerProfile.findUniqueOrThrow({ where: { userId: order.workerId }, select: { type: true } });
    const city = await db.city.findUniqueOrThrow({ where: { id: order.cityId }, select: { countryCode: true } });
    const category = await db.category.findUniqueOrThrow({ where: { id: order.categoryId }, select: { requiresLicense: true } });
    const ins = await this.insurance.requirement(city.countryCode, order.categoryId, owner.type);
    const now = new Date();
    const userIds = members.map((m) => m.userId);
    const [profiles, licenses, policies] = await Promise.all([
      db.workerProfile.findMany({ where: { userId: { in: userIds } }, select: { userId: true, kycStatus: true } }),
      category.requiresLicense
        ? db.license.findMany({ where: { categoryId: order.categoryId, document: { ownerId: { in: userIds }, status: 'VERIFIED', OR: [{ validUntil: null }, { validUntil: { gt: now } }] } }, select: { document: { select: { ownerId: true } } } })
        : Promise.resolve([]),
      ins.required
        ? db.insurancePolicy.findMany({ where: { validUntil: { gt: now }, document: { ownerId: { in: [...userIds, order.workerId] }, status: 'VERIFIED' } }, select: { coveredRisks: true, document: { select: { ownerId: true } } } })
        : Promise.resolve([]),
    ]);
    const covers = (ownerId: string) => policies.some((p) => p.document.ownerId === ownerId && ins.requiredRisks.every((r) => p.coveredRisks.includes(r)));
    const busy = await this.busyMap(order.workerId, db, order.id);
    return members.map((m) => {
      const blockers: MemberBlocker[] = [];
      if (!m.isActive) blockers.push('inactive');
      if (m.user.status !== 'ACTIVE' && m.user.status !== 'WARNED') blockers.push('blocked');
      if (profiles.find((p) => p.userId === m.userId)?.kycStatus !== 'VERIFIED') blockers.push('kyc');
      if (category.requiresLicense && !licenses.some((l) => l.document.ownerId === m.userId)) blockers.push('license');
      // полис участника или полис компании, которая отвечает за своих сотрудников
      if (ins.required && !covers(m.userId) && !(owner.type === 'COMPANY' && covers(order.workerId ?? ''))) blockers.push('insurance');
      const busyOn = busy.get(m.userId) ?? null;
      if (busyOn !== null) blockers.push('busy');
      return { memberId: m.id, userId: m.userId, name: this.pii.decrypt(m.user.firstNameEnc), role: m.role, eligible: blockers.length === 0, blockers, busyOrderNumber: busyOn };
    });
  }

  private async orderForOwner(user: AuthUser, orderId: string): Promise<Order> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.workerId !== user.id) throw new AppException('NOT_FOUND');
    return order;
  }

  /** Кандидаты в исполнители заказа (экран руководителя). */
  async candidates(user: AuthUser, orderId: string) {
    const order = await this.orderForOwner(user, orderId);
    const team = await this.prisma.team.findUnique({ where: { ownerId: user.id } });
    if (!team) return { items: [] };
    const members = await this.prisma.teamMember.findMany({
      where: { teamId: team.id, isActive: true },
      include: { user: { select: { firstNameEnc: true, status: true } } },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    });
    return { items: await this.check(order, members) };
  }

  /** Что видит руководитель о назначении по заказу. */
  async orderTeamInfo(order: Order) {
    if (!order.workerId) return null;
    const team = await this.prisma.team.findUnique({ where: { ownerId: order.workerId }, select: { id: true } });
    if (!team) return null;
    const rows = await this.prisma.orderAssignment.findMany({
      where: { orderId: order.id, state: { in: ['ACTIVE', 'PENDING_CONSENT'] } },
      include: { teamMember: { include: { user: { select: { firstNameEnc: true } } } } },
    });
    const card = (a: (typeof rows)[number] | undefined) =>
      a ? { assignmentId: a.id, memberId: a.teamMemberId, userId: a.teamMember.userId, name: this.pii.decrypt(a.teamMember.user.firstNameEnc), role: a.teamMember.role, automatic: a.automatic, since: a.createdAt } : null;
    const current = card(rows.find((r) => r.state === 'ACTIVE'));
    const ever = await this.prisma.orderAssignment.count({ where: { orderId: order.id, state: { in: ['ACTIVE', 'ENDED'] } } });
    const deadline = order.acceptedAt ? new Date(order.acceptedAt.getTime() + this.settings.get('TEAM_ASSIGN_TIMEOUT_MIN', { cityId: order.cityId, categoryId: order.categoryId }) * 60_000) : null;
    return {
      current,
      pending: card(rows.find((r) => r.state === 'PENDING_CONSENT')),
      needsAssignment: ever === 0 && order.status === 'ACCEPTED',
      assignDeadline: ever === 0 ? deadline : null,
      consentRequired: this.settings.get('PERFORMER_CHANGE_CONSENT', { cityId: order.cityId, categoryId: order.categoryId }),
    };
  }

  /** Замена исполнителя, ожидающая решения клиента (для экрана клиента). */
  async pendingChangeForClient(orderId: string) {
    const a = await this.prisma.orderAssignment.findFirst({
      where: { orderId, state: 'PENDING_CONSENT' },
      include: { teamMember: { include: { user: { select: { id: true, firstNameEnc: true, photoKey: true } } } } },
    });
    if (!a) return null;
    return { assignmentId: a.id, name: this.pii.decrypt(a.teamMember.user.firstNameEnc), photoKey: a.teamMember.user.photoKey, role: a.teamMember.role, reason: a.reason, requestedAt: a.createdAt };
  }

  /**
   * Назначить исполнителя. Первое назначение до выезда — сразу, клиент получает уведомление «кто приедет».
   * Дальше это замена: с согласием клиента, если включено PERFORMER_CHANGE_CONSENT, иначе сразу с уведомлением.
   */
  async assign(user: AuthUser, orderId: string, memberId: string, reason?: string) {
    const order = await this.orderForOwner(user, orderId);
    if (!(ACTIVE as string[]).includes(order.status)) throw new AppException('INVALID_STATUS_TRANSITION');
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, user.id);
      const fresh = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      if (!(ACTIVE as string[]).includes(fresh.status)) throw new AppException('INVALID_STATUS_TRANSITION');
      const member = await tx.teamMember.findFirst({
        where: { id: memberId, team: { ownerId: user.id } },
        include: { user: { select: { firstNameEnc: true, status: true } } },
      });
      if (!member) throw new AppException('NOT_FOUND');
      const [check] = await this.check(fresh, [member], tx);
      if (!check?.eligible) throw new AppException('TEAM_MEMBER_NOT_ELIGIBLE', { blockers: check?.blockers ?? [] });
      return this.applyAssignment(tx, fresh, member, { actorId: user.id, reason: reason ?? null, automatic: false });
    });
    await this.afterAssignment(order, result);
    return this.orderTeamInfo(await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } }));
  }

  private async applyAssignment(tx: Tx, order: Order, member: TeamMember, opts: { actorId: string | null; reason: string | null; automatic: boolean }) {
    const current = await tx.orderAssignment.findFirst({ where: { orderId: order.id, state: 'ACTIVE' } });
    const performerUserId = current ? (await tx.teamMember.findUniqueOrThrow({ where: { id: current.teamMemberId } })).userId : order.workerId;
    const ever = await tx.orderAssignment.count({ where: { orderId: order.id, state: { in: ['ACTIVE', 'ENDED'] } } });
    // первое назначение до выезда — без согласия клиента; дальше любая смена — замена
    const initial = ever === 0 && order.status === 'ACCEPTED';
    // без назначения исполнитель — сам руководитель
    if (current?.teamMemberId === member.id || (!current && !initial && member.userId === order.workerId)) {
      return { kind: 'same' as const, memberUserId: member.userId, previousUserId: performerUserId };
    }
    // прежняя замена, ждавшая клиента, отзывается новой
    const prevPending = await tx.orderAssignment.findFirst({ where: { orderId: order.id, state: 'PENDING_CONSENT' } });
    if (prevPending) {
      await tx.orderAssignment.update({ where: { id: prevPending.id }, data: { state: 'CANCELLED', endedAt: new Date() } });
      await tx.teamEvent.create({ data: { teamId: member.teamId, actorId: opts.actorId, memberId: prevPending.teamMemberId, orderId: order.id, type: 'change_cancelled' } });
    }
    const ctx = { cityId: order.cityId, categoryId: order.categoryId };
    if (!initial && this.settings.get('PERFORMER_CHANGE_CONSENT', ctx)) {
      const pending = await tx.orderAssignment.create({
        data: { orderId: order.id, teamMemberId: member.id, assignedById: opts.actorId ?? order.workerId ?? member.userId, isCurrent: false, state: 'PENDING_CONSENT', clientConsentRequired: true, reason: opts.reason },
      });
      await tx.teamEvent.create({ data: { teamId: member.teamId, actorId: opts.actorId, memberId: member.id, orderId: order.id, type: 'change_requested', payload: { reason: opts.reason } } });
      await tx.orderEvent.create({ data: { orderId: order.id, type: 'performer_change_requested', actorId: opts.actorId, payload: { assignmentId: pending.id } } });
      return { kind: 'pending' as const, memberUserId: member.userId, previousUserId: performerUserId };
    }
    if (current) await tx.orderAssignment.update({ where: { id: current.id }, data: { isCurrent: false, state: 'ENDED', endedAt: new Date() } });
    await tx.orderAssignment.create({
      data: { orderId: order.id, teamMemberId: member.id, assignedById: opts.actorId ?? order.workerId ?? member.userId, isCurrent: true, state: 'ACTIVE', automatic: opts.automatic, reason: opts.reason },
    });
    const type = opts.automatic ? 'auto_assigned' : initial ? 'assigned' : 'replaced';
    await tx.teamEvent.create({ data: { teamId: member.teamId, actorId: opts.actorId, memberId: member.id, orderId: order.id, type, payload: { reason: opts.reason } } });
    await tx.orderEvent.create({ data: { orderId: order.id, type: initial || opts.automatic ? 'performer_assigned' : 'performer_replaced', actorId: opts.actorId, payload: { memberId: member.id, automatic: opts.automatic } } });
    return { kind: initial || opts.automatic ? ('assigned' as const) : ('replaced' as const), memberUserId: member.userId, previousUserId: performerUserId };
  }

  private async afterAssignment(order: Order, r: { kind: 'same' | 'pending' | 'assigned' | 'replaced'; memberUserId: string; previousUserId: string | null }): Promise<void> {
    if (r.kind === 'same') return;
    const name = await this.firstName(r.memberUserId);
    const payload = { orderId: order.id, kind: r.kind, at: new Date().toISOString() };
    this.realtime.toUser(order.clientId, RT_EVENTS.orderAssignment, payload);
    if (order.workerId) this.realtime.toUser(order.workerId, RT_EVENTS.orderAssignment, payload);
    this.realtime.toUser(r.memberUserId, RT_EVENTS.orderAssignment, payload);
    if (r.kind === 'pending') {
      await this.notifications.notify(order.clientId, { key: 'push.performer_change_request', orderId: order.id, params: { name }, priority: 'high' });
      return;
    }
    await this.jobs.cancel(assignJobId(order));
    await this.notifications.notify(order.clientId, { key: r.kind === 'replaced' ? 'push.performer_changed' : 'push.performer_assigned', orderId: order.id, params: { name }, priority: 'high' });
    if (r.memberUserId !== order.workerId) await this.notifications.notify(r.memberUserId, { key: 'push.team_assigned', orderId: order.id, params: { number: order.number }, priority: 'high' });
    if (r.kind === 'replaced' && r.previousUserId && r.previousUserId !== r.memberUserId && r.previousUserId !== order.workerId) {
      await this.notifications.notify(r.previousUserId, { key: 'push.team_unassigned', orderId: order.id, params: { number: order.number } });
      this.realtime.toUser(r.previousUserId, RT_EVENTS.orderAssignment, payload);
    }
  }

  private async firstName(userId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { firstNameEnc: true } });
    return (u && this.pii.decrypt(u.firstNameEnc)) ?? 'Masterio Pro';
  }

  /** Руководитель отзывает замену, которую клиент ещё не подтвердил. */
  async cancelPending(user: AuthUser, orderId: string) {
    const order = await this.orderForOwner(user, orderId);
    const pending = await this.prisma.orderAssignment.findFirst({ where: { orderId, state: 'PENDING_CONSENT' }, include: { teamMember: true } });
    if (!pending) throw new AppException('NOT_FOUND');
    await this.prisma.$transaction([
      this.prisma.orderAssignment.update({ where: { id: pending.id }, data: { state: 'CANCELLED', endedAt: new Date() } }),
      this.prisma.teamEvent.create({ data: { teamId: pending.teamMember.teamId, actorId: user.id, memberId: pending.teamMemberId, orderId, type: 'change_cancelled' } }),
    ]);
    this.realtime.toUser(order.clientId, RT_EVENTS.orderAssignment, { orderId, kind: 'cancelled', at: new Date().toISOString() });
    return this.orderTeamInfo(order);
  }

  /** Клиент соглашается или отказывается от замены исполнителя (экран 19). */
  async decideChange(user: AuthUser, orderId: string, approve: boolean) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.clientId !== user.id) throw new AppException('NOT_FOUND');
    if (!(ACTIVE as string[]).includes(order.status)) throw new AppException('INVALID_STATUS_TRANSITION');
    const outcome = await this.prisma.$transaction(async (tx) => {
      if (order.workerId) await this.lock(tx, order.workerId);
      const pending = await tx.orderAssignment.findFirst({ where: { orderId, state: 'PENDING_CONSENT' }, include: { teamMember: true } });
      if (!pending) throw new AppException('NOT_FOUND');
      const current = await tx.orderAssignment.findFirst({ where: { orderId, state: 'ACTIVE' }, include: { teamMember: true } });
      const previousUserId = current ? current.teamMember.userId : order.workerId;
      if (!approve) {
        await tx.orderAssignment.update({ where: { id: pending.id }, data: { state: 'DECLINED', endedAt: new Date() } });
        await tx.teamEvent.create({ data: { teamId: pending.teamMember.teamId, actorId: user.id, memberId: pending.teamMemberId, orderId, type: 'change_declined' } });
        await tx.orderEvent.create({ data: { orderId, type: 'performer_change_declined', actorId: user.id, payload: { assignmentId: pending.id } } });
        return { approved: false, memberUserId: pending.teamMember.userId, previousUserId };
      }
      if (current) await tx.orderAssignment.update({ where: { id: current.id }, data: { isCurrent: false, state: 'ENDED', endedAt: new Date() } });
      await tx.orderAssignment.update({ where: { id: pending.id }, data: { isCurrent: true, state: 'ACTIVE', clientConsentAt: new Date() } });
      await tx.teamEvent.create({ data: { teamId: pending.teamMember.teamId, actorId: user.id, memberId: pending.teamMemberId, orderId, type: 'change_approved' } });
      await tx.orderEvent.create({ data: { orderId, type: 'performer_replaced', actorId: user.id, payload: { assignmentId: pending.id, clientConsent: true } } });
      return { approved: true, memberUserId: pending.teamMember.userId, previousUserId };
    });
    const payload = { orderId, kind: outcome.approved ? 'replaced' : 'declined', at: new Date().toISOString() };
    for (const uid of new Set([order.clientId, order.workerId, outcome.memberUserId, outcome.previousUserId].filter((x): x is string => Boolean(x)))) {
      this.realtime.toUser(uid, RT_EVENTS.orderAssignment, payload);
    }
    if (order.workerId) {
      await this.notifications.notify(order.workerId, { key: outcome.approved ? 'push.performer_change_approved' : 'push.performer_change_declined', orderId, params: { number: order.number } });
    }
    if (outcome.approved) {
      if (outcome.memberUserId !== order.workerId) await this.notifications.notify(outcome.memberUserId, { key: 'push.team_assigned', orderId, params: { number: order.number }, priority: 'high' });
      if (outcome.previousUserId && outcome.previousUserId !== order.workerId && outcome.previousUserId !== outcome.memberUserId) {
        await this.notifications.notify(outcome.previousUserId, { key: 'push.team_unassigned', orderId, params: { number: order.number } });
      }
    }
    return { approved: outcome.approved };
  }

  /** После принятия заказа командой: руководитель выбирает исполнителя, иначе через N минут исполнитель — он сам. */
  async afterAccept(order: Order): Promise<void> {
    if (!order.workerId) return;
    const members = await this.prisma.teamMember.count({ where: { team: { ownerId: order.workerId }, isActive: true, role: { not: 'LEADER' } } });
    if (members === 0) return;
    const minutes = this.settings.get('TEAM_ASSIGN_TIMEOUT_MIN', { cityId: order.cityId, categoryId: order.categoryId });
    await this.jobs.schedule('team-assign-timeout', { orderId: order.id, acceptedAt: String(order.acceptedAt?.getTime() ?? 0) }, { delayMs: minutes * 60_000, jobId: assignJobId(order) });
    await this.notifications.notify(order.workerId, { key: 'push.team_assign_needed', orderId: order.id, params: { number: order.number, minutes }, priority: 'high' });
  }

  /** Время на выбор исполнителя вышло: назначается руководитель, а если он занят — первый свободный подходящий участник. */
  async assignTimeout(orderId: string, acceptedAt?: string): Promise<void> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order?.workerId || order.status !== 'ACCEPTED') return;
    // заказ мог быть отменён мастером и принят заново — таймер прежнего принятия не действует
    if (acceptedAt && String(order.acceptedAt?.getTime() ?? 0) !== acceptedAt) return;
    const ownerId = order.workerId;
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, ownerId);
      const ever = await tx.orderAssignment.count({ where: { orderId, state: { in: ['ACTIVE', 'ENDED'] } } });
      if (ever > 0) return null;
      const members = await tx.teamMember.findMany({
        where: { team: { ownerId }, isActive: true },
        include: { user: { select: { firstNameEnc: true, status: true } } },
        orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
      });
      const checks = await this.check(order, members, tx);
      const leader = members.find((m) => m.role === 'LEADER');
      const leaderCheck = checks.find((c) => c.memberId === leader?.id);
      const pick = leaderCheck && !leaderCheck.blockers.includes('busy') ? leader : members.find((m) => checks.find((c) => c.memberId === m.id)?.eligible);
      const chosen = pick ?? leader;
      if (!chosen) return null;
      return this.applyAssignment(tx, order, chosen, { actorId: null, reason: 'timeout', automatic: true });
    });
    if (result) await this.afterAssignment(order, result);
  }

  /** Клиент сообщает, что пришёл не назначенный человек: событие и автоматический спор (раздел 19.2). */
  async performerMismatch(user: AuthUser, orderId: string, description?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.clientId !== user.id || !order.workerId) throw new AppException('NOT_FOUND');
    if (!['EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'].includes(order.status)) throw new AppException('INVALID_STATUS_TRANSITION');
    const current = await this.prisma.orderAssignment.findFirst({ where: { orderId, state: 'ACTIVE' }, include: { teamMember: { include: { user: { select: { firstNameEnc: true } } } } } });
    const expected = current ? { memberId: current.teamMemberId, name: this.pii.decrypt(current.teamMember.user.firstNameEnc), role: current.teamMember.role } : { memberId: null, name: await this.firstName(order.workerId), role: 'MASTER' };
    await this.prisma.orderEvent.create({ data: { orderId, type: 'performer_mismatch', actorId: user.id, payload: { expected, description: description ?? null } as Prisma.InputJsonValue } });
    const team = await this.prisma.team.findUnique({ where: { ownerId: order.workerId }, select: { id: true } });
    if (team) await this.prisma.teamEvent.create({ data: { teamId: team.id, actorId: user.id, memberId: expected.memberId, orderId, type: 'performer_mismatch' } });
    const dispute = await this.disputes.openInternal({
      order,
      reason: 'PERFORMER_MISMATCH',
      openedById: user.id,
      againstId: order.workerId,
      description: description?.trim() || `Performer mismatch: expected ${expected.name ?? '—'} (${expected.role})`,
      isAutomatic: true,
      freezeOrder: true,
      extraEvidence: [{ kind: 'performer_expected', content: expected as Prisma.InputJsonValue }],
    });
    await this.jobs.cancel(assignJobId(order));
    return dispute;
  }

  /** Для CRM: команда мастера с участниками, приглашениями и журналом. */
  async adminView(ownerId: string) {
    const team = await this.prisma.team.findUnique({ where: { ownerId } });
    const membership = await this.membership(ownerId);
    const memberOf = membership
      ? { teamId: membership.team.id, teamName: membership.team.name, ownerId: membership.team.ownerId, role: membership.role, joinedAt: membership.joinedAt }
      : null;
    if (!team) return { team: null, memberOf };
    const members = await this.prisma.teamMember.findMany({
      where: { teamId: team.id },
      include: { user: { select: { id: true, phone: true, firstNameEnc: true, status: true, worker: { select: { kycStatus: true } } } } },
      orderBy: [{ isActive: 'desc' }, { role: 'asc' }, { joinedAt: 'asc' }],
    });
    const invites = await this.prisma.teamInvite.findMany({ where: { teamId: team.id }, orderBy: { createdAt: 'desc' }, take: 50 });
    const events = await this.prisma.teamEvent.findMany({ where: { teamId: team.id }, orderBy: { createdAt: 'desc' }, take: 100 });
    return {
      memberOf,
      team: {
        id: team.id,
        name: team.name,
        createdAt: team.createdAt,
        capacity: await this.capacity(ownerId),
        members: members.map((m) => ({
          id: m.id,
          userId: m.userId,
          role: m.role,
          isActive: m.isActive,
          name: this.pii.decrypt(m.user.firstNameEnc),
          phone: m.user.phone,
          kycStatus: m.user.worker?.kycStatus ?? m.kycStatus,
          userStatus: m.user.status,
          joinedAt: m.joinedAt,
          leftAt: m.leftAt,
        })),
        invites: invites.map((i) => ({ id: i.id, phone: maskPhone(i.phone), role: i.role, status: i.status, createdAt: i.createdAt, expiresAt: i.expiresAt })),
        events: events.map((e) => ({ id: e.id, type: e.type, memberId: e.memberId, orderId: e.orderId, actorId: e.actorId, payload: e.payload, createdAt: e.createdAt })),
      },
    };
  }
}

/** Таймер выбора исполнителя привязан к конкретному принятию заказа. */
export function assignJobId(order: Pick<Order, 'id' | 'acceptedAt'>): string {
  return jobId('team-assign', order.id, String(order.acceptedAt?.getTime() ?? 0));
}

/** Номер в журнале: последние 4 цифры (полный номер виден только руководителю в списке приглашений). */
export function maskPhone(phone: string): string {
  return phone.length > 4 ? `${'•'.repeat(Math.max(0, phone.length - 4))}${phone.slice(-4)}` : phone;
}
