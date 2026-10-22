import { Inject, Injectable, Logger } from '@nestjs/common';
import { translate } from '@masterio/shared';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PUSH_SENDER, type PushSender } from './push';

export interface NotifyOptions {
  /** ключ i18n без суффикса: push.order_accepted → берутся .title и .body */
  key: string;
  /** параметры шаблона; функция — если параметр зависит от языка получателя (название категории) */
  params?: Record<string, string | number> | ((locale: string) => Record<string, string | number>);
  data?: Record<string, string>;
  orderId?: string;
  priority?: 'high' | 'normal';
  collapseKey?: string;
  silent?: boolean;
  /** не сохранять в ленту уведомлений (служебные data-сообщения) */
  persist?: boolean;
}

/** Уведомления на языке получателя: запись в ленту + push на все устройства пользователя. */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PUSH_SENDER) private readonly push: PushSender,
  ) {}

  async notify(userId: string, opts: NotifyOptions): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { locale: true, devices: { where: { pushToken: { not: null } }, select: { pushToken: true } } },
      });
      if (!user) return;
      const params = typeof opts.params === 'function' ? opts.params(user.locale) : (opts.params ?? {});
      if (opts.persist !== false) {
        await this.prisma.notification.create({
          data: {
            userId,
            type: opts.key,
            params: params as Prisma.InputJsonValue,
            orderId: opts.orderId ?? null,
          },
        });
      }
      const tokens = user.devices.map((d) => d.pushToken).filter((t): t is string => Boolean(t));
      if (tokens.length === 0) return;
      const { invalidTokens } = await this.push.send(tokens, {
        title: translate(user.locale, `${opts.key}.title`, params),
        body: translate(user.locale, `${opts.key}.body`, params),
        data: { type: opts.key, ...(opts.orderId ? { orderId: opts.orderId } : {}), ...(opts.data ?? {}) },
        priority: opts.priority ?? 'normal',
        ...(opts.collapseKey ? { collapseKey: opts.collapseKey } : {}),
        ...(opts.silent ? { silent: true } : {}),
      });
      if (invalidTokens.length > 0) {
        await this.prisma.device.updateMany({ where: { pushToken: { in: invalidTokens } }, data: { pushToken: null } });
      }
    } catch (error) {
      // Уведомление не должно ломать бизнес-операцию: ошибку пишем в лог (и Sentry через логгер)
      this.logger.error(`notify ${opts.key} → ${userId} failed: ${String(error)}`);
    }
  }
}
