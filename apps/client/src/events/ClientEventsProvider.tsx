import { useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useRef, type ReactNode } from 'react';
import { RT_EVENTS, type OrderStatusPayload } from '@masterio/shared';
import { registerForPush } from '../notifications/push';
import { useRealtimeEvent } from '../realtime/RealtimeProvider';
import { useSession } from '../session/SessionProvider';

/** События заказа по сокету обновляют экраны; нажатие на уведомление открывает заказ. */
export function ClientEventsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { status } = useSession();
  const pushRegistered = useRef(false);

  useEffect(() => {
    if (status !== 'signedIn' || pushRegistered.current) return;
    pushRegistered.current = true;
    void registerForPush().catch(() => {
      pushRegistered.current = false;
    });
  }, [status]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      if (typeof data?.orderId === 'string') router.push(`/order/${data.orderId}`);
    });
    return () => sub.remove();
  }, []);

  const refreshOrder = (orderId: string) => {
    void queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
  };

  useRealtimeEvent<OrderStatusPayload>(RT_EVENTS.orderStatus, (p) => refreshOrder(p.orderId));
  useRealtimeEvent<{ orderId: string }>(RT_EVENTS.orderEstimate, (p) => refreshOrder(p.orderId));
  useRealtimeEvent<{ orderId: string }>(RT_EVENTS.dispatchNoWorkers, (p) => refreshOrder(p.orderId));
  useRealtimeEvent<{ orderId: string }>(RT_EVENTS.chatMessage, (p) => {
    void queryClient.invalidateQueries({ queryKey: ['chat', p.orderId] });
  });

  return <>{children}</>;
}
