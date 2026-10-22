import { Inject, Injectable, Logger } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { ENV, type Env } from '../config/env';
import type { SmsVerifier, VerifyResult } from './sms';

/**
 * Аккаунты для проверки приложений в App Store и Google Play (REVIEW_PHONES). Проверяющий не может получить SMS
 * на наш номер, поэтому для этих номеров код постоянный (REVIEW_OTP_CODE, только в переменных окружения).
 * Такие аккаунты изолированы: заказы тестового клиента получают только тестовые мастера, а реальные клиенты
 * тестовым мастерам заказы не отправляют (см. MatchingService). После проверки номера можно убрать из окружения.
 */
@Injectable()
export class ReviewAccounts {
  readonly phones: readonly string[];

  constructor(@Inject(ENV) env: Env) {
    this.phones = env.REVIEW_PHONES;
  }

  isReview(phone: string | null | undefined): boolean {
    return Boolean(phone) && this.phones.includes(phone as string);
  }
}

/** Обёртка над настоящим провайдером: для номеров проверки SMS не отправляется, код сравнивается с постоянным. */
export class ReviewSmsVerifier implements SmsVerifier {
  private readonly logger = new Logger('ReviewLogin');

  constructor(
    private readonly inner: SmsVerifier,
    private readonly phones: readonly string[],
    private readonly code: string,
  ) {}

  async send(phone: string, locale: string): Promise<void> {
    if (this.phones.includes(phone)) {
      this.logger.warn(`store review login requested for ${phone.slice(0, 4)}…${phone.slice(-2)}`);
      return;
    }
    await this.inner.send(phone, locale);
  }

  async check(phone: string, code: string): Promise<VerifyResult> {
    if (!this.phones.includes(phone)) return this.inner.check(phone, code);
    const a = Buffer.from(code.padEnd(6, ' ').slice(0, 16));
    const b = Buffer.from(this.code.padEnd(6, ' ').slice(0, 16));
    return a.length === b.length && timingSafeEqual(a, b) ? 'approved' : 'invalid';
  }
}
