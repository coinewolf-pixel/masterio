import { Inject, Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import type { z } from 'zod';
import type { adminLoginSchema, otpRequestSchema, otpVerifySchema } from '@masterio/shared';
import { AppException } from '../common/app-exception';
import { PII_CIPHER, PiiCipher } from '../common/crypto';
import { RateLimiter } from '../common/rate-limiter';
import type { UserRole } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SMS_VERIFIER, type SmsVerifier } from './sms';
import { TokensService, type TokenPair } from './tokens.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly limiter: RateLimiter,
    @Inject(SMS_VERIFIER) private readonly sms: SmsVerifier,
    @Inject(PII_CIPHER) private readonly pii: PiiCipher,
  ) {}

  /** Отправка кода. Лимиты: телефон 5/час, устройство 10/час, IP 30/час. */
  async requestOtp(input: z.infer<typeof otpRequestSchema>, ip: string, locale = 'en'): Promise<{ sent: true }> {
    await this.limiter.hit(`otp:send:phone:${input.phone}`, 5, 3_600);
    await this.limiter.hit(`otp:send:device:${input.deviceId}`, 10, 3_600);
    await this.limiter.hit(`otp:send:ip:${ip}`, 30, 3_600);
    await this.sms.send(input.phone, locale);
    return { sent: true };
  }

  /** Проверка кода: не больше 5 неверных попыток за 15 минут на номер (защита от перебора). */
  async verifyOtp(input: z.infer<typeof otpVerifySchema>, ip: string): Promise<TokenPair & { userId: string; isNew: boolean }> {
    await this.limiter.hit(`otp:check:phone:${input.phone}`, 5, 900, 'OTP_TOO_MANY_ATTEMPTS');
    await this.limiter.hit(`otp:check:ip:${ip}`, 50, 900, 'OTP_TOO_MANY_ATTEMPTS');
    const result = await this.sms.check(input.phone, input.code);
    if (result === 'expired') throw new AppException('OTP_EXPIRED');
    if (result === 'invalid') throw new AppException('OTP_INVALID');
    await this.limiter.reset(`otp:check:phone:${input.phone}`);

    const role: UserRole = input.appType === 'worker' ? 'WORKER' : 'CLIENT';
    let user = await this.prisma.user.findUnique({ where: { phone: input.phone } });
    let isNew = false;
    if (user && user.role !== role) {
      // Один номер — одна роль: клиент и мастер — разные аккаунты в разных приложениях
      throw new AppException('FORBIDDEN', { reason: 'phone_registered_with_other_role' });
    }
    if (user && (user.status === 'BLOCKED' || user.status === 'SUSPENDED')) throw new AppException('ACCOUNT_BLOCKED');
    if (user && user.status === 'DELETED') throw new AppException('ACCOUNT_BLOCKED');
    if (!user) {
      isNew = true;
      user = await this.prisma.user.create({
        data: {
          role,
          phone: input.phone,
          locale: input.locale,
          countryCode: input.countryCode,
          ...(role === 'CLIENT' ? { client: { create: {} } } : { worker: { create: {} } }),
        },
      });
    }
    await this.prisma.device.upsert({
      where: { userId_fingerprint: { userId: user.id, fingerprint: input.deviceId } },
      create: { userId: user.id, fingerprint: input.deviceId, platform: 'unknown' },
      update: { lastSeenAt: new Date() },
    });
    const pair = await this.tokens.issue({ id: user.id, role: user.role, subRoles: [] });
    return { ...pair, userId: user.id, isNew };
  }

  async adminLogin(input: z.infer<typeof adminLoginSchema>, ip: string): Promise<TokenPair> {
    await this.limiter.hit(`admin:login:${input.email}`, 10, 900);
    await this.limiter.hit(`admin:login:ip:${ip}`, 30, 900);
    const user = await this.prisma.user.findUnique({ where: { email: input.email }, include: { admin: true } });
    if (!user || user.role !== 'ADMIN' || !user.admin) throw new AppException('UNAUTHORIZED');
    const passwordOk = await bcrypt.compare(input.password, user.admin.passwordHash);
    const secret = this.pii.decrypt(user.admin.totpSecretEnc);
    const totpOk = secret !== null && authenticator.check(input.totp, secret);
    if (!passwordOk || !totpOk) throw new AppException('UNAUTHORIZED');
    // статус проверяется после пароля и кода, чтобы по ответу нельзя было узнать о существовании аккаунта
    if (user.status !== 'ACTIVE') throw new AppException('ACCOUNT_BLOCKED');
    await this.limiter.reset(`admin:login:${input.email}`);
    return this.tokens.issue({ id: user.id, role: user.role, subRoles: user.admin.subRoles });
  }
}
