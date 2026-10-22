/** Ответы API, которые использует CRM. Деньги — в центах. */
import type { AdminSubRoleName, LocalizedNames } from '@masterio/shared';

export type OrderStatus =
  | 'DRAFT'
  | 'SEARCHING'
  | 'NO_WORKERS'
  | 'ACCEPTED'
  | 'EN_ROUTE'
  | 'ARRIVED'
  | 'IN_PROGRESS'
  | 'COMPLETED_BY_WORKER'
  | 'CONFIRMED'
  | 'AUTO_CONFIRMED'
  | 'CANCELLED_BY_CLIENT'
  | 'CANCELLED_BY_WORKER'
  | 'CANCELLED_BY_ADMIN'
  | 'DISPUTED'
  | 'CLOSED';

export const ORDER_STATUSES: OrderStatus[] = [
  'SEARCHING',
  'NO_WORKERS',
  'ACCEPTED',
  'EN_ROUTE',
  'ARRIVED',
  'IN_PROGRESS',
  'COMPLETED_BY_WORKER',
  'CONFIRMED',
  'AUTO_CONFIRMED',
  'DISPUTED',
  'CANCELLED_BY_CLIENT',
  'CANCELLED_BY_WORKER',
  'CANCELLED_BY_ADMIN',
  'CLOSED',
  'DRAFT',
];

export type UserStatus = 'ACTIVE' | 'WARNED' | 'PREPAY_REQUIRED' | 'SUSPENDED' | 'BLOCKED' | 'DELETED';
export type VerificationStatus = 'NOT_VERIFIED' | 'VERIFIED' | 'REJECTED' | 'EXPIRED';
export type Names = Partial<LocalizedNames> & Record<string, string>;
export type LatLng = { lat: number; lng: number };

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
}

export interface AdminMe {
  id: string;
  email: string | null;
  subRoles: AdminSubRoleName[];
  countryCode: string;
  dailyGrantLimitCents: number;
}

export interface CityPulse {
  cityId: string;
  names: Names;
  online: number;
  active: number;
  searching: number;
  noWorkers: number;
  minimum: number;
  lowWorkers: boolean;
}

export interface Dashboard {
  since: string;
  today: { created: number; completed: number; cancelled: number; byStatus: Partial<Record<OrderStatus, number>> };
  now: { searching: number; noWorkers: number; performing: number; awaitingConfirmation: number; disputed: number; onlineWorkers: number };
  cities: CityPulse[];
  queues: { documents: number; grants: number; fraudFlags: number; disputes: number; tickets: number; incidents: number };
  commissionToday: Array<{ currency: string; cents: number }> | null;
}

export interface MapWorker {
  userId: string;
  name: string | null;
  lat: number;
  lng: number;
  lastLocationAt: string;
  busy: boolean;
}

export interface MapOrder {
  id: string;
  number: number;
  status: OrderStatus;
  categoryId: string;
  cityId: string;
  addressFormatted: string;
  workerId: string | null;
  location: LatLng;
  performer: { lat: number; lng: number; at: string | null } | null;
}

export interface MapSnapshot {
  staleSeconds: number;
  workers: MapWorker[];
  orders: MapOrder[];
}

export interface PartyRef {
  id: string;
  name: string | null;
  phone: string | null;
  status?: UserStatus;
}

export interface OrderRow {
  id: string;
  number: number;
  status: OrderStatus;
  cityId: string;
  categoryId: string;
  paymentMethod: 'CASH' | 'CARD';
  currency: string;
  confirmedAmountCents: number | null;
  commissionCents: number | null;
  addressFormatted: string;
  createdAt: string;
  client: PartyRef;
  worker: PartyRef | null;
}

export interface LedgerTx {
  id: string;
  kind: string;
  createdAt: string;
  memo: string | null;
  orderId?: string | null;
  grantId?: string | null;
  paymentId?: string | null;
  actorId?: string | null;
  entries: Array<{ account: string; ownerId: string | null; currency: string; amountCents: number }>;
}

