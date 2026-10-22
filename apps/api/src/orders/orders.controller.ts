import { Controller, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  clientCancelSchema,
  completeOrderSchema,
  confirmPaymentSchema,
  createOrderSchema,
  estimateSchema,
  expandRadiusSchema,
  paginationSchema,
  reviewSchema,
  workerCancelSchema,
  workerStatusSchema,
  CLIENT_CANCEL_REASONS,
} from '@masterio/shared';
import { CurrentUser, Roles, type AuthUser } from '../common/auth';
import { ApiZodBody, ZBody, ZodPipe, ZQuery } from '../common/zod';
import { LegalService } from '../legal/legal.service';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly legal: LegalService,
  ) {}

  @Post()
  @Roles('CLIENT')
  @ApiZodBody(createOrderSchema)
  async create(@CurrentUser() user: AuthUser, @ZBody(createOrderSchema) body: z.infer<typeof createOrderSchema>) {
    await this.legal.assertConsented(user, 'registration');
    return this.orders.create(user.id, body);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @ZQuery(paginationSchema) q: z.infer<typeof paginationSchema>) {
    return this.orders.list(user, q.limit, q.cursor);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(user, id);
  }

  @Get(':id/cancel-preview')
  @Roles('CLIENT')
  cancelPreview(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('reason', new ZodPipe(z.enum(CLIENT_CANCEL_REASONS))) reason: string,
  ) {
    return this.orders.cancelPreview(user.id, id, reason);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles('CLIENT')
  @ApiZodBody(clientCancelSchema)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ZBody(clientCancelSchema) body: z.infer<typeof clientCancelSchema>) {
    return this.orders.cancelByClient(user.id, id, body.reason, body.comment);
  }

  @Post(':id/worker-cancel')
  @HttpCode(200)
  @Roles('WORKER')
  @ApiZodBody(workerCancelSchema)
  workerCancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ZBody(workerCancelSchema) body: z.infer<typeof workerCancelSchema>) {
    return this.orders.cancelByWorker(user.id, id, body.reason, body.comment);
  }

  @Post(':id/restart-search')
  @HttpCode(200)
  @Roles('CLIENT')
  @ApiZodBody(expandRadiusSchema.partial())
  restart(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(expandRadiusSchema.partial()) body: Partial<z.infer<typeof expandRadiusSchema>>,
  ) {
    return this.orders.restartSearch(user.id, id, body.radiusM);
  }

  @Post(':id/status')
  @HttpCode(200)
  @Roles('WORKER')
  @ApiZodBody(workerStatusSchema)
  status(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ZBody(workerStatusSchema) body: z.infer<typeof workerStatusSchema>) {
    return this.orders.updateStatus(user.id, id, body.status, body.location);
  }

  @Post(':id/estimates')
  @Roles('WORKER')
  @ApiZodBody(estimateSchema)
  propose(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ZBody(estimateSchema) body: z.infer<typeof estimateSchema>) {
    return this.orders.proposeEstimate(user.id, id, body);
  }

  @Post(':id/estimates/:version/approve')
  @HttpCode(200)
  @Roles('CLIENT')
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('version', ParseIntPipe) version: number) {
    return this.orders.decideEstimate(user.id, id, version, true);
  }

  @Post(':id/estimates/:version/reject')
  @HttpCode(200)
  @Roles('CLIENT')
  reject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('version', ParseIntPipe) version: number) {
    return this.orders.decideEstimate(user.id, id, version, false);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @Roles('WORKER')
  @ApiZodBody(completeOrderSchema)
  complete(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ZBody(completeOrderSchema) body: z.infer<typeof completeOrderSchema>) {
    return this.orders.complete(user.id, id, body.cashReceivedCents, body.location);
  }

  @Post(':id/confirm-payment')
  @HttpCode(200)
  @Roles('CLIENT')
  @ApiZodBody(confirmPaymentSchema)
  confirm(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ZBody(confirmPaymentSchema) body: z.infer<typeof confirmPaymentSchema>) {
    return this.orders.confirmPayment(user.id, id, body.cashPaidCents);
  }

  @Post(':id/review')
  @HttpCode(200)
  @ApiZodBody(reviewSchema)
  review(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ZBody(reviewSchema) body: z.infer<typeof reviewSchema>) {
    return this.orders.review(user, id, body.rating, body.text);
  }
}
