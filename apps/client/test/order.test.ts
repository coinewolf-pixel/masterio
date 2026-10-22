import { bearing, easeOutCubic, etaParts, lerp, regionFor } from '../src/order/smooth';
import { nearestCity } from '../src/draft/NewOrderProvider';
import type { City } from '../src/api/types';

describe('live map helpers', () => {
  it('interpolates the marker between two GPS points', () => {
    const a = { lat: 40.0, lng: 44.0 };
    const b = { lat: 40.1, lng: 44.2 };
    expect(lerp(a, b, 0)).toEqual(a);
    expect(lerp(a, b, 1)).toEqual(b);
    const mid = lerp(a, b, 0.5);
    expect(mid.lat).toBeCloseTo(40.05);
    expect(mid.lng).toBeCloseTo(44.1);
    // за пределами [0;1] метка не «перелетает» точку
    expect(lerp(a, b, 2)).toEqual(b);
    expect(lerp(a, b, -1)).toEqual(a);
  });

  it('eases out and stays in range', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
    expect(easeOutCubic(5)).toBe(1);
  });

  it('computes heading: north, east, south, west', () => {
    const o = { lat: 50, lng: 10 };
    expect(bearing(o, { lat: 50.01, lng: 10 })).toBeCloseTo(0, 0);
    expect(bearing(o, { lat: 50, lng: 10.01 })).toBeCloseTo(90, 0);
    expect(bearing(o, { lat: 49.99, lng: 10 })).toBeCloseTo(180, 0);
    expect(bearing(o, { lat: 50, lng: 9.99 })).toBeCloseTo(270, 0);
  });

  it('region contains the worker and the address', () => {
    const w = { lat: 52.52, lng: 13.4 };
    const addr = { lat: 52.5, lng: 13.45 };
    const r = regionFor([w, addr]);
    for (const p of [w, addr]) {
      expect(Math.abs(p.lat - r.latitude)).toBeLessThanOrEqual(r.latitudeDelta / 2);
      expect(Math.abs(p.lng - r.longitude)).toBeLessThanOrEqual(r.longitudeDelta / 2);
    }
    // одна точка — разумный минимальный масштаб, а не бесконечный зум
    expect(regionFor([w]).latitudeDelta).toBeGreaterThan(0);
  });

  it('formats ETA as hours and minutes, at least 1 minute', () => {
    expect(etaParts(null)).toBeNull();
    expect(etaParts(-5)).toBeNull();
    expect(etaParts(10)).toEqual({ hours: 0, minutes: 1 });
    expect(etaParts(7 * 60)).toEqual({ hours: 0, minutes: 7 });
    expect(etaParts(95 * 60)).toEqual({ hours: 1, minutes: 35 });
  });
});

describe('order city', () => {
  const city = (id: string, lat: number, lng: number): City => ({
    id,
    countryCode: 'XX',
    names: { en: id },
    currency: 'EUR',
    timezone: 'UTC',
    emergencyNumber: '112',
    center: { lat, lng },
  });

  it('picks the nearest city to the address', () => {
    const cities = [city('yerevan', 40.18, 44.51), city('berlin', 52.52, 13.405), { ...city('nocenter', 0, 0), center: null }];
    expect(nearestCity(cities, { lat: 52.4, lng: 13.1 })?.id).toBe('berlin');
    expect(nearestCity(cities, { lat: 40.2, lng: 44.4 })?.id).toBe('yerevan');
    expect(nearestCity([], { lat: 0, lng: 0 })).toBeNull();
  });
});