export interface OrderCard {
  id: string;
  number: number;
  status: OrderStatus;
  cityId: string;
  categoryId: string;
  description: string;
  addressFormatted: string;
  addressDetails: string | null;
  paymentMethod: 'CASH' | 'CARD';
  currency: string;
  timing: 'ASAP' | 'SCHEDULED';
  scheduledAt: string | null;
  searchRadiusM: number;
  dispatchRound: number;
  confirmedAmountCents: number | null;
  cashReportedByWorkerCents: number | null;
  cashReportedByClientCents: number | null;
  commissionCents: number | null;
  bonusDiscountCents: number | null;
  clientUnconfirmed: boolean;
  createdAt: string;
  acceptedAt: string | null;
  enRouteAt: string | null;
  arrivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  location: LatLng | null;
  client: PartyRef;
  worker: PartyRef | null;
  events: Array<{ id: string; type: string; actorId: string | null; payload: unknown; createdAt: string }>;
  offers: Array<{ id: string; workerId: string; workerName: string | null; round: number; position: number; score: number; distanceM: number; status: string; sentAt: string; expiresAt: string; respondedAt: string | null }>;
  estimates: Array<{ id: string; version: number; status: string; totalCents: number; note: string | null; createdAt: string; items: Array<{ id: string; type: string; title: string; quantity: number; unitCents: number; totalCents: number }> }>;
  assignments: Array<{
    id: string;
    teamMemberId: string;
    isCurrent: boolean;
    state: AssignmentState;
    automatic: boolean;
    reason: string | null;
    clientConsentRequired: boolean;
    clientConsentAt: string | null;
    createdAt: string;
    endedAt: string | null;
    memberRole: TeamRole;
    memberUserId: string;
    memberName: string | null;
  }>;
  cancellation: { actor: string; reasonCode: string; comment: string | null; statusAtCancel: string; penaltyCents: number; compensationCents: number; createdAt: string } | null;
  disputes: Array<{ id: string; reason: string; status: string; isAutomatic: boolean; createdAt: string }>;
  messages: Array<{ id: string; senderId: string; body: string; filtered: boolean; filterHits: string[]; createdAt: string }>;
  reviews: Array<{ id: string; authorId: string; targetId: string; rating: number; text: string | null; createdAt: string }>;
  photos: Array<{ id: string; purpose: string; url: string; createdAt: string }>;
  track: Array<{ lat: number; lng: number; recordedAt: string; accuracyM: number | null; userId: string }>;
  ledger: LedgerTx[];
}

export interface WorkerRow {
  id: string;
  name: string | null;
  phone: string | null;
  countryCode: string;
  status: UserStatus;
  type: 'INDEPENDENT' | 'COMPANY';
  companyName: string | null;
  kycStatus: VerificationStatus;
  isOnline: boolean;
  ratingAvg: number;
  ratingCount: number;
  acceptRate: number;
  cancelRate: number;
  cityIds: string[];
  categoryIds: string[];
  createdAt: string;
}

export interface Grant {
  id: string;
  workerId: string;
  amountCents: number;
  reason: string;
  expiresAt: string;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
  createdById: string;
  approvedById: string | null;
  isAutoWelcome: boolean;
  createdAt: string;
  decidedAt: string | null;
  workerLabel?: string;
  currency?: string | null;
  createdByLabel?: string;
  approvedByLabel?: string | null;
}

export interface FraudFlag {
  id: string;
  type: string;
  userId: string | null;
  orderId: string | null;
  pairUserId: string | null;
  score: number;
  details: unknown;
  resolvedAt: string | null;
  resolvedById: string | null;
  createdAt: string;
  user: { id: string; role: string; phone: string | null; name: string | null } | null;
  pairUser: { id: string; role: string; phone: string | null; name: string | null } | null;
}

export interface DocumentRow {
  id: string;
  kind: string;
  status: VerificationStatus;
  rejectReason: string | null;
  validUntil: string | null;
  createdAt: string;
  reviewedAt?: string | null;
  license: { categoryId: string; number: string | null } | null;
  insurance: { insurerName: string; policyNumber: string; validUntil: string } | null;
}

