import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { io, type Socket } from 'socket.io-client';
import { RT_EVENTS, RT_NAMESPACE } from '@masterio/shared';
import { client } from '../api';
import { SOCKET_URL } from '../config';
import { useSession } from '../session/SessionProvider';

type Handler = (payload: never) => void;

interface RealtimeValue {
  connected: boolean;
  on<T>(event: string, handler: (payload: T) => void): () => void;
  emitWithAck<T>(event: string, payload: unknown): Promise<T | null>;
}

const RealtimeContext = createContext<RealtimeValue | null>(null);

/**
 * Socket.IO /rt: подключается после входа, ждёт rt:ready, переподключается при возврате приложения
 * и при обновлении токена. Подписчики получают события через on().
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const socketRef = useRef<Socket | null>(null);
  const handlers = useRef(new Map<string, Set<Handler>>());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (status !== 'signedIn') return;
    let disposed = false;

    const socket = io(`${SOCKET_URL}${RT_NAMESPACE}`, {
      transports: ['websocket'],
      autoConnect: false,
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
      // свежий токен при каждой попытке подключения
      auth: (cb) => {
        void client.accessToken().then((token) => cb({ token }));
      },
    });
    socketRef.current = socket;

    socket.on(RT_EVENTS.ready, () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on(RT_EVENTS.error, () => {
      setConnected(false);
      void client.refresh().then((ok) => {
        if (ok && !disposed) socket.connect();
      });
    });
    socket.onAny((event: string, payload: unknown) => {
      handlers.current.get(event)?.forEach((h) => (h as (p: unknown) => void)(payload));
    });
    socket.connect();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !socket.connected) socket.connect();
    });
    return () => {
      disposed = true;
      sub.remove();
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [status]);

  const value = useMemo<RealtimeValue>(
    () => ({
      connected,
      on<T>(event: string, handler: (payload: T) => void) {
        const set = handlers.current.get(event) ?? new Set<Handler>();
        set.add(handler as Handler);
        handlers.current.set(event, set);
        return () => {
          set.delete(handler as Handler);
        };
      },
      async emitWithAck<T>(event: string, payload: unknown) {
        const socket = socketRef.current;
        if (!socket?.connected) return null;
        try {
          return (await socket.timeout(8_000).emitWithAck(event, payload)) as T;
        } catch {
          return null;
        }
      },
    }),
    [connected],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeValue {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error('useRealtime outside RealtimeProvider');
  return ctx;
}

/** Подписка на событие на время жизни компонента. */
export function useRealtimeEvent<T>(event: string, handler: (payload: T) => void): void {
  const { on } = useRealtime();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => on<T>(event, (p) => ref.current(p)), [on, event]);
}
