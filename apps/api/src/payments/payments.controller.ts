import { Controller, Headers, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { z } from 'zod';
import { topupSchema } from '@masterio/shared';
import { AppException } from '../common/app-exception';
import { CurrentUser, Public, Roles, type AuthUser } from '../common/auth';
import { ApiZodBody, ZBody } from '../common/zod';
import { LegalService } from '../legal/legal.service';
import { TeamsService } from '../teams/teams.service';
import { PaymentsService } from './payments.service';
import { STRIPE_GATEWAY, type StripeGateway } from './stripe.gateway';

@ApiTags('payments')
@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway,
    private readonly legal: LegalService,
    private readonly teams: TeamsService,
  ) {}

  @Post('wallet/topups')
  @ApiBearerAuth()
  @Roles('WORKER')
  @ApiZodBody(topupSchema)
  async createTopup(
    @CurrentUser() user: AuthUser,
    @ZBody(topupSchema) body: z.infer<typeof topupSchema>,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    // баланс и комиссия — по аккаунту руководителя команды; участник не пополняет
    await this.teams.assertNotMember(user.id);
    await this.legal.assertConsented(user, 'topup');
    return this.payments.createTopup(user.id, body.amountCents, idempotencyKey);
  }

  @Post('webhooks/stripe')
  @Public()
  @SkipThrottle()
  @HttpCode(200)
  async webhook(@Req() req: Request & { rawBody?: Buffer }, @Headers('stripe-signature') signature?: string) {
    if (!req.rawBody || !signature) throw new AppException('VALIDATION_FAILED');
    let event;
    try {
      event = this.stripe.constructEvent(req.rawBody, signature);
    } catch {
      throw new AppException('FORBIDDEN', { reason: 'invalid_signature' });
    }
    const result = await this.payments.handleEvent(event);
    return { received: true, duplicate: result.duplicate };
  }
}
