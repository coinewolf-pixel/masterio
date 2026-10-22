import * as Location from 'expo-location';
import { i18n } from '../i18n';
import { LOCATION_TASK } from './task';

export type TrackingMode = 'online' | 'active';

let currentMode: TrackingMode | null = null;

export type PermissionResult = 'granted' | 'foreground_only' | 'denied';

/** Разрешения: сначала «при использовании», затем «всегда» (нужно для работы в фоне). */
export async function requestLocationPermissions(): Promise<PermissionResult> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return 'denied';
  const bg = await Location.requestBackgroundPermissionsAsync();
  return bg.status === 'granted' ? 'granted' : 'foreground_only';
}

export async function currentPosition(): Promise<{ lat: number; lng: number }> {
  const last = await Location.getLastKnownPositionAsync({ maxAge: 30_000, requiredAccuracy: 200 });
  const pos = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }));
  return { lat: pos.coords.latitude, lng: pos.coords.longitude };
}

/**
 * online — мастер ждёт заказы: точка раз в минуту или при сдвиге на 100 м (экономия батареи);
 * active — активный заказ: точка каждые ~5 с или 10 м, высокая точность, foreground service на Android.
 */
export async function startTracking(mode: TrackingMode): Promise<void> {
  if (currentMode === mode && (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK))) return;
  const perm = await Location.getBackgroundPermissionsAsync();
  if (perm.status !== 'granted') {
    const fg = await Location.getForegroundPermissionsAsync();
    if (fg.status !== 'granted') return;
  }
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  const active = mode === 'active';
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: active ? Location.Accuracy.BestForNavigation : Location.Accuracy.Balanced,
    timeInterval: active ? 5_000 : 60_000,
    distanceInterval: active ? 10 : 100,
    deferredUpdatesInterval: active ? 5_000 : 60_000,
    pausesUpdatesAutomatically: false,
    activityType: active ? Location.ActivityType.AutomotiveNavigation : Location.ActivityType.Other,
    showsBackgroundLocationIndicator: active,
    foregroundService: {
      notificationTitle: i18n.t(active ? 'pro.tracking.activeTitle' : 'pro.tracking.onlineTitle'),
      notificationBody: i18n.t(active ? 'pro.tracking.activeBody' : 'pro.tracking.onlineBody'),
      notificationColor: '#0E7C66',
      killServiceOnDestroy: false,
    },
  });
  currentMode = mode;
}

export async function stopTracking(): Promise<void> {
  currentMode = null;
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
}
