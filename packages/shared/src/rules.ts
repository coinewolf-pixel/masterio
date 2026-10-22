/** Правила, общие для сервера и приложений (отображение превью штрафа и т.п.). */

export const CLIENT_CANCEL_REASONS = [
  'changed_mind',
  'found_other',
  'wrong_address',
  'too_long_wait',
  'worker_unresponsive',
  'off_platform_payment',
  'worker_asked_to_cancel',
  'other',
] as const;
export type ClientCancelReason = (typeof CLIENT_CANCEL_REASONS)[number];

export const WORKER_CANCEL_REASONS = [
  'client_unreachable',
  'cannot_arrive',
  'vehicle_problem',
  'wrong_category',
  'client_asked_off_platform',
  'safety_concern',
  'other',
] as const;
export type WorkerCancelReason = (typeof WORKER_CANCEL_REASONS)[number];

/** Причины, которые создают проверку вместо штрафа (раздел 12). */
export const REVIEW_REASONS: ReadonlySet<string> = new Set([
  'worker_unresponsive',
  'off_platform_payment',
  'worker_asked_to_cancel',
  'client_asked_off_platform',
  'safety_concern',
]);

export type CancellableStatus = 'DRAFT' | 'SEARCHING' | 'NO_WORKERS' | 'ACCEPTED' | 'EN_ROUTE' | 'ARRIVED';

export interface ClientCancelInput {
  status: CancellableStatus;
  minutesSinceAccept: number;
  reason: string;
  freeMinutes: number;
  penalties: { ACCEPTED: number; EN_ROUTE: number; ARRIVED: number };
  travelCompensationCents: number;
}

export interface CancelFee {
  penaltyCents: number;
  compensationCents: number;
  createsReview: boolean;
}

/**
 * Стоимость отмены для клиента: до принятия бесплатно; причины-жалобы → проверка без штрафа;
 * мастер уже на месте → компенсация за выезд; иначе бесплатное окно, затем штраф по статусу.
 */
export function clientCancelFee(input: ClientCancelInput): CancelFee {
  const createsReview = REVIEW_REASONS.has(input.reason);
  if (input.status === 'DRAFT' || input.status === 'SEARCHING' || input.status === 'NO_WORKERS') {
    return { penaltyCents: 0, compensationCents: 0, createsReview };
  }
  if (createsReview) return { penaltyCents: 0, compensationCents: 0, createsReview };
  if (input.status === 'ARRIVED') {
    return { penaltyCents: input.penalties.ARRIVED, compensationCents: input.travelCompensationCents, createsReview };
  }
  if (input.minutesSinceAccept < input.freeMinutes) return { penaltyCents: 0, compensationCents: 0, createsReview };
  return { penaltyCents: input.penalties[input.status], compensationCents: 0, createsReview };
}

/** Активные статусы заказа: у мастера может быть только один такой заказ, идёт трансляция геопозиции. */
export const ACTIVE_ORDER_STATUSES = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] as const;

/** Допустимые переходы статусов, которые выполняет исполнитель. */
export const WORKER_STATUS_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  ACCEPTED: ['EN_ROUTE'],
  EN_ROUTE: ['ARRIVED'],
  ARRIVED: ['IN_PROGRESS'],
};

/** Расстояние между двумя точками, метры (формула гаверсинуса). */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_008.8;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/** Интервал отправки геопозиции по скорости (экономия батареи, раздел 4). */
export function locationIntervalSeconds(speedMps: number | null): number {
  if (speedMps === null || speedMps < 0.5) return 15;
  if (speedMps < 3) return 8;
  if (speedMps < 12) return 5;
  return 3;
}
