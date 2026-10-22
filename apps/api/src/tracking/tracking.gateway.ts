import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { locationPointSchema, RT_EVENTS, RT_NAMESPACE, uuidSchema } from '@masterio/shared';
import { AuthGuard, type AuthUser } from '../common/auth';
import { RealtimeService } from '../realtime/realtime.service';
import { TrackingService } from './tracking.service';

type AuthedSocket = Socket & { data: { user?: AuthUser; ready?: Promise<AuthUser | null> } };

/**
 * Socket.IO /rt. Подключение с JWT (handshake.auth.token). Комнаты: user:<id>, order:<id>, admins.
 * Исполнитель шлёт location:update; клиент входит в комнату заказа через order:join — только пока заказ активен.
 */
@WebSocketGateway({ namespace: RT_NAMESPACE })
export class TrackingGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(TrackingGateway.name);

  constructor(
    private readonly auth: AuthGuard,
    private readonly realtime: RealtimeService,
    private readonly tracking: TrackingService,
  ) {}

  afterInit(ns: Namespace): void {
    this.realtime.attach(ns);
  }

  async handleConnection(socket: AuthedSocket): Promise<void> {
    // Сообщения могут прийти раньше, чем закончится проверка токена: обработчики ждут этот промис
    socket.data.ready = this.authenticate(socket);
    await socket.data.ready;
  }

  private async authenticate(socket: AuthedSocket): Promise<AuthUser | null> {
    try {
      const token = typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : '';
      const user = await this.auth.verify(token);
      socket.data.user = user;
      await socket.join(`user:${user.id}`);
      if (user.role === 'ADMIN') await socket.join('admins');
      socket.emit(RT_EVENTS.ready, { userId: user.id });
      return user;
    } catch {
      socket.emit(RT_EVENTS.error, { code: 'UNAUTHORIZED' });
      socket.disconnect(true);
      return null;
    }
  }

  private async userOf(socket: AuthedSocket): Promise<AuthUser | null> {
    return (await socket.data.ready) ?? null;
  }

  @SubscribeMessage(RT_EVENTS.orderJoin)
  async joinOrder(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: unknown): Promise<{ ok: boolean }> {
    const user = await this.userOf(socket);
    const parsed = uuidSchema.safeParse((body as { orderId?: unknown } | null)?.orderId);
    if (!user || !parsed.success) return { ok: false };
    const allowed = await this.tracking.canJoinOrderRoom(user.id, user.role, parsed.data);
    if (!allowed) return { ok: false };
    await socket.join(`order:${parsed.data}`);
    return { ok: true };
  }

  @SubscribeMessage(RT_EVENTS.locationUpdate)
  async location(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: unknown): Promise<{ ok: boolean; orderId?: string | null }> {
    const user = await this.userOf(socket);
    if (!user || user.role !== 'WORKER') return { ok: false };
    const parsed = locationPointSchema.safeParse(body);
    if (!parsed.success) return { ok: false };
    try {
      const res = await this.tracking.ingest(user.id, [parsed.data]);
      return { ok: true, orderId: res.orderId };
    } catch (error) {
      this.logger.warn(`location ingest failed: ${String(error)}`);
      return { ok: false };
    }
  }
}
