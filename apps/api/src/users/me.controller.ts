import { Controller, Get, HttpCode, Inject, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { registerDeviceSchema, updateMeSchema } from '@masterio/shared';
import { CurrentUser, type AuthUser } from '../common/auth';
import { PII_CIPHER, PiiCipher } from '../common/crypto';
import { ApiZodBody, ZBody } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PII_CIPHER) private readonly pii: PiiCipher,
  ) {}

  @Get()
  async me(@CurrentUser() auth: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: auth.id },
      include: { worker: { include: { categories: true, cities: true } }, client: true },
    });
    const membership = u.role === 'WORKER' ? await this.prisma.teamMember.findFirst({ where: { userId: u.id, isActive: true, role: { not: 'LEADER' } }, include: { team: true } }) : null;
    const ownTeam = u.role === 'WORKER' && !membership ? await this.prisma.team.findUnique({ where: { ownerId: u.id }, select: { id: true, name: true } }) : null;
    const pendingInvites =
      u.role === 'WORKER' && u.phone ? await this.prisma.teamInvite.count({ where: { phone: u.phone, status: 'PENDING', expiresAt: { gt: new Date() } } }) : 0;
    return {
      id: u.id,
      role: u.role,
      // режим Masterio Pro: участник чужой команды работает только по назначениям руководителя
      team: membership
        ? { mode: 'member' as const, teamId: membership.team.id, name: membership.team.name, role: membership.role }
        : ownTeam
          ? { mode: 'owner' as const, teamId: ownTeam.id, name: ownTeam.name, role: 'LEADER' as const }
          : null,
      pendingInvites,
      phone: u.phone,
      firstName: this.pii.decrypt(u.firstNameEnc),
      lastName: this.pii.decrypt(u.lastNameEnc),
      locale: u.locale,
      countryCode: u.countryCode,
      status: u.status,
      worker: u.worker
        ? {
            type: u.worker.type,
            kycStatus: u.worker.kycStatus,
            isOnline: u.worker.isOnline,
            ratingAvg: Number(u.worker.ratingAvg),
            ratingCount: u.worker.ratingCount,
            preferredRadiusM: u.worker.preferredRadiusM,
            autoUseEarnings: u.worker.autoUseEarnings,
            companyName: u.worker.companyName,
            categoryIds: u.worker.categories.map((c) => c.categoryId),
            cityIds: u.worker.cities.map((c) => c.cityId),
          }
        : null,
    };
  }

  @Patch()
  @ApiZodBody(updateMeSchema)
  async update(@CurrentUser() auth: AuthUser, @ZBody(updateMeSchema) body: z.infer<typeof updateMeSchema>) {
    await this.prisma.user.update({
      where: { id: auth.id },
      data: {
        ...(body.firstName !== undefined ? { firstNameEnc: this.pii.encrypt(body.firstName) } : {}),
        ...(body.lastName !== undefined ? { lastNameEnc: this.pii.encrypt(body.lastName) } : {}),
        ...(body.locale !== undefined ? { locale: body.locale } : {}),
      },
    });
    return this.me(auth);
  }

  @Post('devices')
  @HttpCode(204)
  @ApiZodBody(registerDeviceSchema)
  async device(@CurrentUser() auth: AuthUser, @ZBody(registerDeviceSchema) body: z.infer<typeof registerDeviceSchema>): Promise<void> {
    if (body.pushToken) {
      // токен принадлежит одному устройству: снимаем его с других аккаунтов
      await this.prisma.device.updateMany({ where: { pushToken: body.pushToken, NOT: { userId: auth.id } }, data: { pushToken: null } });
    }
    await this.prisma.device.upsert({
      where: { userId_fingerprint: { userId: auth.id, fingerprint: body.deviceId } },
      create: {
        userId: auth.id,
        fingerprint: body.deviceId,
        platform: body.platform,
        pushToken: body.pushToken ?? null,
        appVersion: body.appVersion ?? null,
      },
      update: { platform: body.platform, pushToken: body.pushToken ?? null, appVersion: body.appVersion ?? null, lastSeenAt: new Date() },
    });
  }
}
