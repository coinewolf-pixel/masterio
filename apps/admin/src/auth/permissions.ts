import type { AdminSubRoleName } from '@masterio/shared';

/** Разделы CRM и подроли, которым они открыты. SUPERADMIN видит всё. Сервер проверяет права независимо от этого списка. */
export const SECTIONS = {
  dashboard: ['SUPPORT', 'MODERATOR', 'FINANCE'],
  map: ['SUPPORT', 'MODERATOR', 'FINANCE'],
  orders: ['SUPPORT', 'MODERATOR', 'FINANCE'],
  documents: ['SUPPORT', 'MODERATOR'],
  workers: ['SUPPORT', 'MODERATOR', 'FINANCE'],
  clients: ['SUPPORT', 'MODERATOR', 'FINANCE'],
  grants: ['FINANCE'],
  finance: ['FINANCE'],
  fraud: ['MODERATOR'],
  disputes: ['SUPPORT', 'MODERATOR', 'FINANCE'],
  support: ['SUPPORT', 'MODERATOR'],
  incidents: ['SUPPORT', 'MODERATOR'],
  legal: ['SUPPORT', 'MODERATOR', 'FINANCE'],
  insurance: ['SUPPORT', 'MODERATOR', 'FINANCE'],
  bonuses: ['FINANCE'],
  privacy: ['SUPPORT'],
  settings: ['SUPPORT', 'MODERATOR', 'FINANCE'],
  catalog: ['SUPPORT', 'MODERATOR', 'FINANCE'],
  admins: [],
  audit: [],
} as const satisfies Record<string, readonly AdminSubRoleName[]>;

export type Section = keyof typeof SECTIONS;

/** Действия внутри разделов. */
export const ACTIONS = {
  cancelOrder: ['SUPPORT'],
  reviewDocuments: ['MODERATOR'],
  blockUsers: ['MODERATOR'],
  setKyc: ['MODERATOR'],
  viewWallet: ['FINANCE'],
  createGrant: ['FINANCE'],
  approveGrant: [],
  resolveFlags: ['MODERATOR'],
  editFinanceSettings: ['FINANCE'],
  editSettings: [],
  editCatalog: [],
  actOnDisputes: ['SUPPORT', 'MODERATOR'],
  refundCommission: ['FINANCE'],
  editLegal: [],
  editInsurance: [],
  manageBonuses: ['FINANCE'],
} as const satisfies Record<string, readonly AdminSubRoleName[]>;

export type Action = keyof typeof ACTIONS;

export function allowed(roles: readonly AdminSubRoleName[], required: readonly AdminSubRoleName[]): boolean {
  return roles.includes('SUPERADMIN') || required.some((r) => roles.includes(r));
}
