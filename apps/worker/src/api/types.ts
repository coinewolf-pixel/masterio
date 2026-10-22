/** Ответы API, которые использует Masterio Pro. Поля совпадают с сервером (apps/api). */

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

export type Names = Record<string, string>;

export interface Me {
  id: string;
  role: 'CLIENT' | 'WORKER' | 'ADMIN';
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  locale: string;
  countryCode: string;
  status: string;
  worker: {
    type: 'INDEPENDENT' | 'COMPANY';
    kycStatus: 'NOT_VERIFIED' | 'VERIFIED' | 'EXPIRED' | 'REJECTED';
    isOnline: boolean;
    ratingAvg: number;
    ratingCount: number;
    preferredRadiusM: number | null;
    autoUseEarnings: boolean;
    companyName: string | null;
    categoryIds: string[];
    cityIds: string[];
  } | null;
  /** member — участник чужой команды (только назначенные заказы); owner — руководитель своей команды */
  team: { mode: 'member' | 'owner'; teamId: string; name: string; role: TeamRole } | null;
  pendingInvites: number;
}

export type TeamRole = 'LEADER' | 'MASTER' | 'HELPER' | 'EMPLOYEE';

export interface City {
  id: string;
  countryCode: string;
  names: Names;
  currency: string;
  timezone: string;
  emergencyNumber: string;
}

export interface CategoryGroup {
  id: string;
  code: string;
  names: Names;
  categories: Array<{ id: string; code: string; names: Names; isUrgent: boolean; requiresLicense: boolean; requiresInsurance: boolean }>;
}

export type IneligibleReason = 'kyc' | 'blocked' | 'balance' | 'debt' | 'active_order' | 'offline' | 'no_categories' | 'no_cities' | 'team_member';

export interface Eligibility {
  eligible: boolean;
  reasons: IneligibleReason[];
  isOnline: boolean;
  accessBalanceCents: number;
  thresholdCents: number;
  debtCents: number;
  debtLimitCents: number;
  currency: string;
  activeOrderId: string | null;
  activeOrderIds: string[];
  capacity: number;
}

export interface Offer {
  offerId: string;
  orderId: string;
  categoryId: string;
  categoryCode: string;
  distanceM: number;
  description: string;
  paymentMethod: 'CASH' | 'CARD';
  isUrgent: boolean;
  expiresAt: string;
}

export interface EstimateItem {
  type: 'LABOR' | 'MATERIAL' | 'TRAVEL' | 'OTHER';
  title: string;
  quantity: number;
  unitCents: number;
  totalCents?: number;
}

export interface Estimate {
  id: string;
  version: number;
  status: 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';
  totalCents: number;
  note: string | null;
  items: EstimateItem[];
}

export interface OrderDetails {
  id: string;
  number: number;
  status: OrderStatus;
  categoryId: string;
  cityId: string;
  description: string;
  addressFormatted: string;
  addressDetails: string | null;
  paymentMethod: 'CASH' | 'CARD';
  currency: string;
  confirmedAmountCents: number | null;
  commissionCents: number | null;
  bonusDiscountCents: number | null;
  location: { lat: number; lng: number } | null;
  estimates: Estimate[];
  contacts: { clientPhone?: string | null; workerPhone?: string | null } | null;
  dispute: { id: string; status: string; reason: string } | null;
  arrivedAt: string | null;
  createdAt: string;
  /** кто смотрит: руководитель (owner) или назначенный исполнитель-участник (performer) */
  viewer: 'owner' | 'performer' | 'client' | 'admin';
  team: OrderTeamInfo | null;
}

export interface AssignmentCard {
  assignmentId: string;
  memberId: string;
  userId: string;
  name: string | null;
  role: TeamRole;
  automatic: boolean;
  since: string;
}

export interface OrderTeamInfo {
  current: AssignmentCard | null;
  pending: AssignmentCard | null;
  needsAssignment: boolean;
  assignDeadline: string | null;
  consentRequired: boolean;
}

export interface OrderListItem {
  id: string;
  number: number;
  status: OrderStatus;
  createdAt: string;
  category: { code: string; names: Names };
}

export interface Wallet {
  currency: string;
  topupCents: number;
  promoCents: number;
  bonusCents: number;
  earningsCents: number;
  pendingCents: number;
  debtCents: number;
  showEarnings: boolean;
  topupEnabled: boolean;
  promoLots: Array<{ remainingCents: number; expiresAt: string | null }>;
  bonusLots: Array<{ remainingCents: number; expiresAt: string | null }>;
}

export interface WalletTransaction {
  id: string;
  pocket: string;
  currency: string;
  amountCents: number;
  kind: string;
  orderId: string | null;
  createdAt: string;
}

export interface HistoryOrder {
  id: string;
  number: number;
  completedAt: string;
  status: OrderStatus;
  category: { code: string; names: Names };
  paymentMethod: 'CASH' | 'CARD';
  currency: string;
  amountCents: number;
  commissionCents: number;
  bonusDiscountCents: number;
  netCents: number;
  clientUnconfirmed: boolean;
}

export interface MonthSummary {
  month: string;
  currency: string | null;
  ordersCount: number;
  grossCents: number;
  commissionCents: number;
  bonusUsedCents: number;
  netCents: number;
  avgRating: number | null;
  cancelRateBp: number;
}

export interface Stats {
  current: MonthSummary;
  previous: MonthSummary;
  bonus: {
    currentTier: { name: string; minOrders: number; percentBp: number } | null;
    nextTier: { name: string; minOrders: number; percentBp: number } | null;
    ordersToNext: number;
    conditions: { minRating: number; maxCancelRatePercent: number; maxLostDisputes: number };
  };
}

export interface DocumentItem {
  id: string;
  kind: 'ID_DOCUMENT' | 'SELFIE' | 'LICENSE' | 'INSURANCE' | 'COMPANY_REGISTRATION' | 'QUALIFICATION' | 'OTHER';
  status: 'NOT_VERIFIED' | 'VERIFIED' | 'EXPIRED' | 'REJECTED';
  rejectReason: string | null;
  validUntil: string | null;
  createdAt: string;
  license: { categoryId: string; number: string | null } | null;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  body: string;
  filtered: boolean;
  createdAt: string;
}

export interface UploadForm {
  key: string;
  url: string;
  fields: Record<string, string>;
}
