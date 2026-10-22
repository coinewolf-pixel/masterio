import { Global, Inject, Injectable, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV, type Env } from '../config/env';

export const REDIS = Symbol('REDIS');

/** Создаёт отдельные соединения (BullMQ и pub/sub требуют собственных). */
@Injectable()
export class RedisFactory implements OnApplicationShutdown {
  private readonly logger = new Logger('Redis');
  private readonly connections: Redis[] = [];

  constructor(@Inject(ENV) private readonly env: Env) {}

  create(options: { forBullmq?: boolean } = {}): Redis {
    const conn = new Redis(this.env.REDIS_URL, {
      maxRetriesPerRequest: options.forBullmq ? null : 20,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    conn.on('error', (err: Error) => this.logger.warn(`redis: ${err.message}`));
    this.connections.push(conn);
    return conn;
  }

  /** Закрываем соединения последними — после остановки очередей и подписок. */
  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.connections.map((c) => c.quit().catch(() => c.disconnect())));
  }
}

@Global()
@Module({
  providers: [
    RedisFactory,
    {
      provide: REDIS,
      inject: [RedisFactory],
      useFactory: (factory: RedisFactory) => factory.create(),
    },
  ],
  exports: [REDIS, RedisFactory],
})
export class RedisModule {}
