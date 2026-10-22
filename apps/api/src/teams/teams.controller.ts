import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { assignPerformerSchema, performerChangeDecisionSchema, performerMismatchSchema, teamInviteSchema, teamNameSchema } from '@masterio/shared';
import { AdminRoles, CurrentUser, Roles, type AuthUser } from '../common/auth';
import { ApiZodBody, ZBody, ZQuery } from '../common/zod';
import { TeamsService } from './teams.service';

const eventsQuery = z.object({ before: z.iso.datetime().optional() });

/** «Моя команда» в Masterio Pro и назначение исполнителя на заказ (разделы 18.2, 19.2). */
@ApiTags('teams')
@ApiBearerAuth()
@Controller()
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get('team')
  @Roles('WORKER')
  mine(@CurrentUser() user: AuthUser) {
    return this.teams.mine(user);
  }

  @Post('team')
  @Roles('WORKER')
  @ApiZodBody(teamNameSchema)
  create(@CurrentUser() user: AuthUser, @ZBody(teamNameSchema) body: z.infer<typeof teamNameSchema>) {
    return this.teams.create(user, body.name);
  }

  @Patch('team')
  @Roles('WORKER')
  @ApiZodBody(teamNameSchema)
  rename(@CurrentUser() user: AuthUser, @ZBody(teamNameSchema) body: z.infer<typeof teamNameSchema>) {
    return this.teams.rename(user, body.name);
  }

  @Get('team/events')
  @Roles('WORKER')
  events(@CurrentUser() user: AuthUser, @ZQuery(eventsQuery) q: z.infer<typeof eventsQuery>) {
    return this.teams.events(user, q.before);
  }

  @Post('team/invites')
  @Roles('WORKER')
  @ApiZodBody(teamInviteSchema)
  invite(@CurrentUser() user: AuthUser, @ZBody(teamInviteSchema) body: z.infer<typeof teamInviteSchema>) {
    return this.teams.invite(user, body.phone, body.role);
  }

  @Delete('team/invites/:id')
  @Roles('WORKER')
  @HttpCode(204)
  revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.teams.revokeInvite(user, id);
  }

  @Get('team/invites/mine')
  @Roles('WORKER')
  myInvites(@CurrentUser() user: AuthUser) {
    return this.teams.myInvites(user);
  }

  @Post('team/invites/:id/accept')
  @Roles('WORKER')
  accept(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.teams.acceptInvite(user, id);
  }

  @Post('team/invites/:id/decline')
  @Roles('WORKER')
  @HttpCode(204)
  decline(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.teams.declineInvite(user, id);
  }

  @Delete('team/members/:id')
  @Roles('WORKER')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.teams.removeMember(user, id);
  }

  @Post('team/leave')
  @Roles('WORKER')
  @HttpCode(204)
  leave(@CurrentUser() user: AuthUser) {
    return this.teams.leave(user);
  }

  @Get('orders/:id/performers')
  @Roles('WORKER')
  candidates(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.teams.candidates(user, id);
  }

  @Post('orders/:id/assign')
  @Roles('WORKER')
  @ApiZodBody(assignPerformerSchema)
  assign(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ZBody(assignPerformerSchema) body: z.infer<typeof assignPerformerSchema>) {
    return this.teams.assign(user, id, body.teamMemberId, body.reason);
  }

  @Delete('orders/:id/assign/pending')
  @Roles('WORKER')
  cancelPending(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.teams.cancelPending(user, id);
  }

  @Post('orders/:id/performer-change')
  @Roles('CLIENT')
  @ApiZodBody(performerChangeDecisionSchema)
  decide(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ZBody(performerChangeDecisionSchema) body: z.infer<typeof performerChangeDecisionSchema>) {
    return this.teams.decideChange(user, id, body.approve);
  }

  @Post('orders/:id/performer-mismatch')
  @Roles('CLIENT')
  @ApiZodBody(performerMismatchSchema)
  mismatch(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ZBody(performerMismatchSchema) body: z.infer<typeof performerMismatchSchema>) {
    return this.teams.performerMismatch(user, id, body.description);
  }
}

/** CRM: команда мастера или компании — участники, приглашения, журнал. */
@ApiTags('admin')
@ApiBearerAuth()
@AdminRoles('SUPPORT', 'MODERATOR', 'FINANCE')
@Controller('admin/workers')
export class AdminTeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get(':id/team')
  team(@Param('id', ParseUUIDPipe) id: string) {
    return this.teams.adminView(id);
  }
}
