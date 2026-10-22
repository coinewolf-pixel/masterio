import { Controller, Get, HttpCode, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { idListSchema, workerOnlineSchema, workerProfileSchema } from '@masterio/shared';
import { CurrentUser, Roles, type AuthUser } from '../common/auth';
import { ApiZodBody, ZBody } from '../common/zod';
import { LegalService } from '../legal/legal.service';
import { WorkersService } from './workers.service';

@ApiTags('worker')
@ApiBearerAuth()
@Roles('WORKER')
@Controller('worker')
export class WorkersController {
  constructor(
    private readonly workers: WorkersService,
    private readonly legal: LegalService,
  ) {}

  @Post('online')
  @HttpCode(200)
  @ApiZodBody(workerOnlineSchema)
  async online(@CurrentUser() user: AuthUser, @ZBody(workerOnlineSchema) body: z.infer<typeof workerOnlineSchema>) {
    // заказы — только после принятия условий для мастеров страны (если они опубликованы)
    await this.legal.assertConsented(user, 'registration');
    return this.workers.goOnline(user.id, body.location);
  }

  @Post('offline')
  @HttpCode(200)
  offline(@CurrentUser() user: AuthUser) {
    return this.workers.goOffline(user.id);
  }

  @Get('eligibility')
  eligibility(@CurrentUser() user: AuthUser) {
    return this.workers.eligibility(user.id);
  }

  @Put('categories')
  @ApiZodBody(idListSchema)
  categories(@CurrentUser() user: AuthUser, @ZBody(idListSchema) body: z.infer<typeof idListSchema>) {
    return this.workers.setCategories(user.id, body.ids);
  }

  @Put('cities')
  @ApiZodBody(idListSchema)
  cities(@CurrentUser() user: AuthUser, @ZBody(idListSchema) body: z.infer<typeof idListSchema>) {
    return this.workers.setCities(user.id, body.ids);
  }

  @Patch('profile')
  @ApiZodBody(workerProfileSchema)
  profile(@CurrentUser() user: AuthUser, @ZBody(workerProfileSchema) body: z.infer<typeof workerProfileSchema>) {
    return this.workers.updateProfile(user.id, body);
  }
}
