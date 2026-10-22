import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { AppException } from '../common/app-exception';

export interface PlaceSuggestion {
  placeId: string;
  primary: string;
  secondary: string;
}

export interface PlaceDetails {
  placeId: string;
  formatted: string;
  location: { lat: number; lng: number };
}

/**
 * Поиск адресов через Google Places (New) и обратное геокодирование. Запросы идут через сервер:
 * ключ Google не попадает в приложение, а частота ограничивается на пользователя.
 */
@Injectable()
export class GeoService {
  private readonly logger = new Logger(GeoService.name);

  constructor(@Inject(ENV) private readonly env: Env) {}

  private key(): string {
    if (!this.env.GOOGLE_MAPS_API_KEY) throw new AppException('FEATURE_DISABLED', { reason: 'maps_not_configured' });
    return this.env.GOOGLE_MAPS_API_KEY;
  }

  async autocomplete(input: string, language: string, near?: { lat: number; lng: number }, session?: string): Promise<PlaceSuggestion[]> {
    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': this.key() },
      body: JSON.stringify({
        input,
        languageCode: language,
        ...(session ? { sessionToken: session } : {}),
        ...(near ? { locationBias: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 30_000 } } } : {}),
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return this.fail(res);
    const json = (await res.json()) as {
      suggestions?: Array<{ placePrediction?: { placeId: string; structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } }; text?: { text: string } } }>;
    };
    return (json.suggestions ?? [])
      .map((s) => s.placePrediction)
      .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId))
      .slice(0, 8)
      .map((p) => ({
        placeId: p.placeId,
        primary: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
        secondary: p.structuredFormat?.secondaryText?.text ?? '',
      }));
  }

  async place(placeId: string, language: string, session?: string): Promise<PlaceDetails> {
    if (!/^[A-Za-z0-9_-]{10,300}$/.test(placeId)) throw new AppException('VALIDATION_FAILED', { placeId: 'invalid' });
    const url = new URL(`https://places.googleapis.com/v1/places/${placeId}`);
    url.searchParams.set('languageCode', language);
    if (session) url.searchParams.set('sessionToken', session);
    const res = await fetch(url, {
      headers: { 'X-Goog-Api-Key': this.key(), 'X-Goog-FieldMask': 'id,formattedAddress,location' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return this.fail(res);
    const json = (await res.json()) as { id: string; formattedAddress?: string; location?: { latitude: number; longitude: number } };
    if (!json.location) throw new AppException('NOT_FOUND');
    return { placeId: json.id, formatted: json.formattedAddress ?? '', location: { lat: json.location.latitude, lng: json.location.longitude } };
  }

  async reverse(lat: number, lng: number, language: string): Promise<{ formatted: string; placeId: string | null }> {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('latlng', `${lat},${lng}`);
    url.searchParams.set('language', language);
    url.searchParams.set('key', this.key());
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return this.fail(res);
    const json = (await res.json()) as { status: string; results?: Array<{ formatted_address: string; place_id: string }> };
    const first = json.results?.[0];
    if (json.status !== 'OK' || !first) return { formatted: '', placeId: null };
    return { formatted: first.formatted_address, placeId: first.place_id };
  }

  private async fail(res: Response): Promise<never> {
    this.logger.warn(`Google Maps API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    throw new AppException('INTERNAL', { reason: 'maps_unavailable' });
  }
}
