import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { distanceMeters, type LatLng } from '@masterio/shared';
import { ENV, type Env } from '../config/env';
import { REDIS } from '../redis/redis.module';

/**
 * ETA до клиента. С ключом Google — Routes API (с учётом пробок), результат кэшируется на 45 с,
 * чтобы не платить за каждую точку. Без ключа или при ошибке — оценка по прямой (городская скорость, коэффициент маршрута).
 */
@Injectable()
export class EtaService {
  private readonly logger = new Logger(EtaService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async eta(orderId: string, from: LatLng, to: LatLng): Promise<{ etaSeconds: number; distanceM: number }> {
    const straight = distanceMeters(from, to);
    if (straight < 50) return { etaSeconds: 0, distanceM: straight };
    if (this.env.GOOGLE_MAPS_API_KEY) {
      const cacheKey = `eta:${orderId}`;
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        const c = JSON.parse(cached) as { etaSeconds: number; distanceM: number; straight: number };
        // масштабируем кэшированный маршрут пропорционально изменению расстояния по прямой
        const k = c.straight > 0 ? straight / c.straight : 1;
        return { etaSeconds: Math.round(c.etaSeconds * k), distanceM: Math.round(c.distanceM * k) };
      }
      try {
        const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': this.env.GOOGLE_MAPS_API_KEY,
            'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters',
          },
          body: JSON.stringify({
            origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
            destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
            travelMode: 'DRIVE',
            routingPreference: 'TRAFFIC_AWARE',
          }),
          signal: AbortSignal.timeout(3_000),
        });
        if (res.ok) {
          const json = (await res.json()) as { routes?: Array<{ duration?: string; distanceMeters?: number }> };
          const route = json.routes?.[0];
          if (route?.duration) {
            const result = { etaSeconds: Number.parseInt(route.duration, 10), distanceM: route.distanceMeters ?? straight };
            await this.redis.set(cacheKey, JSON.stringify({ ...result, straight }), 'EX', 45);
            return result;
          }
        } else {
          this.logger.warn(`Routes API ${res.status}`);
        }
      } catch (error) {
        this.logger.warn(`Routes API failed: ${String(error)}`);
      }
    }
    const roadDistance = Math.round(straight * 1.3);
    return { etaSeconds: Math.round(roadDistance / 6.9), distanceM: roadDistance };
  }
}
