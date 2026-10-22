import { Controller, Get, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { chatMessageSchema, filterChatMessage, paginationSchema, RT_EVENTS } from '@masterio/shared';
import { AppException } from '../common/app-exception';
import { isAdminWith, CurrentUser, type AuthUser } from '../common/auth';
import { PII_CIPHER, PiiCipher } from '../common/crypto';
import { ApiZodBody, ZBody, ZQuery } from '../common/zod';
import type { Order } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

const CHAT_STATUSES = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED_BY_WORKER', 'DISPUTED'];

/** Чат по заказу: только через приложение, с фильтром телефонов, ссылок, мессенджеров и реквизитов (раздел 12). */
@ApiTags('chat')
@ApiBearerAuth()
@Controller('orders/:id/messages')
export class ChatController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    @Inject(PII_CIPHER) private readonly pii: PiiCipher,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ZQuery(paginationSchema) q: z.infer<typeof paginationSchema>) {
    await this.access(user, id, false);
    return this.prisma.chatMessage.findMany({
      where: { orderId: id },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
      select: { id: true, senderId: true, body: true, filtered: true, filterHits: true, attachmentKey: true, readAt: true, createdAt: true },
    });
  }

  @Post()
  @ApiZodBody(chatMessageSchema)
  async send(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ZBody(chatMessageSchema) body: z.infer<typeof chatMessageSchema>) {
    const order = await this.access(user, id, true);
    const result = filterChatMessage(body.body);
    const filtered = result.hits.length > 0;
    const message = await this.prisma.chatMessage.create({
      data: {
        orderId: id,
        senderId: user.id,
        body: result.text,
        filtered,
        filterHits: result.hits,
        bodyOriginalEnc: filtered ? this.pii.encrypt(body.body) : null,
      },
      select: { id: true, senderId: true, body: true, filtered: true, filterHits: true, createdAt: true },
    });
    if (filtered) {
      await this.prisma.fraudFlag.create({
        data: { type: 'OFF_PLATFORM_ATTEMPT', userId: user.id, orderId: id, details: { hits: result.hits, messageId: message.id } },
      });
    }
    const payload = { orderId: id, ...message };
    this.realtime.toUser(order.clientId, RT_EVENTS.chatMessage, payload);
    if (order.workerId) this.realtime.toUser(order.workerId, RT_EVENTS.chatMessage, payload);
    return { ...message, warningKey: filtered ? 'chat.off_platform_warning' : null };
  }

  private async access(user: AuthUser, orderId: string, write: boolean): Promise<Order> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new AppException('NOT_FOUND');
    const admin = isAdminWith(user, 'SUPPORT', 'MODERATOR');
    let participant = order.clientId === user.id || order.workerId === user.id;
    if (!participant) {
      participant = (await this.prisma.orderAssignment.count({ where: { orderId, isCurrent: true, teamMember: { userId: user.id } } })) > 0;
    }
    if (!participant && !admin) throw new AppException('NOT_FOUND');
    if (write && (!participant || !CHAT_STATUSES.includes(order.status))) throw new AppException('INVALID_STATUS_TRANSITION');
    return order;
  }
}
