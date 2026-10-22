/*
 * Профиль запуска в Армении: города, денежные настройки в драмах (AMD) на уровне страны, отключение городов других
 * стран, где ещё нет заказов. Запуск после seed: `pnpm launch:am`. Повторный запуск безопасен; каждое изменение
 * настройки пишется в историю от имени первого суперадмина (SEED_ADMIN_EMAIL).
 *
 * Суммы — в минимальных единицах AMD (лума, 1/100 драма), как и везде в системе. Значения пересчитаны с настроек
 * по умолчанию (EUR) по курсу ~408 AMD за евро (октябрь 2026) и округлены. Это стартовые значения: finance меняет
 * их в CRM → «Настройки» без релиза.
 */
import 'dotenv/config';
import { isDeepStrictEqual } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { parseSettingValue, type SettingKey } from '@masterio/shared';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client';
import { pgConfig } from '../src/prisma/prisma.service';

type Names = { en: string; ru: string; de: string; es: string; hy: string };

const AMD = (dram: number) => dram * 100;

export const AM_COUNTRY = 'AM';

/** Денежные настройки страны в AMD. Немонетарные (комиссия 20 %, таймеры, радиусы) остаются общими. */
export const AM_SETTINGS: Partial<Record<SettingKey, unknown>> = {
  CASH_MIN_BALANCE: AMD(8_000),
  CASH_DEBT_LIMIT: AMD(12_000),
  CASH_MAX_ORDER_AMOUNT: AMD(200_000),
  CASH_MAX_ORDER_AMOUNT_NEW_WORKER: AMD(80_000),
  EXPECTED_ORDER_AMOUNT: AMD(30_000),
  CLIENT_CANCEL_PENALTY: { ACCEPTED: AMD(1_000), EN_ROUTE: AMD(3_000), ARRIVED: 0 },
  TRAVEL_COMPENSATION: AMD(6_000),
  WELCOME_PRESETS: [AMD(20_000), AMD(40_000)],
  GRANT_MAX_PER_WORKER: AMD(40_000),
  GRANT_SECOND_APPROVAL_ABOVE: AMD(40_000),
  GRANT_FINANCE_DAILY_LIMIT: AMD(200_000),
  TOPUP_MIN_AMOUNT: AMD(4_000),
  TOPUP_MAX_AMOUNT: AMD(200_000),
  // на старте карты клиентов и выплаты выключены (раздел 22); наличные и пополнение мастеров — включены
  CASH_ENABLED: true,
  CARD_PAYMENTS_ENABLED: false,
  PAYOUTS_ENABLED: false,
  WORKER_TOPUP_ENABLED: true,
  TEAMS_ENABLED: true,
};

/** Города запуска. Ереван уже есть в seed; остальные — крупнейшие города страны. Экстренный номер — единый 112. */
export const AM_CITIES: Array<{ names: Names; lat: number; lng: number }> = [
  { names: { en: 'Yerevan', ru: 'Ереван', de: 'Jerewan', es: 'Ereván', hy: 'Երևան' }, lat: 40.1776, lng: 44.5126 },
  { names: { en: 'Gyumri', ru: 'Гюмри', de: 'Gjumri', es: 'Guiumri', hy: 'Գյումրի' }, lat: 40.7894, lng: 43.8475 },
  { names: { en: 'Vanadzor', ru: 'Ванадзор', de: 'Wanadsor', es: 'Vanadzor', hy: 'Վանաձոր' }, lat: 40.8128, lng: 44.4883 },
  { names: { en: 'Vagharshapat', ru: 'Вагаршапат', de: 'Wagharschapat', es: 'Vagharshapat', hy: 'Վաղարշապատ' }, lat: 40.1655, lng: 44.2925 },
  { names: { en: 'Abovyan', ru: 'Абовян', de: 'Abowjan', es: 'Abovián', hy: 'Աբովյան' }, lat: 40.2739, lng: 44.6256 },
  { names: { en: 'Hrazdan', ru: 'Раздан', de: 'Hrasdan', es: 'Hrazdan', hy: 'Հրազդան' }, lat: 40.497, lng: 44.7662 },
  { names: { en: 'Kapan', ru: 'Капан', de: 'Kapan', es: 'Kapán', hy: 'Կապան' }, lat: 39.2076, lng: 46.4058 },
];

