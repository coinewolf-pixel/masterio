import type { MemberBlocker, TeamInviteRole } from '@masterio/shared';
import { client } from '../api';
import type { OrderTeamInfo, TeamRole } from '../api/types';

export interface TeamMemberRow {
  id: string;
  userId: string;
  role: TeamRole;
  name: string | null;
  phone: string | null;
  kycStatus: 'NOT_VERIFIED' | 'VERIFIED' | 'EXPIRED' | 'REJECTED';
  blocked: boolean;
  licenses: number;
  insured: boolean;
  busyOrderNumber: number | null;
  joinedAt: string;
}

export interface TeamInviteRow {
  id: string;
  phone: string;
  role: TeamInviteRole;
  expiresAt: string;
  createdAt: string;
}

export type MyTeam =
  | { mode: 'none'; teamsEnabled: boolean }
  | { mode: 'member'; team: { id: string; name: string }; leaderName: string | null; role: TeamRole; memberId: string; joinedAt: string }
  | {
      mode: 'owner';
      teamsEnabled: boolean;
      team: { id: string; name: string; createdAt: string };
      capacity: number;
      limit: number;
      members: TeamMemberRow[];
      invites: TeamInviteRow[];
    };

export interface IncomingInvite {
  id: string;
  role: TeamInviteRole;
  expiresAt: string;
  team: { name: string; leaderName: string | null; company: boolean };
}

export interface TeamEventRow {
  id: string;
  type: string;
  createdAt: string;
  memberName: string | null;
  memberRole: TeamRole | null;
  actor: string | null;
  orderId: string | null;
  orderNumber: number | null;
}

export interface Candidate {
  memberId: string;
  userId: string;
  name: string | null;
  role: TeamRole;
  eligible: boolean;
  blockers: MemberBlocker[];
  busyOrderNumber: number | null;
}

const r = client.request;

/** «Моя команда» и назначение исполнителя (разделы 18.2, 19.2). */
export const teamApi = {
  mine: () => r<MyTeam>('GET', '/team'),
  create: (name: string) => r<MyTeam>('POST', '/team', { name }),
  rename: (name: string) => r<MyTeam>('PATCH', '/team', { name }),
  events: (before?: string) => r<TeamEventRow[]>('GET', `/team/events${before ? `?before=${encodeURIComponent(before)}` : ''}`),
  invite: (phone: string, role: TeamInviteRole) => r<{ id: string; accountExists: boolean }>('POST', '/team/invites', { phone, role }),
  revoke: (id: string) => r<void>('DELETE', `/team/invites/${id}`),
  incoming: () => r<IncomingInvite[]>('GET', '/team/invites/mine'),
  accept: (id: string) => r<{ memberId: string; teamId: string }>('POST', `/team/invites/${id}/accept`),
  decline: (id: string) => r<void>('POST', `/team/invites/${id}/decline`),
  remove: (memberId: string) => r<void>('DELETE', `/team/members/${memberId}`),
  leave: () => r<void>('POST', '/team/leave'),
  candidates: (orderId: string) => r<{ items: Candidate[] }>('GET', `/orders/${orderId}/performers`),
  assign: (orderId: string, teamMemberId: string, reason?: string) =>
    r<OrderTeamInfo>('POST', `/orders/${orderId}/assign`, { teamMemberId, ...(reason ? { reason } : {}) }),
  cancelPending: (orderId: string) => r<OrderTeamInfo>('DELETE', `/orders/${orderId}/assign/pending`),
};
