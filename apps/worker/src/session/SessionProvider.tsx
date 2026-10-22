import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, onSessionExpired, secureTokens } from '../api';
import { ApiError, type TokenPair } from '@masterio/shared';
import type { Me } from '../api/types';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface SessionValue {
  status: Status;
  me: Me | null;
  signIn(tokens: TokenPair): Promise<void>;
  signOut(): Promise<void>;
  reloadMe(): Promise<Me | null>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<Me | null>(null);

  const reloadMe = useCallback(async () => {
    try {
      const value = await api.me.get();
      setMe(value);
      setStatus('signedIn');
      return value;
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        await secureTokens.clear();
        setMe(null);
        setStatus('signedOut');
        return null;
      }
      // нет сети: если токены есть, остаёмся в приложении — данные подтянутся позже
      const tokens = await secureTokens.get();
      setStatus(tokens ? 'signedIn' : 'signedOut');
      return null;
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const tokens = await secureTokens.get();
      if (!tokens) {
        setStatus('signedOut');
        return;
      }
      await reloadMe();
    })();
    return onSessionExpired(() => {
      setMe(null);
      setStatus('signedOut');
      queryClient.clear();
    });
  }, [reloadMe, queryClient]);

  const signIn = useCallback(
    async (tokens: TokenPair) => {
      await secureTokens.set(tokens);
      await reloadMe();
    },
    [reloadMe],
  );

  const signOut = useCallback(async () => {
    const tokens = await secureTokens.get();
    if (tokens) await api.auth.logout(tokens.refreshToken).catch(() => undefined);
    await secureTokens.clear();
    queryClient.clear();
    setMe(null);
    setStatus('signedOut');
  }, [queryClient]);

  const value = useMemo(() => ({ status, me, signIn, signOut, reloadMe }), [status, me, signIn, signOut, reloadMe]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession outside SessionProvider');
  return ctx;
}

/** Нужна ли анкета: имя, хотя бы одна категория и город. */
export function needsOnboarding(me: Me | null): boolean {
  if (!me?.worker) return true;
  // участнику команды услуги и города не нужны: он работает по назначениям руководителя
  if (me.team?.mode === 'member') return !me.firstName;
  return !me.firstName || me.worker.categoryIds.length === 0 || me.worker.cityIds.length === 0;
}

/** Участник чужой команды: без линии, кошелька и предложений. */
export function isTeamMember(me: Me | null): boolean {
  return me?.team?.mode === 'member';
}
