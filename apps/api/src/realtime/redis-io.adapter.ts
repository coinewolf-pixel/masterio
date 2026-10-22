import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { ServerOptions } from 'socket.io';
import { RedisFactory } from '../redis/redis.module';

/** Socket.IO через Redis: события доходят до клиентов, подключённых к любому инстансу API. */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;

  constructor(
    app: INestApplicationContext,
    private readonly corsOrigins: string[],
  ) {
    super(app);
    const factory = app.get(RedisFactory);
    this.adapterConstructor = createAdapter(factory.create(), factory.create());
  }

  override createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: this.corsOrigins, credentials: true },
      pingInterval: 10_000,
      pingTimeout: 8_000,
    }) as { adapter: (a: unknown) => void };
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}
