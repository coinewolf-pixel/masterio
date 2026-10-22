/** Имена событий Socket.IO (namespace /rt) и их данные. Один источник правды для сервера и приложений. */

export const RT_NAMESPACE = '/rt';

export const RT_EVENTS = {
  /** сервер проверил токен и подключил к комнатам — после этого можно слать события */
  ready: 'rt:ready',
  error: 'rt:error',
  offerNew: 'offer:new',
  offerClosed: 'offer:closed',
  orderStatus: 'order:status',
  orderAssignment: 'order:assignment',
  orderEstimate: 'order:estimate',
  locationUpdate: 'location:update',
  locationWorker: 'location:worker',
  locationLost: 'location:lost',
  locationRestored: 'location:restored',
  chatMessage: 'chat:message',
  dispatchNoWorkers: 'dispatch:no-workers',
  walletChanged: 'wallet:changed',
  adminMap: 'admin:map',
  orderJoin: 'order:join',
  disputeUpdated: 'dispute:updated',
  ticketMessage: 'ticket:message',
  teamUpdated: 'team:updated',
} as const;

export type OfferClosedReason = 'expired' | 'declined' | 'taken' | 'cancelled';

export interface OfferNewPayload {
  offerId: string;
  orderId: string;
  categoryId: string;
  categoryCode: string;
  distanceM: number;
  description: string;
  paymentMethod: 'CASH' | 'CARD';
  isUrgent: boolean;
  /** серверное время окончания, ISO; приложение только показывает обратный отсчёт */
  expiresAt: string;
  serverNow: string;
}

export interface OfferClosedPayload {
  offerId: string;
  orderId: string;
  reason: OfferClosedReason;
}

export interface OrderStatusPayload {
  orderId: string;
  status: string;
  at: string;
}

export interface WorkerLocationPayload {
  orderId: string;
  lat: number;
  lng: number;
  heading: number | null;
  speedMps: number | null;
  distanceM: number;
  etaSeconds: number | null;
  recordedAt: string;
}

export interface WalletChangedPayload {
  topupCents: number;
  promoCents: number;
  bonusCents: number;
  earningsCents: number;
  debtCents: number;
}

/** Дельты живой карты CRM (`admin:map`): мастер на линии, исполнитель заказа в пути, мастер ушёл с линии. */
export type AdminMapPayload =
  | { kind: 'worker'; userId: string; lat: number; lng: number; at: string }
  | ({ kind: 'performer'; userId: string } & WorkerLocationPayload)
  | { kind: 'offline'; userId: string };