export interface LaunchReport {
  citiesCreated: string[];
  citiesDisabled: string[];
  settingsChanged: string[];
}

export async function applyArmeniaLaunch(prisma: PrismaClient, adminId: string, log: (s: string) => void = () => undefined): Promise<LaunchReport> {
  const report: LaunchReport = { citiesCreated: [], citiesDisabled: [], settingsChanged: [] };
  const categories = await prisma.category.findMany({ where: { isActive: true }, select: { id: true } });

  for (const c of AM_CITIES) {
    const existing = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "City" WHERE "countryCode" = ${AM_COUNTRY} AND "names"->>'en' = ${c.names.en}`;
    let cityId = existing[0]?.id;
    if (!cityId) {
      const city = await prisma.city.create({ data: { countryCode: AM_COUNTRY, currency: 'AMD', timezone: 'Asia/Yerevan', names: c.names, emergencyNumber: '112' } });
      cityId = city.id;
      report.citiesCreated.push(c.names.en);
    }
    await prisma.$executeRaw`UPDATE "City" SET "center" = ST_SetSRID(ST_MakePoint(${c.lng}, ${c.lat}), 4326)::geography, "isActive" = true WHERE "id" = ${cityId}::uuid`;
    await prisma.cityCategory.createMany({ data: categories.map((cat) => ({ cityId: cityId as string, categoryId: cat.id })), skipDuplicates: true });
  }

  // города других стран из seed прячутся, пока в них нет заказов (их можно включить в CRM)
  const foreign = await prisma.city.findMany({ where: { countryCode: { not: AM_COUNTRY }, isActive: true }, select: { id: true, names: true, _count: { select: { orders: true } } } });
  for (const city of foreign) {
    if (city._count.orders > 0) continue;
    await prisma.city.update({ where: { id: city.id }, data: { isActive: false } });
    report.citiesDisabled.push((city.names as Names).en);
  }

  for (const [key, raw] of Object.entries(AM_SETTINGS) as Array<[SettingKey, unknown]>) {
    const value = parseSettingValue(key, raw) as Prisma.InputJsonValue;
    const where = { key_scope_scopeRef: { key, scope: 'COUNTRY' as const, scopeRef: AM_COUNTRY } };
    const existing = await prisma.setting.findUnique({ where });
    // jsonb хранит ключи объекта в своём порядке — сравниваем по содержимому
    if (existing && isDeepStrictEqual(existing.value, value)) continue;
    await prisma.$transaction(async (tx) => {
      const row = await tx.setting.upsert({
        where,
        create: { key, scope: 'COUNTRY', scopeRef: AM_COUNTRY, value, updatedById: adminId },
        update: { value, updatedById: adminId },
      });
      await tx.settingHistory.create({
        data: { settingId: row.id, oldValue: (existing?.value ?? undefined) as Prisma.InputJsonValue | undefined, newValue: value, changedById: adminId, comment: 'launch profile: Armenia (AMD)' },
      });
    });
    report.settingsChanged.push(key);
  }

  log(`cities created: ${report.citiesCreated.join(', ') || '—'}`);
  log(`cities hidden: ${report.citiesDisabled.join(', ') || '—'}`);
  log(`settings for AM: ${report.settingsChanged.join(', ') || 'already up to date'}`);
  return report;
}

if (require.main === module) {
  const prisma = new PrismaClient({ adapter: new PrismaPg(pgConfig(process.env.DATABASE_URL ?? '')) });
  const run = async () => {
    const email = process.env.SEED_ADMIN_EMAIL;
    const admin = email ? await prisma.user.findUnique({ where: { email } }) : null;
    if (!admin) throw new Error('Run the seed first and set SEED_ADMIN_EMAIL: changes are recorded in the settings history under that admin.');
    await applyArmeniaLaunch(prisma, admin.id, (s) => console.log(`[launch:am] ${s}`));
    // работающие инстансы API перечитают настройки по сообщению в Redis при следующем изменении или перезапуске
    console.log('[launch:am] done. Restart the API service so all instances load the new settings.');
  };
  run()
    .then(() => prisma.$disconnect())
    .catch(async (e: unknown) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
