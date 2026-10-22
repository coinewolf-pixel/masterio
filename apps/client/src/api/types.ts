/** Ответы API, которые использует приложение клиента Masterio. */

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
}

export interface City {
  id: string;
  countryCode: string;
  names: Names;
  currency: string;
  timezone: string;
  emergencyNumber: string;
  center: { lat: number; lng: number } | null;
}

export interface Category {
  id: string;
  code: string;
  names: Names;
  icon: string | null;
  isUrgent: boolean;
  requiresLicense: boolean;
  requiresInsurance: boolean;
}

export interface CategoryGroup {
  id: string;
  code: string;
  names: Names;
  categories: Category[];
}

export interface AppConfig {
  cashEnabled: boolean;
  cardPaymentsEnabled: boolean;
  clientCardRequiredForCash: boolean;
  commissionPercent: number;
  searchRadiusM: number;
  maxSearchRadiusM: number;
  freeCancelMinutes: number;
  travelCompensationCents: number;
  offerTtlSeconds: number;
  emergencyNumber: string;
  currency: string | null;
}

export interface Availability {
  radiusM: number;
  availableCount: number;
  nearestDistanceM: number | null;
  suggestExpandRadius: boolean;
  maxRadiusM: number;
  availableInMaxRadius: number;
}

export interface SavedAddress {
  id: string;
  label: string | null;
  formatted: string;
  details: string | null;
  placeId: string | null;
  lat: number;
  lng: number;
}

export interface PlaceSuggestion {
  placeId: string;
  primary: string;
  secondary: string;
}

export interface Estimate {
  id: string;
  version: number;
  status: 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';
  totalCents: number;
  note: string | null;
  items: Array<{ type: 'LABOR' | 'MATERIAL' | 'TRAVEL' | 'OTHER'; title: string; quantity: number; unitCents: number; totalCents: number }>;
}

export interface Performer {
  userId: string;
  name: string | null;
  photoKey: string | null;
  /** MASTER — сам мастер; LEADER / HELPER / EMPLOYEE — участник команды */
  role: string;
  ratingAvg: number | null;
  badges: { licenseVerified: boolean; insured: boolean };
  phone: string | null;
}

export interface OrderDetails {
  id: string;
  number: number;
  status: OrderStatus;
  categoryId: string;
  cityId: string;
  workerId: string | null;
  description: string;
  addressFormatted: string;
  addressDetails: string | null;
  paymentMethod: 'CASH' | 'CARD';
  currency: string;
  timing: 'ASAP' | 'SCHEDULED';
  scheduledAt: string | null;
  searchRadiusM: number;
  confirmedAmountCents: number | null;
  cashReportedByWorkerCents: number | null;
  location: { lat: number; lng: number } | null;
  estimates: Estimate[];
  photos: Array<{ id: string; purpose: string; url: string }>;
  performer: Performer | null;
  reviewedByMe: boolean;
  dispute: { id: string; status: string; reason: string } | null;
  contacts: { workerPhone?: string | null } | null;
  createdAt: string;
  acceptedAt: string | null;
  /** замена исполнителя в команде мастера, ожидающая согласия клиента (раздел 19.2) */
  pendingPerformerChange: { assignmentId: string; name: string | null; photoKey: string | null; role: string; reason: string | null; requestedAt: string } | null;
}

export interface CancelFee {
  penaltyCents: number;
  compensationCents: number;
  createsReview: boolean;
}

export interface TrackPoint {
  lat: number;
  lng: number;
  recordedAt: string;
}

export interface ClientHistory {
  month: string;
  summary: { ordersCount: number; spentCents: number; currency: string | null };
  items: Array<{
    id: string;
    number: number;
    createdAt: string;
    status: OrderStatus;
    category: { id: string; code: string; names: Names };
    paymentMethod: 'CASH' | 'CARD';
    currency: string;
    amountCents: number | null;
    paidCents: number;
    workerName: string | null;
    addressFormatted: string;
    description: string;
  }>;
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
