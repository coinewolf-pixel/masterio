import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { adminDisputeActionSchema, disputeResponseSchema, DISPUTE_STATUSES, noShowSchema, openDisputeSchema, paginationSchema, type AdminDisputeAction } from '@masterio/shared';
import { AdminRoles, CurrentUser, Roles, type AuthUser } from '../common/auth';
import { ApiZodBody, ZBody, ZodPipe, ZQuery } from '../common/zod';
import { DisputesService } from './disputes.service';

/** Споры сторон заказа (раздел 18.5). */
@ApiTags('disputes')
@ApiBearerAuth()
@Controller()
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Post('orders/:id/disputes')
  @Roles('CLIENT', 'WORKER')
  @ApiZodBody(openDisputeSchema)
  open(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ZBody(openDisputeSchema) body: z.infer<typeof openDisputeSchema>) {
    return this.disputes.open(user, id, body);
  }

  @Post('orders/:id/no-show')
  @Roles('WORKER')
  @ApiZodBody(noShowSchema)
  noShow(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ZBody(noShowSchema) body: z.infer<typeof noShowSchema>) {
    return this.disputes.reportNoShow(user, id, body);
  }

  @Get('disputes')
  @Roles('CLIENT', 'WORKER')
  mine(@CurrentUser() user: AuthUser) {
    return this.disputes.listMine(user);
  }

  @Get('disputes/:id')
  @Roles('CLIENT', 'WORKER')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.disputes.getForParty(user, id);
  }

  @Post('disputes/:id/responses')
  @Roles('CLIENT', 'WORKER')
  @ApiZodBody(disputeResponseSchema)
  respond(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ZBody(disputeResponseSchema) body: z.infer<typeof disputeResponseSchema>) {
    return this.disputes.respond(user, id, body);
  }
}

const listQuery = paginationSchema.extend({
  status: z.enum(DISPUTE_STATUSES).optional(),
  assigneeId: z.uuid().optional(),
  mine: z.enum(['true', 'false']).optional(),
});

/** Споры в CRM: очередь, материалы (просмотр в журнал), действия поддержки. Возврат комиссии — только finance. */
@ApiTags('admin')
@ApiBearerAuth()
@AdminRoles('SUPPORT', 'MODERATOR', 'FINANCE')
@Controller('admin/disputes')
export class AdminDisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Get()
  list(@CurrentUser() admin: AuthUser, @ZQuery(listQuery) q: z.infer<typeof listQuery>) {
    return this.disputes.adminList({ ...q, adminId: admin.id });
  }

  @Get(':id')
  get(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.disputes.adminGet(admin, id);
  }

  @Post(':id/actions')
  @HttpCode(200)
  @ApiZodBody(adminDisputeActionSchema)
  action(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(adminDisputeActionSchema)) body: AdminDisputeAction) {
    return this.disputes.adminAction(admin, id, body);
  }
}
