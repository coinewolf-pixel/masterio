import {
  createApiClient,
  type AdminCreateInput,
  type AdminDisputeAction,
  type AdminUpdateInput,
  type BonusRuleInput,
  type InsuranceRuleInput,
  type CategoryGroupInput,
  type CategoryInput,
  type CityInput,
  type TokenPair,
  type TokenStore,
} from '@masterio/shared';
import { currentLanguage } from '../i18n';
import type {
  AdminTeamView,
  BonusRule,
  BonusRunCard,
  BonusRunRow,
  DataRequestRow,
  DisputeCard,
  DisputeList,
  IncidentCard,
  IncidentRow,
  InsuranceRule,
  LegalDocRow,
  LegalVersionCard,
  TicketCard,
  TicketRow,
  AdminMe,
  AdminRow,
  AuditRow,
  Catalog,
  ClientCard,
  ClientRow,
  Dashboard,
  FinanceSummary,
  FraudFlag,
  Grant,
  LedgerTx,
  MapSnapshot,
  OrderCard,
  OrderRow,
  Page,
  Pockets,
  QueueDocument,
  SettingHistoryRow,
  SettingsList,
  TotpSetup,
  VerificationStatus,
  WorkerCard,
  WorkerRow,
} from './types';

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1';
/** Socket.IO живёт на том же хосте без префикса /api/v1 */
export const SOCKET_URL = API_URL.replace(/\/api\/v1\/?$/, '');

const KEY = 'masterio.crm.session';

/**
 * Токены CRM живут в sessionStorage: вкладка закрыта — сессия закончена, другие вкладки и сайты её не видят.
 * Access-токен действует 15 минут, refresh одноразовый (повтор старого закрывает сессию на сервере).
 */
export const sessionTokens: TokenStore = {
  async get() {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<TokenPair>;
      return parsed.accessToken && parsed.refreshToken ? { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken } : null;
    } catch {
      return null;
    }
  },
  async set(t: TokenPair) {
    sessionStorage.setItem(KEY, JSON.stringify(t));
  },
  async clear() {
    sessionStorage.removeItem(KEY);
  },
};

const expiredListeners = new Set<() => void>();
export function onSessionExpired(listener: () => void): () => void {
  expiredListeners.add(listener);
  return () => expiredListeners.delete(listener);
}

export const client = createApiClient({
  baseUrl: API_URL,
  tokens: sessionTokens,
  locale: currentLanguage,
  onSessionExpired: () => expiredListeners.forEach((l) => l()),
});

const r = client.request;
type Query = Record<string, string | number | undefined>;

