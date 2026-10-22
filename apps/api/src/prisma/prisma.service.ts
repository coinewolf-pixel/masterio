import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { ENV, type Env } from '../config/env';
import { Prisma, PrismaClient } from '../generated/prisma/client';

export type Tx = Prisma.TransactionClient;

/**
 * Колонки DateTime у Prisma — timestamp без часового пояса и хранят UTC. Сырые запросы с now() должны работать
 * в той же зоне, иначе на сервере БД с другим TimeZone время событий и проверки «свежести» геопозиции сдвигаются.
 */
export function pgConfig(connectionString: string): { connectionString: string; options: string } {
  return { connectionString, options: '-c TimeZone=UTC' };
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(ENV) env: Env) {
    super({ adapter: new PrismaPg(pgConfig(env.DATABASE_URL)) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

/** true, если ошибка — нарушение уникального индекса (в том числе частичного, созданного raw SQL). */
export function isUniqueViolation(error: unknown, indexName?: string): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    if (!indexName) return true;
    return JSON.stringify(error.meta ?? {}).includes(indexName) || error.message.includes(indexName);
  }
  const text = error instanceof Error ? error.message : String(error);
  return text.includes('23505') || (indexName !== undefined && text.includes(indexName) && text.includes('unique'));
}
