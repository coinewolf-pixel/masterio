import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { randomInt } from 'node:crypto';
import { ENV, type Env } from '../config/env';
import { sha256 } from '../common/crypto';
import { REDIS } from '../redis/redis.module';

export type VerifyResult = 'approved' | 'invalid' | 'expired';

/** Отправка и проверка SMS-кода. В production — только Twilio Verify. */
export interface SmsVerifier {
  send(phone: string, locale: string): Promise<void>;
  check(phone: string, code: string): Promise<VerifyResult>;
}

export const SMS_VERIFIER = Symbol('SMS_VERIFIER');

/** Twilio Verify: Twilio сам генерирует код, хранит его, ограничивает попытки и отправляет SMS. */
@Injectable()
export class TwilioVerifyService implements SmsVerifier {
  private readonly logger = new Logger('TwilioVerify');

  constructor(@Inject(ENV) private readonly env: Env) {}

  private get base(): string {
    return `https://verify.twilio.com/v2/Services/${this.env.TWILIO_VERIFY_SERVICE_SID}`;
  }

  private headers(): Record<string, string> {
    const auth = Buffer.from(`${this.env.TWILIO_ACCOUNT_SID}:${this.env.TWILIO_AUTH_TOKEN}`).toString('base64');
    return { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' };
  }

  async send(phone: string, locale: string): Promise<void> {
    const body = new URLSearchParams({ To: phone, Channel: 'sms', Locale: locale });
    const res = await fetch(`${this.base}/Verifications`, { method: 'POST', headers: this.headers(), body });
    if (!res.ok) {
      this.logger.error(`Twilio send failed: ${res.status} ${await res.text()}`);
      throw new Error('SMS provider error');
    }
  }

  async check(phone: string, code: string): Promise<VerifyResult> {
    const body = new URLSearchParams({ To: phone, Code: code });
    const res = await fetch(`${this.base}/VerificationCheck`, { method: 'POST', headers: this.headers(), body });
    // 404 — проверка не найдена или истекла (Twilio удаляет её после успеха, истечения или лимита попыток)
    if (res.status === 404) return 'expired';
    if (!res.ok) {
      this.logger.error(`Twilio check failed: ${res.status} ${await res.text()}`);
      throw new Error('SMS provider error');
    }
    const json = (await res.json()) as { status?: string };
    return json.status === 'approved' ? 'approved' : 'invalid';
  }
}

/**
 * Только для локальной разработки и тестов (запрещено в production проверкой env):
 * код генерируется сервером, хранится хэшем в Redis 5 минут и печатается в лог.
 */
@Injectable()
export class ConsoleSmsVerifier implements SmsVerifier {
  private readonly logger = new Logger('ConsoleSms');
  /** последний код по номеру — нужен e2e-тестам, в production этот класс не используется */
  readonly lastCodes = new Map<string, string>();

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async send(phone: string): Promise<void> {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.redis.set(`otp:dev:${phone}`, sha256(code), 'EX', 300);
    this.lastCodes.set(phone, code);
    this.logger.log(`SMS code for ${phone}: ${code}`);
  }

  async check(phone: string, code: string): Promise<VerifyResult> {
    const stored = await this.redis.get(`otp:dev:${phone}`);
    if (!stored) return 'expired';
    if (stored !== sha256(code)) return 'invalid';
    await this.redis.del(`otp:dev:${phone}`);
    return 'approved';
  }
}
