import { z } from 'zod';
import { phoneSchema } from './schemas';

/** Фаза 7: команды и помощники (разделы 18.2, 19.2). */

/** Роли, которые руководитель может дать участнику (руководитель — владелец аккаунта команды). */
export const TEAM_INVITE_ROLES = ['MASTER', 'HELPER', 'EMPLOYEE'] as const;
export type TeamInviteRole = (typeof TEAM_INVITE_ROLES)[number];
export const TEAM_MEMBER_ROLES = ['LEADER', ...TEAM_INVITE_ROLES] as const;
export const TEAM_INVITE_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED'] as const;
export const ASSIGNMENT_STATES = ['ACTIVE', 'PENDING_CONSENT', 'ENDED', 'DECLINED', 'CANCELLED'] as const;
export const TEAM_EVENT_TYPES = [
  'created',
  'renamed',
  'invited',
  'invite_revoked',
  'joined',
  'declined',
  'removed',
  'left',
  'assigned',
  'auto_assigned',
  'replaced',
  'change_requested',
  'change_approved',
  'change_declined',
  'change_cancelled',
  'performer_mismatch',
] as const;

/** Почему участника нельзя назначить на заказ. */
export const MEMBER_BLOCKERS = ['inactive', 'kyc', 'blocked', 'license', 'insurance', 'busy'] as const;
export type MemberBlocker = (typeof MEMBER_BLOCKERS)[number];

export const teamNameSchema = z.object({ name: z.string().trim().min(2).max(80) });
export const teamInviteSchema = z.object({ phone: phoneSchema, role: z.enum(TEAM_INVITE_ROLES) });
export const assignPerformerSchema = z.object({
  teamMemberId: z.uuid(),
  reason: z.string().trim().max(500).optional(),
});
export const performerChangeDecisionSchema = z.object({ approve: z.boolean() });
export const performerMismatchSchema = z.object({ description: z.string().trim().max(2_000).optional() });
