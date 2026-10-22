import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { categoryGroupInputSchema, categoryInputSchema, cityCategoriesSchema, cityInputSchema } from '@masterio/shared';
import { AppException } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import { AdminRoles, CurrentUser, type AuthUser } from '../common/auth';
import { geoPoint } from '../common/geo';
import { ApiZodBody, ZodPipe } from '../common/zod';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient;

/**
 * Справочники (раздел 8): группы, категории и города с названиями на 5 языках. Смотрят все роли CRM,
 * меняет только superadmin. Удаления нет — заказы и статистика ссылаются на записи, их можно только выключить.
 */
@ApiTags('admin')
@ApiBearerAuth()
@AdminRoles('SUPPORT', 'MODERATOR', 'FINANCE')
@Controller('admin/catalog')
export class AdminCatalogController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async catalog() {
    const groups = await this.prisma.categoryGroup.findMany({
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      include: { categories: { orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] } },
    });
    const cities = await this.prisma.$queryRaw<
      Array<{ id: string; countryCode: string; names: unknown; timezone: string; currency: string; emergencyNumber: string; isActive: boolean; lat: number | null; lng: number | null }>
    >`SELECT "id", "countryCode", "names", "timezone", "currency", "emergencyNumber", "isActive",
             ST_Y("center"::geometry) AS lat, ST_X("center"::geometry) AS lng
      FROM "City" ORDER BY "countryCode", "id"`;
    const links = await this.prisma.cityCategory.findMany({ where: { isActive: true }, select: { cityId: true, categoryId: true } });
    return {
      groups,
      cities: cities.map(({ lat, lng, ...c }) => ({
        ...c,
        center: lat === null || lng === null ? null : { lat, lng },
        categoryIds: links.filter((l) => l.cityId === c.id).map((l) => l.categoryId),
      })),
    };
  }

  @Post('groups')
  @AdminRoles('SUPERADMIN')
  @ApiZodBody(categoryGroupInputSchema)
  async createGroup(@CurrentUser() admin: AuthUser, @Body(new ZodPipe(categoryGroupInputSchema)) body: z.infer<typeof categoryGroupInputSchema>) {
    return this.prisma.$transaction(async (tx) => {
      if (await tx.categoryGroup.findUnique({ where: { code: body.code } })) throw new AppException('ALREADY_EXISTS');
      const group = await tx.categoryGroup.create({ data: body });
      await this.log(tx, admin, 'catalog.group.create', 'CategoryGroup', group.id, null, body);
      return group;
    });
  }

  @Put('groups/:id')
  @AdminRoles('SUPERADMIN')
  @ApiZodBody(categoryGroupInputSchema)
  async updateGroup(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(categoryGroupInputSchema)) body: z.infer<typeof categoryGroupInputSchema>) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.categoryGroup.findUnique({ where: { id } });
      if (!before) throw new AppException('NOT_FOUND');
      if (before.code !== body.code && (await tx.categoryGroup.findUnique({ where: { code: body.code } }))) throw new AppException('ALREADY_EXISTS');
      const group = await tx.categoryGroup.update({ where: { id }, data: body });
      await this.log(tx, admin, 'catalog.group.update', 'CategoryGroup', id, before, body);
      return group;
    });
  }

  @Post('categories')
  @AdminRoles('SUPERADMIN')
  @ApiZodBody(categoryInputSchema)
  async createCategory(@CurrentUser() admin: AuthUser, @Body(new ZodPipe(categoryInputSchema)) body: z.infer<typeof categoryInputSchema>) {
    return this.prisma.$transaction(async (tx) => {
      if (await tx.category.findUnique({ where: { code: body.code } })) throw new AppException('ALREADY_EXISTS');
      if (!(await tx.categoryGroup.findUnique({ where: { id: body.groupId } }))) throw new AppException('VALIDATION_FAILED', { groupId: 'unknown group' });
      const category = await tx.category.create({ data: body });
      await this.log(tx, admin, 'catalog.category.create', 'Category', category.id, null, body);
      return category;
    });
  }

  @Put('categories/:id')
  @AdminRoles('SUPERADMIN')
  @ApiZodBody(categoryInputSchema)
  async updateCategory(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(categoryInputSchema)) body: z.infer<typeof categoryInputSchema>) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.category.findUnique({ where: { id } });
      if (!before) throw new AppException('NOT_FOUND');
      if (before.code !== body.code && (await tx.category.findUnique({ where: { code: body.code } }))) throw new AppException('ALREADY_EXISTS');
      if (!(await tx.categoryGroup.findUnique({ where: { id: body.groupId } }))) throw new AppException('VALIDATION_FAILED', { groupId: 'unknown group' });
      const category = await tx.category.update({ where: { id }, data: body });
      await this.log(tx, admin, 'catalog.category.update', 'Category', id, before, body);
      return category;
    });
  }

  @Post('cities')
  @AdminRoles('SUPERADMIN')
  @ApiZodBody(cityInputSchema)
  async createCity(@CurrentUser() admin: AuthUser, @Body(new ZodPipe(cityInputSchema)) body: z.infer<typeof cityInputSchema>) {
    return this.prisma.$transaction(async (tx) => {
      const city = await tx.city.create({
        data: { countryCode: body.countryCode, names: body.names, timezone: body.timezone, currency: body.currency, emergencyNumber: body.emergencyNumber, isActive: body.isActive },
      });
      await tx.$executeRaw`UPDATE "City" SET "center" = ${geoPoint(body.center)} WHERE "id" = ${city.id}::uuid`;
      await this.log(tx, admin, 'catalog.city.create', 'City', city.id, null, body);
      return { ...city, center: body.center };
    });
  }

  @Put('cities/:id')
  @AdminRoles('SUPERADMIN')
  @ApiZodBody(cityInputSchema)
  async updateCity(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cityInputSchema)) body: z.infer<typeof cityInputSchema>) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.city.findUnique({ where: { id } });
      if (!before) throw new AppException('NOT_FOUND');
      // валюту города с заказами менять нельзя: суммы старых заказов и проводки останутся в прежней валюте
      if (before.currency !== body.currency && (await tx.order.count({ where: { cityId: id } })) > 0) {
        throw new AppException('VALIDATION_FAILED', { currency: 'cannot change currency of a city with orders' });
      }
      const city = await tx.city.update({
        where: { id },
        data: { countryCode: body.countryCode, names: body.names, timezone: body.timezone, currency: body.currency, emergencyNumber: body.emergencyNumber, isActive: body.isActive },
      });
      await tx.$executeRaw`UPDATE "City" SET "center" = ${geoPoint(body.center)} WHERE "id" = ${id}::uuid`;
      await this.log(tx, admin, 'catalog.city.update', 'City', id, before, body);
      return { ...city, center: body.center };
    });
  }

  /** Какие услуги заказываются в городе: перечисленные включаются, остальные выключаются. */
  @Put('cities/:id/categories')
  @AdminRoles('SUPERADMIN')
  @ApiZodBody(cityCategoriesSchema)
  async cityCategories(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cityCategoriesSchema)) body: z.infer<typeof cityCategoriesSchema>) {
    const ids = [...new Set(body.categoryIds)];
    return this.prisma.$transaction(async (tx) => {
      if (!(await tx.city.findUnique({ where: { id } }))) throw new AppException('NOT_FOUND');
      const known = await tx.category.count({ where: { id: { in: ids } } });
      if (known !== ids.length) throw new AppException('VALIDATION_FAILED', { categoryIds: 'unknown category' });
      const before = await tx.cityCategory.findMany({ where: { cityId: id, isActive: true }, select: { categoryId: true } });
      await tx.cityCategory.updateMany({ where: { cityId: id, categoryId: { notIn: ids } }, data: { isActive: false } });
      for (const categoryId of ids) {
        await tx.cityCategory.upsert({
          where: { cityId_categoryId: { cityId: id, categoryId } },
          create: { cityId: id, categoryId, isActive: true },
          update: { isActive: true },
        });
      }
      await this.log(tx, admin, 'catalog.city.categories', 'City', id, { categoryIds: before.map((b) => b.categoryId) }, { categoryIds: ids });
      return { cityId: id, categoryIds: ids };
    });
  }

  private log(tx: Tx, admin: AuthUser, action: string, entityType: string, entityId: string, before: unknown, after: unknown): Promise<void> {
    return this.audit.log(
      {
        adminId: admin.id,
        action,
        entityType,
        entityId,
        ...(before === null ? {} : { before: JSON.parse(JSON.stringify(before)) as Prisma.InputJsonValue }),
        after: JSON.parse(JSON.stringify(after)) as Prisma.InputJsonValue,
      },
      tx,
    );
  }
}
