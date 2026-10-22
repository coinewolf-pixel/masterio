import { Controller, Get, HttpCode, Ip, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { registerDocumentSchema, reviewDocumentSchema, uploadUrlSchema } from '@masterio/shared';
import { AppException } from '../common/app-exception';
import { AdminRoles, CurrentUser, type AuthUser } from '../common/auth';
import { ApiZodBody, ZBody, ZodPipe } from '../common/zod';
import { StorageService } from '../storage/storage.service';
import { DocumentsService } from './documents.service';

@ApiTags('documents')
@ApiBearerAuth()
@Controller()
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly storage: StorageService,
  ) {}

  /** Подписанная форма загрузки в закрытый бакет. Файл грузится напрямую в хранилище, минуя сервер. */
  @Post('uploads')
  @ApiZodBody(uploadUrlSchema)
  upload(@CurrentUser() user: AuthUser, @ZBody(uploadUrlSchema) body: z.infer<typeof uploadUrlSchema>) {
    if (body.purpose === 'document' && user.role !== 'WORKER') throw new AppException('FORBIDDEN');
    return this.storage.presignUpload(body.purpose, user.id, body.contentType, body.sizeBytes);
  }

  @Post('documents')
  @ApiZodBody(registerDocumentSchema)
  register(@CurrentUser() user: AuthUser, @ZBody(registerDocumentSchema) body: z.infer<typeof registerDocumentSchema>) {
    return this.documents.register(user, body);
  }

  @Get('documents')
  list(@CurrentUser() user: AuthUser) {
    return this.documents.listOwn(user.id);
  }

  @Get('documents/:id/view-url')
  view(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.documents.viewUrl(user, id, ip);
  }

  @Get('admin/documents')
  @AdminRoles('MODERATOR', 'SUPPORT')
  queue(@Query('status', new ZodPipe(z.enum(['NOT_VERIFIED', 'VERIFIED', 'REJECTED', 'EXPIRED']).optional())) status?: 'NOT_VERIFIED' | 'VERIFIED' | 'REJECTED' | 'EXPIRED') {
    return this.documents.queue(status);
  }

  @Post('admin/documents/:id/review')
  @HttpCode(200)
  @AdminRoles('MODERATOR')
  @ApiZodBody(reviewDocumentSchema)
  review(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ZBody(reviewDocumentSchema) body: z.infer<typeof reviewDocumentSchema>) {
    return this.documents.review(admin, id, body.decision, body.reason);
  }
}
