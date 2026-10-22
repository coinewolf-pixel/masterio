import type { LocationPointInput } from '@masterio/shared';
import { LocationBuffer, MAX_BUFFERED, toPoint, type KeyValueStorage } from '../src/location/buffer';

function memory(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async getItem(k) {
      return data.get(k) ?? null;
    },
    async setItem(k, v) {
      data.set(k, v);
    },
    async removeItem(k) {
      data.delete(k);
    },
  };
}

const point = (i: number): LocationPointInput => ({ lat: 40 + i / 1e5, lng: 44, recordedAt: new Date(Date.UTC(2026, 9, 21, 10, 0, i)).toISOString() });

describe('location buffer (connection loss)', () => {
  it('keeps points when sending fails and delivers them in order once online', async () => {
    const storage = memory();
    const buffer = new LocationBuffer(storage);
    const fail = async () => {
      throw new Error('offline');
    };
    expect(await buffer.flush([point(2), point(1)], fail)).toBe(0);
    expect((await buffer.read()).length).toBe(2);

    const sent: LocationPointInput[][] = [];
    expect(await buffer.flush([point(3)], async (b) => void sent.push(b))).toBe(3);
    expect(sent[0]?.map((p) => p.recordedAt)).toEqual([point(1), point(2), point(3)].map((p) => p.recordedAt));
    expect(await buffer.read()).toEqual([]);
  });

  it('sends in batches and keeps only the unsent tail after a failure', async () => {
    const buffer = new LocationBuffer(memory());
    const many = Array.from({ length: 1_200 }, (_, i) => point(i));
    let calls = 0;
    const sent = await buffer.flush(many, async () => {
      calls += 1;
      if (calls === 2) throw new Error('dropped');
    });
    expect(sent).toBe(500);
    expect((await buffer.read()).length).toBe(700);
  });

  it('caps the buffer and drops the oldest points', async () => {
    const buffer = new LocationBuffer(memory());
    await buffer.push(Array.from({ length: MAX_BUFFERED + 50 }, (_, i) => point(i)));
    const all = await buffer.read();
    expect(all.length).toBe(MAX_BUFFERED);
    expect(all[0]?.recordedAt).toBe(point(50).recordedAt);
  });

  it('converts expo-location objects, ignoring invalid speed and heading', () => {
    const p = toPoint({ coords: { latitude: 40.1, longitude: 44.5, accuracy: 7, speed: -1, heading: -1 }, timestamp: Date.UTC(2026, 9, 21) });
    expect(p).toEqual({ lat: 40.1, lng: 44.5, accuracyM: 7, speedMps: null, heading: null, recordedAt: '2026-10-21T00:00:00.000Z' });
    expect(toPoint({ coords: { latitude: 0, longitude: 0, accuracy: null, speed: 12.5, heading: 370 }, timestamp: 0 }).heading).toBe(10);
  });
});
