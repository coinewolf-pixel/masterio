import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { distanceMeters, type LatLng } from '@masterio/shared';
import type { City } from '../api/types';

export interface DraftAddress {
  formatted: string;
  details?: string;
  placeId?: string;
  location: LatLng;
  save?: boolean;
  label?: string;
}

export interface DraftPhoto {
  key: string;
  uri: string;
}

export interface Draft {
  categoryId: string | null;
  description: string;
  photos: DraftPhoto[];
  address: DraftAddress | null;
  timing: 'ASAP' | 'SCHEDULED';
  scheduledAt: Date | null;
  paymentMethod: 'CASH' | 'CARD';
}

const EMPTY: Draft = { categoryId: null, description: '', photos: [], address: null, timing: 'ASAP', scheduledAt: null, paymentMethod: 'CASH' };

interface DraftValue {
  draft: Draft;
  update(patch: Partial<Draft>): void;
  reset(categoryId?: string | null, from?: Partial<Draft>): void;
}

const DraftContext = createContext<DraftValue | null>(null);

/** Черновик заказа живёт между экранами «Новый заказ» и «Адрес». */
export function NewOrderProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const update = useCallback((patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch })), []);
  const reset = useCallback((categoryId: string | null = null, from: Partial<Draft> = {}) => setDraft({ ...EMPTY, categoryId, ...from }), []);
  const value = useMemo(() => ({ draft, update, reset }), [draft, update, reset]);
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function useDraft(): DraftValue {
  const ctx = useContext(DraftContext);
  if (!ctx) throw new Error('useDraft outside NewOrderProvider');
  return ctx;
}

/** Город заказа — ближайший к адресу город с центром (заказы, радиус и цены делятся по городам). */
export function nearestCity(cities: City[], at: LatLng): City | null {
  let best: { city: City; d: number } | null = null;
  for (const city of cities) {
    if (!city.center) continue;
    const d = distanceMeters(city.center, at);
    if (!best || d < best.d) best = { city, d };
  }
  return best?.city ?? null;
}
