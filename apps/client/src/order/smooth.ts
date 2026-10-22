import type { LatLng } from '@masterio/shared';

/** Линейная интерполяция координат (на коротких отрезках между точками трека этого достаточно). */
export function lerp(from: LatLng, to: LatLng, t: number): LatLng {
  const k = Math.min(1, Math.max(0, t));
  return { lat: from.lat + (to.lat - from.lat) * k, lng: from.lng + (to.lng - from.lng) * k };
}

/** Плавное замедление в конце движения метки. */
export function easeOutCubic(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return 1 - (1 - k) ** 3;
}

/** Азимут от точки a к точке b в градусах (0 — север), чтобы повернуть метку по направлению движения. */
export function bearing(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Область карты, в которую помещаются обе точки (исполнитель и адрес) с запасом. */
export function regionFor(points: LatLng[], paddingFactor = 1.6): { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number } {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.005, (maxLat - minLat) * paddingFactor),
    longitudeDelta: Math.max(0.005, (maxLng - minLng) * paddingFactor),
  };
}

/** ETA для показа: «< 1 мин», минуты или часы и минуты. */
export function etaParts(seconds: number | null): { minutes: number; hours: number } | null {
  if (seconds === null || seconds < 0) return null;
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}
