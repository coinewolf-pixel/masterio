import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { acceptConsentsSchema, CONSENT_CONTEXTS, legalVersionSchema } from '@masterio/shared';
import { AdminRoles, CurrentUser, Roles, type AuthUser } from '../common/auth';
import { ApiZodBody, ZBody, ZodPipe } from '../common/zod';
import { LegalService } from './legal.service';

/** Документы и согласия для приложений. */
@ApiTags('legal')
@ApiBearerAuth()
@Controller('legal')
export class LegalController {
  constructor(private readonly legal: LegalService) {}

  @Get('required')
  @Roles('CLIENT', 'WORKER')
  required(@CurrentUser() user: AuthUser, @Query('context', new ZodPipe(z.enum(CONSENT_CONTEXTS))) context: (typeof CONSENT_CONTEXTS)[number]) {
    return this.legal.forContext(user, context);
  }

  @Get('versions/:id')
  text(@Param('id', ParseUUIDPipe) id: string) {
    return this.legal.text(id);
  }

  @Post('consents')
  @HttpCode(200)
  @Roles('CLIENT', 'WORKER')
  @ApiZodBody(acceptConsentsSchema)
  accept(@CurrentUser() user: AuthUser, @ZBody(acceptConsentsSchema) body: z.infer<typeof acceptConsentsSchema>, @Req() req: Request) {
    return this.legal.accept(user, body.context, body.versionIds, { ip: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Get('consents')
  mine(@CurrentUser() user: AuthUser) {
    return this.legal.myConsents(user.id);
  }
}

/** Юридические документы в CRM: смотрят все админы, создаёт и публикует superadmin. */
@ApiTags('admin')
@ApiBearerAuth()
@AdminRoles('SUPPORT', 'MODERATOR', 'FINANCE')
@Controller('admin/legal')
export class AdminLegalController {
  constructor(private readonly legal: LegalService) {}

  @Get()
  list() {
    return this.legal.adminList();
  }

  @Get('versions/:id')
  version(@Param('id', ParseUUIDPipe) id: string) {
    return this.legal.adminVersion(id);
  }

  @Post('versions')
  @AdminRoles('SUPERADMIN')
  @ApiZodBody(legalVersionSchema)
  create(@CurrentUser() admin: AuthUser, @Body(new ZodPipe(legalVersionSchema)) body: z.infer<typeof legalVersionSchema>) {
    return this.legal.createVersion(admin, body);
  }

  @Post(':documentId/versions/:version/publish')
  @HttpCode(200)
  @AdminRoles('SUPERADMIN')
  publish(@CurrentUser() admin: AuthUser, @Param('documentId', ParseUUIDPipe) documentId: string, @Param('version') version: string) {
    return this.legal.publish(admin, documentId, version);
  }

  @Delete(':documentId/versions/:version')
  @AdminRoles('SUPERADMIN')
  remove(@CurrentUser() admin: AuthUser, @Param('documentId', ParseUUIDPipe) documentId: string, @Param('version') version: string) {
    return this.legal.deleteDraft(admin, documentId, version);
  }
}
