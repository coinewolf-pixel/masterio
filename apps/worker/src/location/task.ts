/**
 * Фоновая задача геопозиции. Модуль должен импортироваться при старте приложения (app/_layout.tsx),
 * чтобы система могла разбудить JS и передать точки, даже если интерфейс закрыт.
 * Точки уходят на сервер по HTTP (надёжнее сокета в фоне); без связи — в буфер на устройстве.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LocationObject } from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { api } from '../api';
import { ApiError } from '@masterio/shared';
import { LocationBuffer, toPoint } from './buffer';

export const LOCATION_TASK = 'masterio-pro-location';

export const locationBuffer = new LocationBuffer(AsyncStorage);

type Listener = (status: 'sent' | 'buffered') => void;
const listeners = new Set<Listener>();
export function onLocationDelivery(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function deliver(locations: LocationObject[]): Promise<void> {
  const points = locations.map(toPoint);
  const sent = await locationBuffer.flush(points, async (batch) => {
    await api.tracking.batch(batch);
  });
  listeners.forEach((l) => l(sent > 0 ? 'sent' : 'buffered'));
}

TaskManager.defineTask<{ locations: LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  try {
    await deliver(data.locations);
  } catch (e) {
    // сессия закончилась — точки не нужны, буфер очищается при выходе
    if (e instanceof ApiError && e.status === 401) return;
  }
});
