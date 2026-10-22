/* Seed: группы и категории (5 языков), стартовые города, ступени бонусов, первый superadmin. Повторный запуск безопасен. */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { DEFAULT_BONUS_TIERS } from '@masterio/shared';
import { PiiCipher } from '../src/common/crypto';
import { PrismaClient } from '../src/generated/prisma/client';
import { pgConfig } from '../src/prisma/prisma.service';

type Names = { en: string; ru: string; de: string; es: string; hy: string };

const GROUPS: Array<{ code: string; names: Names; categories: Array<{ code: string; names: Names; urgent?: boolean; license?: boolean }> }> = [
  {
    code: 'auto',
    names: { en: 'Car', ru: 'Авто', de: 'Auto', es: 'Coche', hy: 'Ավտո' },
    categories: [
      { code: 'car_mechanic', names: { en: 'Car mechanic', ru: 'Автомеханик', de: 'Kfz-Mechaniker', es: 'Mecánico', hy: 'Ավտոմեխանիկ' } },
      { code: 'tire_service', names: { en: 'Tire service', ru: 'Шиномонтаж', de: 'Reifenservice', es: 'Neumáticos', hy: 'Անվադողերի սպասարկում' } },
      { code: 'tow_truck', names: { en: 'Tow truck', ru: 'Эвакуатор', de: 'Abschleppdienst', es: 'Grúa', hy: 'Էվակուատոր' }, urgent: true },
      { code: 'auto_electrician', names: { en: 'Auto electrician', ru: 'Автоэлектрик', de: 'Kfz-Elektriker', es: 'Electricista de coches', hy: 'Ավտոէլեկտրիկ' } },
      { code: 'roadside_assistance', names: { en: 'Roadside assistance', ru: 'Помощь на дороге', de: 'Pannenhilfe', es: 'Asistencia en carretera', hy: 'Ճանապարհային օգնություն' }, urgent: true },
    ],
  },
  {
    code: 'home',
    names: { en: 'Home', ru: 'Дом', de: 'Zuhause', es: 'Hogar', hy: 'Տուն' },
    categories: [
      { code: 'electrician', names: { en: 'Electrician', ru: 'Электрик', de: 'Elektriker', es: 'Electricista', hy: 'Էլեկտրիկ' }, license: true },
      { code: 'plumber', names: { en: 'Plumber', ru: 'Сантехник', de: 'Klempner', es: 'Fontanero', hy: 'Սանտեխնիկ' } },
      { code: 'painter', names: { en: 'Painter', ru: 'Маляр', de: 'Maler', es: 'Pintor', hy: 'Ներկարար' } },
      { code: 'tiler', names: { en: 'Tiler', ru: 'Плиточник', de: 'Fliesenleger', es: 'Alicatador', hy: 'Սալիկապատող' } },
      { code: 'handyman', names: { en: 'Handyman', ru: 'Мастер на час', de: 'Handwerker', es: 'Manitas', hy: 'Ունիվերսալ վարպետ' } },
      { code: 'appliance_repair', names: { en: 'Appliance repair', ru: 'Ремонт техники', de: 'Gerätereparatur', es: 'Reparación de electrodomésticos', hy: 'Տեխնիկայի վերանորոգում' } },
      { code: 'air_conditioning', names: { en: 'Air conditioning', ru: 'Кондиционеры', de: 'Klimaanlagen', es: 'Aire acondicionado', hy: 'Օդորակիչներ' } },
      { code: 'cleaning', names: { en: 'Cleaning', ru: 'Уборка', de: 'Reinigung', es: 'Limpieza', hy: 'Մաքրում' } },
      { code: 'windows_doors', names: { en: 'Windows and doors', ru: 'Окна и двери', de: 'Fenster und Türen', es: 'Ventanas y puertas', hy: 'Պատուհաններ և դռներ' } },
    ],
  },
  {
    code: 'urgent',
    names: { en: 'Urgent', ru: 'Срочные', de: 'Notdienst', es: 'Urgentes', hy: 'Շտապ' },
    categories: [
      { code: 'lockout', names: { en: 'Lockout (lost or locked-in key)', ru: 'Вскрытие замков', de: 'Türöffnung', es: 'Apertura de cerraduras', hy: 'Կողպեքների բացում' }, urgent: true },
      { code: 'lock_replacement', names: { en: 'Lock replacement', ru: 'Замена замков', de: 'Schlosswechsel', es: 'Cambio de cerradura', hy: 'Կողպեքների փոխարինում' }, urgent: true },
    ],
  },
  {
    code: 'moving',
    names: { en: 'Moving', ru: 'Переезд', de: 'Umzug', es: 'Mudanza', hy: 'Տեղափոխություն' },
    categories: [
      { code: 'movers', names: { en: 'Movers', ru: 'Грузчики', de: 'Umzugshelfer', es: 'Mozos de mudanza', hy: 'Բեռնակիրներ' } },
      { code: 'transport', names: { en: 'Transport', ru: 'Перевозки', de: 'Transport', es: 'Transporte', hy: 'Բեռնափոխադրում' } },
    ],
  },
  {
    code: 'extra',
    names: { en: 'More', ru: 'Дополнительно', de: 'Weitere', es: 'Más', hy: 'Լրացուցիչ' },
    categories: [
      { code: 'gardener', names: { en: 'Gardener', ru: 'Садовник', de: 'Gärtner', es: 'Jardinero', hy: 'Այգեպան' } },
      { code: 'gates_garage_doors', names: { en: 'Gates and garage doors', ru: 'Ворота и гаражные двери', de: 'Tore und Garagentore', es: 'Portones y puertas de garaje', hy: 'Դարպասներ և ավտոտնակի դռներ' } },
    ],
  },
];

