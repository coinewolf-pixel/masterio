import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';
import { AppException } from './app-exception';
import type { ErrorCode } from '@masterio/shared';

/** Счётчики с окном в Redis: SMS по телефону/устройству/IP, попытки ввода кода. */
@Injectable()
export class RateLimiter {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async hit(key: string, limit: number, windowSeconds: number, code: ErrorCode = 'RATE_LIMITED'): Promise<void> {
    const full = `rl:${key}`;
    const count = await this.redis.incr(full);
    if (count === 1) await this.redis.expire(full, windowSeconds);
    if (count > limit) throw new AppException(code);
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(`rl:${key}`);
  }
}
