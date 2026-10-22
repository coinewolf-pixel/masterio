import { Controller, Get, Header, HttpCode, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { monthSchema, paginationSchema } from '@masterio/shared';
import { CurrentUser, Roles, type AuthUser } from '../common/auth';
import { ZBody, ZodPipe, ZQuery } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';
import { HistoryService } from './history.service';

function currentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

@ApiTags('history')
@ApiBearerAuth()
@Controller()
export class HistoryController {
  constructor(
    private readonly history: HistoryService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('worker/history')
  @Roles('WORKER')
  orders(@CurrentUser() user: AuthUser, @Query('month', new ZodPipe(monthSchema.optional())) month?: string) {
    return this.history.workerOrders(user.id, month ?? currentMonth());
  }

  @Get('worker/stats')
  @Roles('WORKER')
  stats(@CurrentUser() user: AuthUser, @Query('month', new ZodPipe(monthSchema.optional())) month?: string) {
    return this.history.workerStats(user.id, month ?? currentMonth());
  }

  @Get('worker/history/export')
  @Roles('WORKER')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async export(@CurrentUser() user: AuthUser, @Res() res: Response, @Query('month', new ZodPipe(monthSchema.optional())) month?: string) {
    const m = month ?? currentMonth();
    res.setHeader('Content-Disposition', `attachment; filename="masterio-${m}.csv"`);
    res.send(await this.history.workerCsv(user.id, m));
  }

  // ── Лента уведомлений ──
  @Get('notifications')
  notifications(@CurrentUser() user: AuthUser, @ZQuery(paginationSchema) q: z.infer<typeof paginationSchema>) {
    return this.prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
    });
  }

  @Post('notifications/read')
  @HttpCode(204)
  async markRead(@CurrentUser() user: AuthUser, @ZBody(z.object({ ids: z.array(z.uuid()).max(200).optional() })) body: { ids?: string[] }): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId: user.id, readAt: null, ...(body.ids ? { id: { in: body.ids } } : {}) },
      data: { readAt: new Date() },
    });
  }
}
