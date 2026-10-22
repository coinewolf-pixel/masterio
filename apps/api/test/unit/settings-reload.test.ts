/**
 * Гонка перезагрузок настроек: чтение, начатое до записи и закончившееся позже, не должно затирать свежий кэш.
 * Раньше это давало редкие «случайные» падения тестов и в продакшене могло вернуть старое значение после двух
 * быстрых изменений настройки.
 */
import { SettingsService } from '../../src/settings/settings.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { RedisFactory } from '../../src/redis/redis.module';

type Row = { key: string; scope: string; scopeRef: string; value: unknown };

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('SettingsService.reload', () => {
  it('ignores a slower reload that started before a newer one', async () => {
    const calls: Array<ReturnType<typeof deferred<Row[]>>> = [];
    const prisma = { setting: { findMany: () => { const d = deferred<Row[]>(); calls.push(d); return d.promise; } } } as unknown as PrismaService;
    const service = new SettingsService(prisma, {} as RedisFactory);

    const stale = service.reload(); // начато до записи
    const fresh = service.reload(); // начато после записи
    calls[1]!.resolve([{ key: 'CASH_ENABLED', scope: 'GLOBAL', scopeRef: '', value: false }]);
    await fresh;
    calls[0]!.resolve([]); // старое чтение пришло последним
    await stale;

    expect(service.get('CASH_ENABLED')).toBe(false);
  });

  it('applies reloads that finish in order', async () => {
    const values: Row[][] = [[{ key: 'CASH_ENABLED', scope: 'GLOBAL', scopeRef: '', value: false }], []];
    const prisma = { setting: { findMany: () => Promise.resolve(values.shift() ?? []) } } as unknown as PrismaService;
    const service = new SettingsService(prisma, {} as RedisFactory);
    await service.reload();
    expect(service.get('CASH_ENABLED')).toBe(false);
    await service.reload();
    expect(service.get('CASH_ENABLED')).toBe(true);
  });
});
