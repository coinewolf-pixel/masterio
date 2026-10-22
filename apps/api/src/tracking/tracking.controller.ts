import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { locationBatchSchema } from '@masterio/shared';
import { CurrentUser, Roles, type AuthUser } from '../common/auth';
import { ApiZodBody, ZBody } from '../common/zod';
import { TrackingService } from './tracking.service';

@ApiTags('tracking')
@ApiBearerAuth()
@Controller()
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  /** Буфер точек, накопленный на телефоне при потере связи. */
  @Post('tracking/batch')
  @HttpCode(200)
  @Roles('WORKER')
  @ApiZodBody(locationBatchSchema)
  batch(@CurrentUser() user: AuthUser, @ZBody(locationBatchSchema) body: z.infer<typeof locationBatchSchema>) {
    return this.tracking.ingest(user.id, body.points);
  }

  @Get('orders/:id/track')
  track(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tracking.lastTrack(user, id);
  }
}