export interface QueueDocument extends DocumentRow {
  ownerId: string;
  owner: { id: string; phone: string | null; countryCode: string; name: string | null };
  /** документ участника чужой команды */
  team: { name: string; ownerId: string; role: TeamRole; isActive: boolean } | null;
}

export type TeamRole = 'LEADER' | 'MASTER' | 'HELPER' | 'EMPLOYEE';
export type AssignmentState = 'ACTIVE' | 'PENDING_CONSENT' | 'ENDED' | 'DECLINED' | 'CANCELLED';

export interface AdminTeamView {
  memberOf: { teamId: string; teamName: string; ownerId: string; role: TeamRole; joinedAt: string } | null;
  team: {
    id: string;
    name: string;
    createdAt: string;
    capacity: number;
    members: Array<{
      id: string;
      userId: string;
      role: TeamRole;
      isActive: boolean;
      name: string | null;
      phone: string | null;
      kycStatus: VerificationStatus;
      userStatus: UserStatus;
      joinedAt: string;
      leftAt: string | null;
    }>;
    invites: Array<{ id: string; phone: string; role: TeamRole; status: string; createdAt: string; expiresAt: string }>;
    events: Array<{ id: string; type: string; memberId: string | null; orderId: string | null; actorId: string | null; payload: unknown; createdAt: string }>;
  } | null;
}

export interface WorkerCard {
  id: string;
  name: string | null;
  phone: string | null;
  countryCode: string;
  locale: string;
  status: UserStatus;
  createdAt: string;
  type: 'INDEPENDENT' | 'COMPANY';
  companyName: string | null;
  companyRegNumber: string | null;
  kycStatus: VerificationStatus;
  isOnline: boolean;
  lastLocationAt: string | null;
  preferredRadiusM: number | null;
  ratingAvg: number;
  ratingCount: number;
  acceptRate: number;
  cancelRate: number;
  cancelCount30d: number;
  cityIds: string[];
  categoryIds: string[];
  stats: { total: number; completed: number; active: number; disputed: number; workerCancels: number; disputes: number };
  eligibility: { eligible: boolean; reasons: string[]; accessBalanceCents: number; thresholdCents: number; debtCents: number; debtLimitCents: number; currency: string; activeOrderId: string | null };
  documents: DocumentRow[];
  recentOrders: Array<{ id: string; number: number; status: OrderStatus; createdAt: string; confirmedAmountCents: number | null; commissionCents: number | null; currency: string; categoryId: string }>;
  grants: Grant[];
  flags: Array<Omit<FraudFlag, 'user' | 'pairUser'>>;
}

export interface Pockets {
  currency: string;
  topupCents: number;
  promoCents: number;
  bonusCents: number;
  earningsCents: number;
  pendingCents: number;
  debtCents: number;
}

export interface ClientRow {
  id: string;
  name: string | null;
  phone: string | null;
  countryCode: string;
  status: UserStatus;
  completedOrders: number;
  cancelCount30d: number;
  createdAt: string;
}

export interface ClientCard {
  id: string;
  name: string | null;
  phone: string | null;
  countryCode: string;
  locale: string;
  status: UserStatus;
  createdAt: string;
  completedOrders: number;
  cancelCount30d: number;
  stats: { total: number; completed: number; cancelledByClient: number; disputed: number };
  orders: Array<{
    id: string;
    number: number;
    status: OrderStatus;
    createdAt: string;
    confirmedAmountCents: number | null;
    currency: string;
    categoryId: string;
    workerId: string | null;
    cancellation: { reasonCode: string; penaltyCents: number; actor: string } | null;
  }>;
  disputes: Array<{ id: string; orderId: string; reason: string; status: string; createdAt: string }>;
  flags: Array<Omit<FraudFlag, 'user' | 'pairUser'>>;
  blacklist: Array<{ workerId: string; createdAt: string }>;
}