export const api = {
  login: (email: string, password: string, totp: string) => r<TokenPair>('POST', '/auth/admin/login', { email, password, totp }, { auth: false }),
  logout: (refreshToken: string) => r<void>('POST', '/auth/logout', { refreshToken }, { auth: false }),
  me: () => r<AdminMe>('GET', '/admin/me'),
  dashboard: (tz: string) => r<Dashboard>('GET', '/admin/dashboard', undefined, { query: { tz } }),
  map: () => r<MapSnapshot>('GET', '/admin/map/snapshot'),

  orders: (q: Query) => r<Page<OrderRow>>('GET', '/admin/orders', undefined, { query: q }),
  order: (id: string) => r<OrderCard>('GET', `/admin/orders/${id}`),
  cancelOrder: (id: string, reason: string) => r<{ status: string }>('POST', `/admin/orders/${id}/cancel`, { reason }),

  documents: (status: VerificationStatus) => r<QueueDocument[]>('GET', '/admin/documents', undefined, { query: { status } }),
  documentUrl: (id: string) => r<{ url: string; expiresIn: number }>('GET', `/documents/${id}/view-url`),
  reviewDocument: (id: string, decision: 'approve' | 'reject', reason?: string) => r<unknown>('POST', `/admin/documents/${id}/review`, { decision, reason }),

  workers: (q: Query) => r<Page<WorkerRow>>('GET', '/admin/workers', undefined, { query: q }),
  worker: (id: string) => r<WorkerCard>('GET', `/admin/workers/${id}`),
  workerWallet: (id: string) => r<Pockets>('GET', `/admin/workers/${id}/wallet`),
  workerTeam: (id: string) => r<AdminTeamView>('GET', `/admin/workers/${id}/team`),
  setKyc: (id: string, status: VerificationStatus, reason?: string) => r<unknown>('POST', `/admin/workers/${id}/kyc`, { status, reason }),
  clients: (q: Query) => r<Page<ClientRow>>('GET', '/admin/clients', undefined, { query: q }),
  client: (id: string) => r<ClientCard>('GET', `/admin/clients/${id}`),
  block: (id: string, reason: string) => r<unknown>('POST', `/admin/users/${id}/block`, { reason }),
  unblock: (id: string, reason: string) => r<unknown>('POST', `/admin/users/${id}/unblock`, { reason }),

  grants: (q: Query) => r<Grant[]>('GET', '/admin/grants', undefined, { query: q }),
  createGrant: (body: { workerId: string; reason: string; amountCents?: number; presetIndex?: number; expiresInDays?: number }) => r<Grant>('POST', '/admin/grants', body),
  approveGrant: (id: string) => r<Grant>('POST', `/admin/grants/${id}/approve`),
  rejectGrant: (id: string) => r<Grant>('POST', `/admin/grants/${id}/reject`),

  finance: (from: string, to: string) => r<FinanceSummary>('GET', '/admin/finance/summary', undefined, { query: { from, to } }),
  transactions: (q: Query) => r<Page<LedgerTx>>('GET', '/admin/finance/transactions', undefined, { query: q }),
  exportCsv: (from: string, to: string) => r<string>('GET', '/admin/finance/export.csv', undefined, { query: { from, to }, text: true }),
  integrity: () => r<{ totalCents: number; mismatchedAccounts: number }>('GET', '/admin/finance/ledger-integrity'),

  fraudFlags: (resolved: boolean) => r<FraudFlag[]>('GET', '/admin/fraud-flags', undefined, { query: { resolved: String(resolved) } }),
  resolveFlag: (id: string, note: string) => r<unknown>('POST', `/admin/fraud-flags/${id}/resolve`, { note }),

  settings: () => r<SettingsList>('GET', '/admin/settings'),
  settingHistory: (key: string) => r<SettingHistoryRow[]>('GET', `/admin/settings/${key}/history`),
  setSetting: (key: string, body: { value: unknown; scope: string; scopeRef: string; comment?: string }) => r<unknown>('PUT', `/admin/settings/${key}`, body),
  resetSetting: (key: string, body: { scope: string; scopeRef: string; comment?: string }) => r<unknown>('POST', `/admin/settings/${key}/reset`, body),

  catalog: () => r<Catalog>('GET', '/admin/catalog'),
  createGroup: (body: CategoryGroupInput) => r<unknown>('POST', '/admin/catalog/groups', body),
  updateGroup: (id: string, body: CategoryGroupInput) => r<unknown>('PUT', `/admin/catalog/groups/${id}`, body),
  createCategory: (body: CategoryInput) => r<unknown>('POST', '/admin/catalog/categories', body),
  updateCategory: (id: string, body: CategoryInput) => r<unknown>('PUT', `/admin/catalog/categories/${id}`, body),
  createCity: (body: CityInput) => r<unknown>('POST', '/admin/catalog/cities', body),
  updateCity: (id: string, body: CityInput) => r<unknown>('PUT', `/admin/catalog/cities/${id}`, body),
  setCityCategories: (id: string, categoryIds: string[]) => r<unknown>('PUT', `/admin/catalog/cities/${id}/categories`, { categoryIds }),

  admins: () => r<AdminRow[]>('GET', '/admin/admins'),
  createAdmin: (body: AdminCreateInput) => r<TotpSetup>('POST', '/admin/admins', body),
  updateAdmin: (id: string, body: AdminUpdateInput) => r<unknown>('PATCH', `/admin/admins/${id}`, body),
  resetTotp: (id: string) => r<TotpSetup>('POST', `/admin/admins/${id}/reset-totp`),
  audit: (q: Query) => r<Page<AuditRow>>('GET', '/admin/audit-log', undefined, { query: q }),

  disputes: (q: Query) => r<DisputeList>('GET', '/admin/disputes', undefined, { query: q }),
  dispute: (id: string) => r<DisputeCard>('GET', `/admin/disputes/${id}`),
  disputeAction: (id: string, body: AdminDisputeAction) => r<DisputeCard>('POST', `/admin/disputes/${id}/actions`, body),

  tickets: (q: Query) => r<Page<TicketRow>>('GET', '/admin/tickets', undefined, { query: q }),
  ticket: (id: string) => r<TicketCard>('GET', `/admin/tickets/${id}`),
  ticketPost: (id: string, body: string, internal: boolean) => r<TicketCard>('POST', `/admin/tickets/${id}/messages`, { body, internal }),
  ticketUpdate: (id: string, patch: { status?: string; assigneeId?: string | null }) => r<TicketCard>('PATCH', `/admin/tickets/${id}`, patch),
  incidents: (q: Query) => r<Page<IncidentRow>>('GET', '/admin/incidents', undefined, { query: q }),
  incident: (id: string) => r<IncidentCard>('GET', `/admin/incidents/${id}`),

  legal: () => r<LegalDocRow[]>('GET', '/admin/legal'),
  legalVersion: (id: string) => r<LegalVersionCard>('GET', `/admin/legal/versions/${id}`),
  createLegalVersion: (body: { audience: string; countryCode: string; version: string; bodies: Record<string, string>; legalReviewedBy: string }) =>
    r<{ documentId: string; version: string }>('POST', '/admin/legal/versions', body),
  publishLegal: (documentId: string, version: string) => r<unknown>('POST', `/admin/legal/${documentId}/versions/${encodeURIComponent(version)}/publish`),
  deleteLegalDraft: (documentId: string, version: string) => r<unknown>('DELETE', `/admin/legal/${documentId}/versions/${encodeURIComponent(version)}`),

  insuranceRules: () => r<InsuranceRule[]>('GET', '/admin/insurance-rules'),
  saveInsuranceRule: (body: InsuranceRuleInput, id?: string) => (id ? r<InsuranceRule>('PUT', `/admin/insurance-rules/${id}`, body) : r<InsuranceRule>('POST', '/admin/insurance-rules', body)),
  deleteInsuranceRule: (id: string) => r<unknown>('DELETE', `/admin/insurance-rules/${id}`),

  bonusRules: () => r<BonusRule[]>('GET', '/admin/bonus-rules'),
  saveBonusRule: (body: BonusRuleInput, id?: string) => (id ? r<BonusRule>('PUT', `/admin/bonus-rules/${id}`, body) : r<BonusRule>('POST', '/admin/bonus-rules', body)),
  bonusRuns: () => r<BonusRunRow[]>('GET', '/admin/bonus-runs'),
  bonusRun: (id: string) => r<BonusRunCard>('GET', `/admin/bonus-runs/${id}`),
  calculateBonus: (period: string) => r<BonusRunCard>('POST', '/admin/bonus-runs', { period }),
  approveBonus: (id: string) => r<BonusRunCard>('POST', `/admin/bonus-runs/${id}/approve`),
  cancelBonus: (id: string) => r<BonusRunCard>('POST', `/admin/bonus-runs/${id}/cancel`),

  dataRequests: () => r<DataRequestRow[]>('GET', '/admin/data-requests', undefined, { query: { limit: 100 } }),
};
