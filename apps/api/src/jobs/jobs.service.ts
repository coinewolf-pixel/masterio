import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import { ENV, type Env } from '../config/env';
import { RedisFactory } from '../redis/redis.module';

export type JobHandler = (data: Record<string, string>) => Promise<void>;

const QUEUE_NAME = 'masterio';

/**
 * Отложенные и периодические задачи на BullMQ (Redis). Таймеры живут на сервере, переживают
 * перезапуск процесса (задачи хранятся в Redis с AOF) и выполняются ровно одним обработчиком.
 */
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private readonly handlers = new Map<string, JobHandler>();
  private queue!: Queue;
  private worker: Worker | null = null;

  constructor(
    private readonly redis: RedisFactory,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    this.queue = new Queue(QUEUE_NAME, {
      connection: this.redis.create({ forBullmq: true }),
      defaultJobOptions: { removeOnComplete: 1_000, removeOnFail: 5_000, attempts: 5, backoff: { type: 'exponential', delay: 1_000 } },
    });
  }

  /** Обработчики регистрируются сервисами в onModuleInit; запуск — после регистрации всех (onApplicationBootstrap в main). */
  register(name: string, handler: JobHandler): void {
    this.handlers.set(name, handler);
  }

  startWorker(): void {
    if (!this.env.QUEUE_WORKERS_ENABLED || this.worker) return;
    this.worker = new Worker(
      QUEUE_NAME,
      async (job: Job<Record<string, string>>) => {
        const handler = this.handlers.get(job.name);
        if (!handler) throw new Error(`no handler for job ${job.name}`);
        await handler(job.data);
      },
      { connection: this.redis.create({ forBullmq: true }), concurrency: 20 },
    );
    this.worker.on('failed', (job, err) => this.logger.error(`job ${job?.name}/${job?.id} failed: ${err.message}`));
  }

  async schedule(name: string, data: Record<string, string>, opts: { delayMs: number; jobId: string }): Promise<void> {
    await this.queue.add(name, data, { delay: Math.max(0, opts.delayMs), jobId: opts.jobId });
  }

  async cancel(jobId: string): Promise<void> {
    const job = await this.queue.getJob(jobId);
    if (!job) return;
    try {
      await job.remove();
    } catch {
      // задача уже выполняется — обработчик идемпотентен и проверит состояние сам
    }
  }

  async exists(jobId: string): Promise<boolean> {
    const job = await this.queue.getJob(jobId);
    if (!job) return false;
    const state = await job.getState();
    return state === 'delayed' || state === 'waiting' || state === 'active' || state === 'prioritized';
  }

  async repeat(name: string, everyMs: number): Promise<void> {
    await this.queue.upsertJobScheduler(`every-${name}`, { every: everyMs }, { name, data: {} });
  }

  /** Для тестов: дождаться, пока в очереди не останется готовых к выполнению задач. */
  async drainReady(timeoutMs = 10_000): Promise<void> {
    const start = Date.now();
    for (;;) {
      const counts = await this.queue.getJobCounts('waiting', 'active', 'prioritized');
      if ((counts.waiting ?? 0) + (counts.active ?? 0) + (counts.prioritized ?? 0) === 0) return;
      if (Date.now() - start > timeoutMs) throw new Error('queue did not drain');
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  async stopWorker(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
  }

  async onModuleDestroy(): Promise<void> {
    await this.stopWorker();
    await this.queue?.close();
  }
}

/** BullMQ не допускает «:» в собственных id задач. */
export function jobId(...parts: string[]): string {
  return parts.join('_');
}
