import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { RT_EVENTS, type OfferClosedPayload, type OfferNewPayload, type OrderStatusPayload } from '@masterio/shared';
import { api } from '../api';
import type { Eligibility, Offer } from '../api/types';
import { currentPosition, requestLocationPermissions, startTracking, stopTracking, type PermissionResult } from '../location/control';
import { dismissOfferNotification, registerForPush } from '../notifications/push';
import { useRealtime, useRealtimeEvent } from '../realtime/RealtimeProvider';
import { useSession } from '../session/SessionProvider';

export interface ActiveOffer {
  offer: Offer;
  /** serverNow − время устройства: отсчёт идёт по серверным часам */
  serverOffsetMs: number;
}

interface WorkValue {
  eligibility: Eligibility | undefined;
  loading: boolean;
  offer: ActiveOffer | null;
  /** последнее предложение, которое стало недоступно — для сообщения «Заказ уже недоступен» */
  lostOfferReason: OfferClosedPayload['reason'] | null;
  permission: PermissionResult | null;
  goOnline(): Promise<void>;
  goOffline(): Promise<void>;
  accept(): Promise<void>;
  decline(): Promise<void>;
  clearLostOffer(): void;
  refresh(): Promise<void>;
}

const WorkContext = createContext<WorkValue | null>(null);

export function WorkProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const queryClient = useQueryClient();
  const { connected } = useRealtime();
  const [offer, setOffer] = useState<ActiveOffer | null>(null);
  const [lostOfferReason, setLost] = useState<OfferClosedPayload['reason'] | null>(null);
  const [permission, setPermission] = useState<PermissionResult | null>(null);
  const pushRegistered = useRef(false);
  const accepting = useRef<string | null>(null);

  const eligibilityQuery = useQuery({
    queryKey: ['eligibility'],
    queryFn: api.worker.eligibility,
    enabled: status === 'signedIn',
    refetchInterval: 30_000,
  });
  const eligibility = eligibilityQuery.data;

  const loadCurrentOffer = useCallback(async () => {
    if (status !== 'signedIn') return;
    try {
      const res = await api.offers.current();
      if (res.offer) setOffer({ offer: res.offer, serverOffsetMs: new Date(res.serverNow).getTime() - Date.now() });
      else setOffer((prev) => (prev && accepting.current !== prev.offer.offerId ? null : prev));
    } catch {
      // нет сети — предложение придёт по сокету или push
    }
  }, [status]);

  // при подключении сокета, возврате приложения и нажатии на уведомление — сверяемся с сервером
  useEffect(() => {
    if (connected) void loadCurrentOffer();
  }, [connected, loadCurrentOffer]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        void loadCurrentOffer();
        void queryClient.invalidateQueries({ queryKey: ['eligibility'] });
      }
    });
    const tap = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      if (data?.offerId) void loadCurrentOffer();
      else if (typeof data?.orderId === 'string') router.push(`/order/${data.orderId}`);
      else if (data?.type === 'push.team_invite') router.push('/team/invites');
      else if (data?.type === 'push.team_member_joined' || data?.type === 'push.team_removed') router.push('/team');
    });
    return () => {
      sub.remove();
      tap.remove();
    };
  }, [loadCurrentOffer, queryClient]);

  useRealtimeEvent<OfferNewPayload>(RT_EVENTS.offerNew, (p) => {
    setLost(null);
    setOffer({
      offer: {
        offerId: p.offerId,
        orderId: p.orderId,
        categoryId: p.categoryId,
        categoryCode: p.categoryCode,
        distanceM: p.distanceM,
        description: p.description,
        paymentMethod: p.paymentMethod,
        isUrgent: p.isUrgent,
        expiresAt: p.expiresAt,
      },
      serverOffsetMs: new Date(p.serverNow).getTime() - Date.now(),
    });
  });

  useRealtimeEvent<OfferClosedPayload>(RT_EVENTS.offerClosed, (p) => {
    void dismissOfferNotification(p.offerId);
    setOffer((prev) => {
      if (!prev || prev.offer.offerId !== p.offerId || accepting.current === p.offerId) return prev;
      if (p.reason === 'taken' || p.reason === 'cancelled') setLost(p.reason);
      return null;
    });
  });

  useRealtimeEvent<OrderStatusPayload>(RT_EVENTS.orderStatus, (p) => {
    void queryClient.invalidateQueries({ queryKey: ['order', p.orderId] });
    void queryClient.invalidateQueries({ queryKey: ['eligibility'] });
  });

  useRealtimeEvent(RT_EVENTS.walletChanged, () => {
    void queryClient.invalidateQueries({ queryKey: ['wallet'] });
    void queryClient.invalidateQueries({ queryKey: ['eligibility'] });
  });

  // режим геопозиции: активный заказ — часто и точно; онлайн — редко; офлайн — выключено
  useEffect(() => {
    if (!eligibility) return;
    const mode = eligibility.activeOrderId ? 'active' : eligibility.isOnline ? 'online' : null;
    void (mode ? startTracking(mode) : stopTracking()).catch(() => undefined);
  }, [eligibility]);

  useEffect(() => {
    if (status === 'signedOut') void stopTracking().catch(() => undefined);
  }, [status]);

  const goOnline = useCallback(async () => {
    const perm = await requestLocationPermissions();
    setPermission(perm);
    if (perm === 'denied') return;
    const location = await currentPosition();
    const next = await api.worker.online(location);
    queryClient.setQueryData(['eligibility'], next);
    if (!pushRegistered.current) {
      pushRegistered.current = true;
      void registerForPush().catch(() => {
        pushRegistered.current = false;
      });
    }
  }, [queryClient]);

  const goOffline = useCallback(async () => {
    const next = await api.worker.offline();
    queryClient.setQueryData(['eligibility'], next);
  }, [queryClient]);

  const accept = useCallback(async () => {
    if (!offer) return;
    const id = offer.offer.offerId;
    accepting.current = id;
    try {
      const res = await api.offers.accept(id);
      setOffer(null);
      void dismissOfferNotification(id);
      await queryClient.invalidateQueries({ queryKey: ['eligibility'] });
      router.push(`/order/${res.orderId}`);
    } catch (error) {
      setOffer(null);
      setLost('taken');
      throw error;
    } finally {
      accepting.current = null;
    }
  }, [offer, queryClient]);

  const decline = useCallback(async () => {
    if (!offer) return;
    const id = offer.offer.offerId;
    setOffer(null);
    void dismissOfferNotification(id);
    await api.offers.decline(id).catch(() => undefined);
  }, [offer]);

  const value = useMemo<WorkValue>(
    () => ({
      eligibility,
      loading: eligibilityQuery.isLoading,
      offer,
      lostOfferReason,
      permission,
      goOnline,
      goOffline,
      accept,
      decline,
      clearLostOffer: () => setLost(null),
      refresh: async () => {
        await Promise.all([eligibilityQuery.refetch(), loadCurrentOffer()]);
      },
    }),
    [eligibility, eligibilityQuery, offer, lostOfferReason, permission, goOnline, goOffline, accept, decline, loadCurrentOffer],
  );

  return <WorkContext.Provider value={value}>{children}</WorkContext.Provider>;
}

export function useWork(): WorkValue {
  const ctx = useContext(WorkContext);
  if (!ctx) throw new Error('useWork outside WorkProvider');
  return ctx;
}
