import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles, type AuthUser } from '../common/auth';
import { PrismaService } from '../prisma/prisma.service';
import { DispatchService } from './dispatch.service';

@ApiTags('offers')
@ApiBearerAuth()
@Roles('WORKER')
@Controller('offers')
export class OffersController {
  constructor(
    private readonly dispatch: DispatchService,
    private readonly prisma: PrismaService,
  ) {}

  /** Активное предложение (если приложение открыли по push). Время — серверное. */
  @Get('current')
  async current(@CurrentUser() user: AuthUser) {
    const offer = await this.prisma.offer.findFirst({
      where: { workerId: user.id, status: 'PENDING', expiresAt: { gt: new Date() } },
      include: { order: { include: { category: true } } },
    });
    if (!offer) return { offer: null, serverNow: new Date().toISOString() };
    return {
      serverNow: new Date().toISOString(),
      offer: {
        offerId: offer.id,
        orderId: offer.orderId,
        categoryId: offer.order.categoryId,
        categoryCode: offer.order.category.code,
        distanceM: offer.distanceM,
        description: offer.order.description,
        paymentMethod: offer.order.paymentMethod,
        isUrgent: offer.order.category.isUrgent,
        expiresAt: offer.expiresAt.toISOString(),
      },
    };
  }

  @Post(':id/accept')
  @HttpCode(200)
  accept(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.dispatch.accept(id, user.id);
  }

  @Post(':id/decline')
  @HttpCode(204)
  async decline(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.dispatch.decline(id, user.id);
  }
}
