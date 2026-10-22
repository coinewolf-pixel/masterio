import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { ENV, type Env } from '../config/env';
import { AppException } from '../common/app-exception';
import type { AccessTokenPayload } from '../common/auth';
import { randomToken, sha256 } from '../common/crypto';
import type { AdminSubRole, UserRole } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresIn: number;
}

/**
 * JWT access (короткий) + refresh с ротацией. Каждый refresh-токен одноразовый; повторное
 * использование старого токена означает кражу — отзывается вся семья токенов этой сессии.
 */
@Injectable()
export class TokensService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async issue(user: { id: string; role: UserRole; subRoles: AdminSubRole[] }, familyId: string = randomUUID()): Promise<TokenPair> {
    const payload: AccessTokenPayload = { sub: user.id, role: user.role, subRoles: user.subRoles, typ: 'access' };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: this.env.JWT_ACCESS_TTL_SECONDS });
    const refreshToken = randomToken();
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        familyId,
        expiresAt: new Date(Date.now() + this.env.JWT_REFRESH_TTL_DAYS * 86_400_000),
      },
    });
    return { accessToken, refreshToken, accessExpiresIn: this.env.JWT_ACCESS_TTL_SECONDS };
  }

  async rotate(refreshToken: string): Promise<TokenPair> {
    const hash = sha256(refreshToken);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hash },
      include: { user: { include: { admin: true } } },
    });
    if (!existing) throw new AppException('UNAUTHORIZED');
    if (existing.revokedAt) {
      await this.revokeFamily(existing.familyId);
      throw new AppException('TOKEN_REUSED');
    }
    if (existing.expiresAt < new Date()) throw new AppException('UNAUTHORIZED');
    const user = existing.user;
    if (user.status === 'BLOCKED' || user.status === 'SUSPENDED') throw new AppException('ACCOUNT_BLOCKED');
    if (user.status === 'DELETED') throw new AppException('UNAUTHORIZED');

    // Атомарно помечаем старый токен использованным; параллельный второй запрос получит 0 строк
    const marked = await this.prisma.refreshToken.updateMany({
      where: { id: existing.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (marked.count === 0) {
      await this.revokeFamily(existing.familyId);
      throw new AppException('TOKEN_REUSED');
    }
    const pair = await this.issue({ id: user.id, role: user.role, subRoles: user.admin?.subRoles ?? [] }, existing.familyId);
    const created = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(pair.refreshToken) } });
    await this.prisma.refreshToken.update({ where: { id: existing.id }, data: { replacedBy: created?.id ?? null } });
    return pair;
  }

  async revokeByToken(refreshToken: string): Promise<void> {
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (existing) await this.revokeFamily(existing.familyId);
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
