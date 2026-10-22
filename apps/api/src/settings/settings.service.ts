import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';
import {
  isSettingKey,
  parseSettingValue,
  settingDefault,
  SETTING_KEYS,
  SETTINGS,
  type SettingKey,
  type SettingValue,
} from '@masterio/shared';
import { AppException } from '../common/app-exception';
import { Prisma, type SettingScope } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisFactory } from '../redis/redis.module';

export interface SettingContext {
  countryCode?: string | null;
  cityId?: string | null;
  categoryId?: string | null;
}

const CHANNEL = 'masterio:settings:changed';

/**
 * Настройки без релиза. Все строки Setting держатся в памяти; при изменении любой инстанс API
 * получает сообщение через Redis pub/sub и перечитывает таблицу — новое значение действует сразу.
 */
@Injectable()
export class SettingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SettingsService.name);
  private cache = new Map<string, unknown>();
  private loaded = false;
  private subscriber: Redis | null = null;
  private publisher: Redis | null = null;
  private reloadStarted = 0;
  private reloadApplied = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisFactory,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
    this.publisher = this.redis.create();
    this.subscriber = this.redis.create();
    await this.subscriber.subscribe(CHANNEL);
    this.subscriber.on('message', () => {
      this.reload().catch((e: unknown) => this.logger.error(`settings reload failed: ${String(e)}`));
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber?.unsubscribe(CHANNEL).catch(() => undefined);
  }

  /**
   * Перечитать настройки. Перезагрузки идут параллельно (после своего изменения и по сообщению Redis от других
   * инстансов): результат применяется, только если никакая позже начатая перезагрузка ещё не применена —
   * иначе медленное чтение, начатое до записи, затёрло бы кэш устаревшими значениями.
   */
  async reload(): Promise<void> {
    const seq = ++this.reloadStarted;
    const rows = await this.prisma.setting.findMany();
    if (seq < this.reloadApplied) return;
    const next = new Map<string, unknown>();
    for (const row of rows) next.set(cacheKey(row.key, row.scope, row.scopeRef), row.value);
    this.reloadApplied = seq;
    this.cache = next;
    this.loaded = true;
  }

  /** Значение с учётом областей: CITY_CATEGORY → CATEGORY → CITY → COUNTRY → GLOBAL → default. */
  get<K extends SettingKey>(key: K, ctx: SettingContext = {}): SettingValue<K> {
    if (!this.loaded) throw new Error('SettingsService used before init');
    const candidates: Array<[SettingScope, string | null | undefined]> = [
      ['CITY_CATEGORY', ctx.cityId && ctx.categoryId ? `${ctx.cityId}:${ctx.categoryId}` : null],
      ['CATEGORY', ctx.categoryId],
      ['CITY', ctx.cityId],
      ['COUNTRY', ctx.countryCode],
      ['GLOBAL', ''],
    ];
    for (const [scope, ref] of candidates) {
      if (ref === null || ref === undefined) continue;
      const raw = this.cache.get(cacheKey(key, scope, ref));
      // null — переопределение снято админом: значение берётся из более общей области
      if (raw !== undefined && raw !== null) {
        const parsed = SETTINGS[key].schema.safeParse(raw);
        if (parsed.success) return parsed.data as SettingValue<K>;
        this.logger.warn(`invalid stored value for ${key} (${scope}:${ref}), using fallback`);
      }
    }
    return settingDefault(key);
  }

  /** Изменение настройки админом: проверка значения, история, мгновенное применение во всех инстансах. */
  async set(
    key: string,
    value: unknown,
    scope: SettingScope,
    scopeRef: string,
    adminId: string,
    comment?: string,
  ): Promise<void> {
    if (!isSettingKey(key)) throw new AppException('VALIDATION_FAILED', { key: 'unknown setting' });
    if ((scope === 'GLOBAL') !== (scopeRef === '')) {
      throw new AppException('VALIDATION_FAILED', { scopeRef: 'GLOBAL requires empty scopeRef, other scopes require it' });
    }
    let parsed: SettingValue<typeof key>;
    try {
      parsed = parseSettingValue(key, value);
    } catch {
      throw new AppException('VALIDATION_FAILED', { value: 'invalid value for setting' });
    }
    const json = parsed as Prisma.InputJsonValue;
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.setting.findUnique({ where: { key_scope_scopeRef: { key, scope, scopeRef } } });
      const row = await tx.setting.upsert({
        where: { key_scope_scopeRef: { key, scope, scopeRef } },
        create: { key, scope, scopeRef, value: json, updatedById: adminId },
        update: { value: json, updatedById: adminId },
      });
      await tx.settingHistory.create({
        data: {
          settingId: row.id,
          oldValue: (existing?.value ?? undefined) as Prisma.InputJsonValue | undefined,
          newValue: json,
          changedById: adminId,
          comment: comment ?? null,
        },
      });
    });
    await this.reload();
    await this.publisher?.publish(CHANNEL, key);
  }

  /** Снять переопределение для области (город, страна, категория): действует значение уровнем выше. История сохраняется. */
  async reset(key: string, scope: Exclude<SettingScope, 'GLOBAL'>, scopeRef: string, adminId: string, comment?: string): Promise<boolean> {
    if (!isSettingKey(key)) throw new AppException('VALIDATION_FAILED', { key: 'unknown setting' });
    const changed = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.setting.findUnique({ where: { key_scope_scopeRef: { key, scope, scopeRef } } });
      if (!existing || existing.value === null) return false;
      await tx.setting.update({ where: { id: existing.id }, data: { value: Prisma.JsonNull, updatedById: adminId } });
      await tx.settingHistory.create({
        data: { settingId: existing.id, oldValue: existing.value as Prisma.InputJsonValue, newValue: Prisma.JsonNull, changedById: adminId, comment: comment ?? null },
      });
      return true;
    });
    if (changed) {
      await this.reload();
      await this.publisher?.publish(CHANNEL, key);
    }
    return changed;
  }

  isFinanceKey(key: string): boolean {
    return isSettingKey(key) && SETTINGS[key].finance;
  }

  /** Все действующие глобальные значения (для экрана настроек админки). */
  listGlobal(): Record<string, unknown> {
    return Object.fromEntries(SETTING_KEYS.map((k) => [k, this.get(k)]));
  }

  listOverrides(): Array<{ key: string; scope: string; scopeRef: string; value: unknown }> {
    return [...this.cache.entries()].filter(([, value]) => value !== null).map(([ck, value]) => {
      const [key = '', scope = '', scopeRef = ''] = ck.split('|');
      return { key, scope, scopeRef, value };
    });
  }
}

function cacheKey(key: string, scope: SettingScope | string, ref: string): string {
  return `${key}|${scope}|${ref}`;
}