const CITIES = [
  { key: 'yerevan', countryCode: 'AM', currency: 'AMD', timezone: 'Asia/Yerevan', lat: 40.1776, lng: 44.5126, emergency: '112', names: { en: 'Yerevan', ru: 'Ереван', de: 'Jerewan', es: 'Ereván', hy: 'Երևան' } },
  { key: 'berlin', countryCode: 'DE', currency: 'EUR', timezone: 'Europe/Berlin', lat: 52.52, lng: 13.405, emergency: '112', names: { en: 'Berlin', ru: 'Берлин', de: 'Berlin', es: 'Berlín', hy: 'Բեռլին' } },
  { key: 'madrid', countryCode: 'ES', currency: 'EUR', timezone: 'Europe/Madrid', lat: 40.4168, lng: -3.7038, emergency: '112', names: { en: 'Madrid', ru: 'Мадрид', de: 'Madrid', es: 'Madrid', hy: 'Մադրիդ' } },
  { key: 'vienna', countryCode: 'AT', currency: 'EUR', timezone: 'Europe/Vienna', lat: 48.2082, lng: 16.3738, emergency: '112', names: { en: 'Vienna', ru: 'Вена', de: 'Wien', es: 'Viena', hy: 'Վիեննա' } },
];

export async function seed(prisma: PrismaClient, opts: { log?: boolean } = {}): Promise<void> {
  const log = (m: string) => opts.log !== false && console.log(m);

  for (const [gi, g] of GROUPS.entries()) {
    const group = await prisma.categoryGroup.upsert({
      where: { code: g.code },
      create: { code: g.code, names: g.names, sortOrder: gi },
      update: { names: g.names, sortOrder: gi },
    });
    for (const [ci, c] of g.categories.entries()) {
      await prisma.category.upsert({
        where: { code: c.code },
        create: { code: c.code, groupId: group.id, names: c.names, isUrgent: c.urgent ?? false, requiresLicense: c.license ?? false, sortOrder: ci },
        update: { groupId: group.id, names: c.names, isUrgent: c.urgent ?? false },
      });
    }
  }
  log(`categories: ${GROUPS.reduce((s, g) => s + g.categories.length, 0)}`);

  const categories = await prisma.category.findMany();
  for (const c of CITIES) {
    const existing = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "City" WHERE "countryCode" = ${c.countryCode} AND "names"->>'en' = ${c.names.en}`;
    let cityId = existing[0]?.id;
    if (!cityId) {
      const city = await prisma.city.create({
        data: { countryCode: c.countryCode, currency: c.currency, timezone: c.timezone, names: c.names, emergencyNumber: c.emergency },
      });
      cityId = city.id;
    }
    await prisma.$executeRaw`UPDATE "City" SET "center" = ST_SetSRID(ST_MakePoint(${c.lng}, ${c.lat}), 4326)::geography WHERE "id" = ${cityId}::uuid`;
    await prisma.cityCategory.createMany({ data: categories.map((cat) => ({ cityId: cityId as string, categoryId: cat.id })), skipDuplicates: true });
  }
  log(`cities: ${CITIES.length}`);

  if ((await prisma.bonusRule.count()) === 0) {
    await prisma.bonusRule.createMany({
      data: DEFAULT_BONUS_TIERS.map((t) => ({ name: t.name, minOrders: t.minOrders, maxOrders: t.maxOrders, percentBp: t.percentBp })),
    });
    log('bonus rules: default tiers');
  }

  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  const key = process.env.PII_ENCRYPTION_KEY;
  if (email && password && key) {
    const exists = await prisma.user.findUnique({ where: { email } });
    if (!exists) {
      const secret = authenticator.generateSecret();
      const cipher = new PiiCipher(key);
      await prisma.user.create({
        data: {
          role: 'ADMIN',
          email,
          countryCode: process.env.SEED_ADMIN_COUNTRY ?? 'AM',
          admin: {
            create: {
              subRoles: ['SUPERADMIN'],
              passwordHash: await bcrypt.hash(password, 12),
              totpSecretEnc: cipher.encrypt(secret),
            },
          },
        },
      });
      log(`superadmin created: ${email}`);
      log(`add to an authenticator app: ${authenticator.keyuri(email, 'Masterio CRM', secret)}`);
    }
  }
}

if (require.main === module) {
  const prisma = new PrismaClient({ adapter: new PrismaPg(pgConfig(process.env.DATABASE_URL ?? '')) });
  seed(prisma)
    .then(() => prisma.$disconnect())
    .catch(async (e: unknown) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
