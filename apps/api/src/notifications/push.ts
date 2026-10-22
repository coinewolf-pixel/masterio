import { Inject, Injectable, Logger } from '@nestjs/common';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { ENV, type Env } from '../config/env';

export interface PushMessage {
  title: string;
  body: string;
  /** данные для приложения: тип события, id заказа/предложения */
  data: Record<string, string>;
  /** high — предложения заказов и срочные события */
  priority: 'high' | 'normal';
  /** одинаковый ключ заменяет предыдущее уведомление (так «отзываем» карточку предложения) */
  collapseKey?: string;
  /** только данные, без видимого уведомления (закрытие предложения) */
  silent?: boolean;
}

export interface PushSender {
  send(tokens: string[], message: PushMessage): Promise<{ invalidTokens: string[] }>;
}

export const PUSH_SENDER = Symbol('PUSH_SENDER');

/** Firebase Cloud Messaging: Android напрямую, iOS через APNs-ключ, загруженный в Firebase. */
@Injectable()
export class FcmPushSender implements PushSender {
  private readonly logger = new Logger('FCM');
  private readonly app: App;

  constructor(@Inject(ENV) env: Env) {
    const json = JSON.parse(Buffer.from(env.FIREBASE_SERVICE_ACCOUNT_B64 ?? '', 'base64').toString('utf8')) as Record<string, string>;
    this.app = getApps()[0] ?? initializeApp({ credential: cert(json) });
  }

  async send(tokens: string[], message: PushMessage): Promise<{ invalidTokens: string[] }> {
    if (tokens.length === 0) return { invalidTokens: [] };
    const res = await getMessaging(this.app).sendEachForMulticast({
      tokens,
      data: message.data,
      ...(message.silent ? {} : { notification: { title: message.title, body: message.body } }),
      android: {
        priority: message.priority === 'high' ? 'high' : 'normal',
        ...(message.collapseKey ? { collapseKey: message.collapseKey } : {}),
        ...(message.silent ? {} : { notification: { channelId: message.priority === 'high' ? 'offers' : 'default', ...(message.collapseKey ? { tag: message.collapseKey } : {}) } }),
      },
      apns: {
        headers: {
          'apns-priority': message.priority === 'high' && !message.silent ? '10' : '5',
          'apns-push-type': message.silent ? 'background' : 'alert',
          ...(message.collapseKey ? { 'apns-collapse-id': message.collapseKey } : {}),
        },
        payload: { aps: message.silent ? { contentAvailable: true } : { sound: 'default' } },
      },
    });
    const invalidTokens: string[] = [];
    res.responses.forEach((r, i) => {
      const code = r.error?.code ?? '';
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
        const token = tokens[i];
        if (token) invalidTokens.push(token);
      } else if (r.error) {
        this.logger.warn(`push failed: ${code}`);
      }
    });
    return { invalidTokens };
  }
}

/**
 * Expo Push Service: приложения на Expo получают токен ExponentPushToken[...], Expo доставляет через FCM и APNs
 * (ключи загружаются в EAS). Отправка пачками по 100, недействительные токены удаляются.
 */
@Injectable()
export class ExpoPushSender implements PushSender {
  private readonly logger = new Logger('ExpoPush');

  constructor(@Inject(ENV) private readonly env: Env) {}

  async send(tokens: string[], message: PushMessage): Promise<{ invalidTokens: string[] }> {
    const valid = tokens.filter((t) => /^Expo(nent)?PushToken\[.+\]$/.test(t));
    const invalidTokens = tokens.filter((t) => !valid.includes(t));
    for (let i = 0; i < valid.length; i += 100) {
      const chunk = valid.slice(i, i + 100);
      const body = chunk.map((to) => ({
        to,
        data: message.data,
        priority: message.priority === 'high' ? 'high' : 'normal',
        ...(message.silent
          ? { _contentAvailable: true }
          : { title: message.title, body: message.body, sound: 'default', channelId: message.priority === 'high' ? 'offers' : 'default' }),
        ...(message.priority === 'high' ? { ttl: 60 } : {}),
      }));
      try {
        const res = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(this.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${this.env.EXPO_ACCESS_TOKEN}` } : {}),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          this.logger.warn(`expo push failed: ${res.status}`);
          continue;
        }
        const json = (await res.json()) as { data?: Array<{ status: string; details?: { error?: string } }> };
        json.data?.forEach((ticket, idx) => {
          const token = chunk[idx];
          if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered' && token) invalidTokens.push(token);
        });
      } catch (error) {
        this.logger.warn(`expo push error: ${String(error)}`);
      }
    }
    return { invalidTokens };
  }
}

/** Для разработки и тестов: пишет уведомления в лог и хранит последние в памяти. */
@Injectable()
export class LogPushSender implements PushSender {
  private readonly logger = new Logger('Push');
  readonly sent: Array<{ tokens: string[]; message: PushMessage }> = [];

  async send(tokens: string[], message: PushMessage): Promise<{ invalidTokens: string[] }> {
    this.sent.push({ tokens, message });
    if (this.sent.length > 500) this.sent.shift();
    this.logger.debug(`[${message.priority}] ${message.title}: ${message.body} → ${tokens.length} device(s)`);
    return { invalidTokens: [] };
  }
}
