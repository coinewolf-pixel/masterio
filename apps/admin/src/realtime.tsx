import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { RT_EVENTS } from '@masterio/shared';
import { client, SOCKET_URL } from './api';

interface RealtimeValue {
  socket: Socket | null;
  connected: boolean;
}

const RealtimeContext = createContext<RealtimeValue>({ socket: null, connected: false });

/**
 * Один сокет на вкладку CRM: комната admins получает статусы заказов и движение мастеров.
 * Токен берётся при каждом подключении — после обновления пары переподключение идёт с новым.
 */
export function RealtimeProvider({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const s = io(`${SOCKET_URL}/rt`, {
      transports: ['websocket'],
      auth: (cb) => {
        void client.accessToken().then((token) => cb({ token: token ?? '' }));
      },
    });
    let failures = 0;
    s.on(RT_EVENTS.ready, () => {
      failures = 0;
      setConnected(true);
    });
    s.on('disconnect', () => setConnected(false));
    // токен истёк между подключениями — обновить и попробовать снова
    s.on(RT_EVENTS.error, () => {
      failures += 1;
      if (failures > 3) return;
      void client.refresh().then((ok) => {
        if (ok) s.connect();
      });
    });
    setSocket(s);
    return () => {
      s.removeAllListeners();
      s.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [enabled]);

  return <RealtimeContext.Provider value={{ socket, connected }}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeValue {
  return useContext(RealtimeContext);
}

/** Подписка на событие сервера; обработчик можно менять между рендерами без переподписки. */
export function useRealtimeEvent<T>(event: string, handler: (payload: T) => void): void {
  const { socket } = useRealtime();
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    if (!socket) return;
    const listener = (payload: T) => ref.current(payload);
    socket.on(event, listener);
    return () => {
      socket.off(event, listener);
    };
  }, [socket, event]);
}
