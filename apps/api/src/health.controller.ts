import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type Redis from 'ioredis';
import { Public } from './common/auth';
import { PrismaService } from './prisma/prisma.service';
import { REDIS } from './redis/redis.module';

@ApiTags('health')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    const pong = await this.redis.ping();
    return { status: 'ok', db: 'ok', redis: pong === 'PONG' ? 'ok' : 'error', time: new Date().toISOString() };
  }
}
