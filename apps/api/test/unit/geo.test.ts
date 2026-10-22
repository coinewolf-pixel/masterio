import type { Env } from '../../src/config/env';
import { GeoService } from '../../src/geo/geo.service';

const env = { GOOGLE_MAPS_API_KEY: 'test-key' } as Env;

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  return jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const body = handler(String(input), init);
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
}

afterEach(() => jest.restoreAllMocks());

describe('GeoService (Google Places New)', () => {
  it('maps autocomplete suggestions and sends language and location bias', async () => {
    const spy = mockFetch(() => ({
      suggestions: [
        { placePrediction: { placeId: 'ChIJ_abcdefghij', structuredFormat: { mainText: { text: 'Abovyan St 1' }, secondaryText: { text: 'Yerevan, Armenia' } } } },
        { queryPrediction: { text: { text: 'ignored' } } },
      ],
    }));
    const res = await new GeoService(env).autocomplete('Abovyan', 'hy', { lat: 40.17, lng: 44.51 }, 'sess-1');
    expect(res).toEqual([{ placeId: 'ChIJ_abcdefghij', primary: 'Abovyan St 1', secondary: 'Yerevan, Armenia' }]);
    const init = spy.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ input: 'Abovyan', languageCode: 'hy', sessionToken: 'sess-1' });
    expect((init?.headers as Record<string, string>)['X-Goog-Api-Key']).toBe('test-key');
  });

  it('place details return coordinates; invalid place ids are rejected without a request', async () => {
    mockFetch(() => ({ id: 'ChIJ_abcdefghij', formattedAddress: 'Abovyan St 1, Yerevan', location: { latitude: 40.18, longitude: 44.51 } }));
    const svc = new GeoService(env);
    await expect(svc.place('ChIJ_abcdefghij', 'en')).resolves.toEqual({
      placeId: 'ChIJ_abcdefghij',
      formatted: 'Abovyan St 1, Yerevan',
      location: { lat: 40.18, lng: 44.51 },
    });
    await expect(svc.place('../../etc', 'en')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('reverse geocoding takes the first result', async () => {
    mockFetch(() => ({ status: 'OK', results: [{ formatted_address: 'Republic Square, Yerevan', place_id: 'P1' }] }));
    await expect(new GeoService(env).reverse(40.1776, 44.5126, 'ru')).resolves.toEqual({ formatted: 'Republic Square, Yerevan', placeId: 'P1' });
  });
});
