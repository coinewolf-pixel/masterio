import type { LocationPointInput } from '@masterio/shared';

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const KEY = 'masterio.locationBuffer';
export const MAX_BUFFERED = 2_000;
export const BATCH_SIZE = 500;

/**
 * Буфер точек на устройстве на случай потери связи (раздел 4). Хранится в постоянном хранилище,
 * переживает перезапуск приложения; при переполнении выбрасываются самые старые точки.
 */
export class LocationBuffer {
  constructor(private readonly storage: KeyValueStorage) {}

  async read(): Promise<LocationPointInput[]> {
    try {
      const raw = await this.storage.getItem(KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(parsed) ? (parsed as LocationPointInput[]) : [];
    } catch {
      return [];
    }
  }

  async push(points: LocationPointInput[]): Promise<number> {
    const all = [...(await this.read()), ...points];
    const trimmed = all.slice(Math.max(0, all.length - MAX_BUFFERED));
    await this.storage.setItem(KEY, JSON.stringify(trimmed));
    return trimmed.length;
  }

  /**
   * Отправляет накопленные точки пачками вместе с новыми. Если отправка не удалась — всё остаётся в буфере.
   * Возвращает, сколько точек отправлено.
   */
  async flush(fresh: LocationPointInput[], send: (points: LocationPointInput[]) => Promise<void>): Promise<number> {
    const pending = [...(await this.read()), ...fresh].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    if (pending.length === 0) return 0;
    let sent = 0;
    try {
      for (let i = 0; i < pending.length; i += BATCH_SIZE) {
        await send(pending.slice(i, i + BATCH_SIZE));
        sent = Math.min(pending.length, i + BATCH_SIZE);
      }
      await this.storage.removeItem(KEY);
    } catch {
      const rest = pending.slice(sent);
      await this.storage.setItem(KEY, JSON.stringify(rest.slice(Math.max(0, rest.length - MAX_BUFFERED))));
    }
    return sent;
  }
}

/** Преобразование точки expo-location в формат API. */
export function toPoint(loc: {
  coords: { latitude: number; longitude: number; accuracy: number | null; speed: number | null; heading: number | null };
  timestamp: number;
}): LocationPointInput {
  return {
    lat: loc.coords.latitude,
    lng: loc.coords.longitude,
    accuracyM: loc.coords.accuracy ?? undefined,
    speedMps: loc.coords.speed !== null && loc.coords.speed >= 0 ? Math.min(loc.coords.speed, 100) : null,
    heading: loc.coords.heading !== null && loc.coords.heading >= 0 ? loc.coords.heading % 360 : null,
    recordedAt: new Date(loc.timestamp).toISOString(),
  };
}
