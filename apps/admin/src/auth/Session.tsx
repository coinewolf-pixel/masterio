import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError } from '@masterio/shared';
import { api, onSessionExpired, sessionTokens } from '../api';
import type { AdminMe } from '../api/types';
import { ACTIONS, allowed, SECTIONS, type Action, type Section } from './permissions';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface SessionValue {
  status: Status;
  me: AdminMe | null;
  signIn(email: string, password: string, totp: string): Promise<void>;
  signOut(): Promise<void>;
  canSee(section: Section): boolean;
  can(action: Action): boolean;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<AdminMe | null>(null);

  const load = useCallback(async () => {
    if (!(await sessionTokens.get())) {
      setStatus('signedOut');
      return;
    }
    try {
      setMe(await api.me());
      setStatus('signedIn');
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) await sessionTokens.clear();
      setMe(null);
      setStatus('signedOut');
    }
  }, []);

  useEffect(() => {
    void load();
    return onSessionExpired(() => {
      setMe(null);
      setStatus('signedOut');
      queryClient.clear();
    });
  }, [load, queryClient]);

  const signIn = useCallback(
    async (email: string, password: string, totp: string) => {
      const pair = await api.login(email.trim().toLowerCase(), password, totp);
      await sessionTokens.set(pair);
      await load();
    },
    [load],
  );

  const signOut = useCallback(async () => {
    const tokens = await sessionTokens.get();
    if (tokens) await api.logout(tokens.refreshToken).catch(() => undefined);
    await sessionTokens.clear();
    queryClient.clear();
    setMe(null);
    setStatus('signedOut');
  }, [queryClient]);

  const value = useMemo<SessionValue>(() => {
    const roles = me?.subRoles ?? [];
    return {
      status,
      me,
      signIn,
      signOut,
      canSee: (section) => allowed(roles, SECTIONS[section]),
      can: (action) => allowed(roles, ACTIONS[action]),
    };
  }, [status, me, signIn, signOut]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession outside SessionProvider');
  return ctx;
}