export interface FinanceCurrency {
  currency: string;
  ordersCompleted: number;
  turnoverCents: number;
  commissionCents: number;
  commissionFromBonusCents: number;
  commissionFromPromoCents: number;
  commissionFromTopupCents: number;
  commissionFromEarningsCents: number;
  commissionToDebtCents: number;
  topupsCents: number;
  topupsCount: number;
  chargebacksCents: number;
  promoGrantedCents: number;
  promoExpiredCents: number;
  bonusAccruedCents: number;
  bonusExpiredCents: number;
  liabilities: { topupCents: number; promoCents: number; bonusCents: number; earningsCents: number; debtCents: number };
}

export interface FinanceSummary {
  from: string;
  to: string;
  currencies: FinanceCurrency[];
}

export interface SettingsList {
  effective: Record<string, unknown>;
  overrides: Array<{ key: string; scope: string; scopeRef: string; value: unknown }>;
}

export interface SettingHistoryRow {
  id: string;
  oldValue: unknown;
  newValue: unknown;
  changedById: string;
  comment: string | null;
  createdAt: string;
  setting: { key: string; scope: string; scopeRef: string };
}

export interface CategoryGroup {
  id: string;
  code: string;
  names: Names;
  sortOrder: number;
  categories: Category[];
}

export interface Category {
  id: string;
  code: string;
  groupId: string;
  names: Names;
  icon: string | null;
  isUrgent: boolean;
  requiresLicense: boolean;
  requiresInsurance: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface City {
  id: string;
  countryCode: string;
  names: Names;
  timezone: string;
  currency: string;
  emergencyNumber: string;
  isActive: boolean;
  center: LatLng | null;
  categoryIds: string[];
}

export interface Catalog {
  groups: CategoryGroup[];
  cities: City[];
}

export interface AdminRow {
  id: string;
  email: string | null;
  subRoles: AdminSubRoleName[];
  dailyGrantLimitCents: number;
  status: UserStatus;
  createdAt: string;
}

export interface TotpSetup {
  id: string;
  email?: string;
  totpSecret: string;
  totpUri: string;
}

export interface AuditRow {
  id: string;
  adminId: string;
  adminEmail: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
}

// ── Фаза 6: споры, поддержка, инциденты, юридические документы, страховки, бонусы, приватность ──

export type DisputeStatus = 'OPEN' | 'AWAITING_RESPONSE' | 'UNDER_REVIEW' | 'ESCALATED' | 'SETTLED' | 'UNRESOLVED_REFERRED' | 'CLOSED';

export interface DisputeRow {
  id: string;
  orderId: string;
  orderNumber: number;
  cityId: string;
  categoryId: string;
  reason: string;
  status: DisputeStatus;
  isAutomatic: boolean;
  isSuspicious: boolean;
  assigneeId: string | null;
  responseDueAt: string | null;
  createdAt: string;
  overdue: boolean;
}

export interface DisputeList {
  items: DisputeRow[];
  nextCursor: string | null;
  counts: Partial<Record<DisputeStatus, number>>;
}

export interface DisputeCard {
  id: string;
  reason: string;
  status: DisputeStatus;
  description: string;
  isAutomatic: boolean;
  isSuspicious: boolean;
  openedById: string;
  againstId: string | null;
  assigneeId: string | null;
  responseDueAt: string | null;
  createdAt: string;
  closedAt: string | null;
  outcome: { resolution?: string; summary?: string; agreedAmountCents?: number | null; commissionRefundCents?: number } | null;
  ticket: { id: string; status: string } | null;
  order: {
    id: string;
    number: number;
    status: OrderStatus;
    clientId: string;
    workerId: string | null;
    currency: string;
    confirmedAmountCents: number | null;
    cashReportedByWorkerCents: number | null;
    cashReportedByClientCents: number | null;
    commissionChargedCents: number;
    commissionRefundedCents: number;
  };
  evidence: Array<{ id: string; kind: string; submittedById: string; content: unknown; url: string | null; retentionUntil: string | null; createdAt: string }>;
  events: Array<{ id: string; actorId: string | null; type: string; payload: unknown; createdAt: string }>;
  assignees: Array<{ id: string; email: string | null }>;
}

export type TicketStatus = 'OPEN' | 'PENDING_USER' | 'RESOLVED' | 'CLOSED';

export interface TicketRow {
  id: string;
  subject: string;
  status: TicketStatus;
  userId: string;
  userRole: string | null;
  userPhone: string | null;
  orderId: string | null;
  disputeId: string | null;
  assigneeId: string | null;
  updatedAt: string;
  waitingSupport: boolean;
}

export interface TicketCard {
  id: string;
  subject: string;
  status: TicketStatus;
  userId: string;
  orderId: string | null;
  disputeId: string | null;
  assigneeId: string | null;
  createdAt: string;
  incidentId: string | null;
  user: { id: string; role: string; phone: string | null; locale: string } | null;
  messages: Array<{ id: string; body: string; isInternal: boolean; fromSupport: boolean; senderEmail: string | null; createdAt: string }>;
}

export interface IncidentRow {
  id: string;
  orderId: string;
  orderNumber: number;
  cityId: string;
  type: string;
  reporterRole: 'client' | 'worker';
  emergencyCalled: boolean;
  photos: number;
  ticketId: string | null;
  createdAt: string;
}

export interface IncidentCard {
  id: string;
  orderId: string;
  type: string;
  description: string;
  emergencyCalled: boolean;
  reporterRole: 'client' | 'worker';
  location: LatLng | null;
  photos: string[];
  ticketId: string | null;
  createdAt: string;
  order: { number: number };
}

export interface LegalDocRow {
  id: string;
  audience: string;
  countryCode: string;
  versions: Array<{ version: string; publishedAt: string | null; legalReviewedBy: string | null; publishedById: string | null; createdAt: string; locales: Array<{ id: string; locale: string }>; consents: number }>;
}

export interface LegalVersionCard {
  documentId: string;
  audience: string;
  countryCode: string;
  version: string;
  publishedAt: string | null;
  legalReviewedBy: string | null;
  bodies: Record<string, { id: string; body: string }>;
}

export interface InsuranceRule {
  id: string;
  countryCode: string;
  categoryId: string | null;
  workerType: 'INDEPENDENT' | 'COMPANY' | null;
  required: boolean;
  requiredRisks: string[];
  note: Record<string, string> | null;
  updatedAt: string;
}

export interface BonusRule {
  id: string;
  name: string;
  minOrders: number;
  maxOrders: number | null;
  percentBp: number;
  minRating: string;
  maxCancelRateBp: number;
  maxLostDisputes: number;
  isActive: boolean;
}

export interface BonusRunRow {
  id: string;
  period: string;
  status: 'DRAFT' | 'APPROVED' | 'APPLIED' | 'CANCELLED';
  budgetCapCents: number;
  totalRawCents: number;
  createdAt: string;
  approvedAt: string | null;
  _count: { awards: number };
}

export interface BonusAward {
  id: string;
  workerId: string;
  workerPhone: string | null;
  ordersCount: number;
  commissionPaidCents: number;
  rawCents: number;
  finalCents: number;
  excludedOrders: string[];
  expiresAt: string;
  breakdown: {
    currency: string;
    tier: string | null;
    percentBp: number;
    reason: string;
    ratingX100: number;
    cancelRateBp: number;
    lostDisputes: number;
    documentsValid: boolean;
    pendingWindow: number;
    scaleBp: number;
  };
}

export interface BonusRunCard extends Omit<BonusRunRow, '_count'> {
  scaleFactor: number;
  approvedById: string | null;
  totals: Array<{ currency: string; rawCents: number; finalCents: number; workers: number }>;
  awards: BonusAward[];
}

export interface DataRequestRow {
  id: string;
  userId: string;
  userRole: string | null;
  type: 'export' | 'delete';
  status: string;
  retainedReason: string | null;
  createdAt: string;
  completedAt: string | null;
}
