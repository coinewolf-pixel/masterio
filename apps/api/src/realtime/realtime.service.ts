import { Injectable } from '@nestjs/common';
import type { Namespace } from 'socket.io';

/** Отправка событий в комнаты Socket.IO: user:<id>, order:<id>, admins. */
@Injectable()
export class RealtimeService {
  private ns: Namespace | null = null;

  attach(ns: Namespace): void {
    this.ns = ns;
  }

  toUser(userId: string, event: string, payload: unknown): void {
    this.ns?.to(`user:${userId}`).emit(event, payload);
  }

  toOrder(orderId: string, event: string, payload: unknown): void {
    this.ns?.to(`order:${orderId}`).emit(event, payload);
  }

  toAdmins(event: string, payload: unknown): void {
    this.ns?.to('admins').emit(event, payload);
  }

  /** Убрать всех из комнаты заказа (после завершения или отмены позиция больше не передаётся). */
  closeOrderRoom(orderId: string): void {
    this.ns?.in(`order:${orderId}`).socketsLeave(`order:${orderId}`);
  }
}
