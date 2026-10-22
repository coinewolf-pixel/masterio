import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ENV, type Env } from './config/env';
import { DispatchService } from './dispatch/dispatch.service';
import { JobsService } from './jobs/jobs.service';
import { PrismaService } from './prisma/prisma.service';
import { WalletService } from './wallet/wallet.service';

/** Запуск обработчиков очередей, периодических задач и восстановление рассылки после перезапуска. */
@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly jobs: JobsService,
    private readonly dispatch: DispatchService,
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.jobs.register('lots-expiry', async () => {
      await this.expireLots();
    });
    if (!this.env.QUEUE_WORKERS_ENABLED) return;
    this.jobs.startWorker();
    await this.jobs.repeat('tracking-watchdog', 20_000);
    await this.jobs.repeat('track-retention', 6 * 3_600_000);
    await this.jobs.repeat('lots-expiry', 3_600_000);
    await this.jobs.repeat('documents-expiry', 6 * 3_600_000);
    await this.jobs.repeat('bonus-monthly', 6 * 3_600_000);
    await this.dispatch.recover();
  }

  /** Сгорание просроченного приветственного кредита и бонусов (записи в ledger). */
  async expireLots(): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ ownerId: string; currency: string }>>`
      SELECT DISTINCT a."ownerId", a."currency" FROM "BalanceLot" l JOIN "LedgerAccount" a ON a."id" = l."accountId"
      WHERE l."remainingCents" > 0 AND l."expiresAt" <= now() AND a."ownerId" IS NOT NULL`;
    let burned = 0;
    for (const r of rows) {
      burned += await this.prisma.$transaction(async (tx) => {
        await this.wallet.lock(tx, r.ownerId);
        return this.wallet.burnExpiredLots(tx, r.ownerId, r.currency);
      });
    }
    if (burned > 0) this.logger.log(`expired lots: ${burned} cents`);
    return burned;
  }
}
