import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { createTicketSchema, incidentSchema, paginationSchema, ticketMessageSchema, ticketUpdateSchema, TICKET_STATUSES } from '@masterio/shared';
import { AdminRoles, CurrentUser, Roles, type AuthUser } from '../common/auth';
import { ApiZodBody, ZBody, ZodPipe, ZQuery } from '../common/zod';
import { SupportService } from './support.service';

/** Поддержка для клиентов и мастеров и сообщение о несчастном случае по заказу. */
@ApiTags('support')
@ApiBearerAuth()
@Roles('CLIENT', 'WORKER')
@Controller()
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post('support/tickets')
  @ApiZodBody(createTicketSchema)
  create(@CurrentUser() user: AuthUser, @ZBody(createTicketSchema) body: z.infer<typeof createTicketSchema>) {
    return this.support.createTicket(user, body);
  }

  @Get('support/tickets')
  list(@CurrentUser() user: AuthUser) {
    return this.support.listMine(user);
  }

  @Get('support/tickets/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.support.getMine(user, id);
  }

  @Post('support/tickets/:id/messages')
  @ApiZodBody(ticketMessageSchema)
  post(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ZBody(ticketMessageSchema) body: z.infer<typeof ticketMessageSchema>) {
    return this.support.postMine(user, id, body.body);
  }

  @Post('orders/:id/incidents')
  @ApiZodBody(incidentSchema)
  incident(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ZBody(incidentSchema) body: z.infer<typeof incidentSchema>) {
    return this.support.reportIncident(user, id, body);
  }
}

const ticketsQuery = paginationSchema.extend({
  status: z.enum(TICKET_STATUSES).optional(),
  kind: z.enum(['dispute', 'incident', 'general']).optional(),
  mine: z.enum(['true', 'false']).optional(),
});

@ApiTags('admin')
@ApiBearerAuth()
@AdminRoles('SUPPORT', 'MODERATOR')
@Controller('admin')
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  @Get('tickets')
  list(@CurrentUser() admin: AuthUser, @ZQuery(ticketsQuery) q: z.infer<typeof ticketsQuery>) {
    return this.support.adminList({ ...q, adminId: admin.id });
  }

  @Get('tickets/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.support.adminGet(id);
  }

  @Post('tickets/:id/messages')
  @HttpCode(200)
  @ApiZodBody(ticketMessageSchema)
  post(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ZBody(ticketMessageSchema) body: z.infer<typeof ticketMessageSchema>) {
    return this.support.adminPost(admin, id, body.body, body.internal ?? false);
  }

  @Patch('tickets/:id')
  @ApiZodBody(ticketUpdateSchema)
  update(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ticketUpdateSchema)) body: z.infer<typeof ticketUpdateSchema>) {
    return this.support.adminUpdate(admin, id, body);
  }

  @Get('incidents')
  incidents(@ZQuery(paginationSchema) q: z.infer<typeof paginationSchema>) {
    return this.support.adminIncidents(q.limit, q.cursor);
  }

  @Get('incidents/:id')
  incident(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.support.adminIncident(admin, id);
  }
}
