import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { AdminSubRole, UserRole } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from './app-exception';

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  subRoles: AdminSubRole[];
  typ: 'access';
}

export interface AuthUser {
  id: string;
  role: UserRole;
  subRoles: AdminSubRole[];
}

const IS_PUBLIC = 'isPublic';
const ROLES = 'roles';
const ADMIN_ROLES = 'adminRoles';

export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);
export const Roles = (...roles: UserRole[]): MethodDecorator & ClassDecorator => SetMetadata(ROLES, roles);
/** Доступ админам с любой из перечисленных подролей; SUPERADMIN проходит всегда. */
export const AdminRoles = (...roles: AdminSubRole[]): MethodDecorator & ClassDecorator => SetMetadata(ADMIN_ROLES, roles);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
  if (!req.user) throw new AppException('UNAUTHORIZED');
  return req.user;
});

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const user = await this.verify(token);
    req.user = user;

    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES, targets);
    if (roles && !roles.includes(user.role)) throw new AppException('FORBIDDEN');

    const adminRoles = this.reflector.getAllAndOverride<AdminSubRole[] | undefined>(ADMIN_ROLES, targets);
    if (adminRoles) {
      if (user.role !== 'ADMIN') throw new AppException('FORBIDDEN');
      const ok = user.subRoles.includes('SUPERADMIN') || adminRoles.some((r) => user.subRoles.includes(r));
      if (!ok) throw new AppException('FORBIDDEN');
    }
    return true;
  }

  async verify(token: string): Promise<AuthUser> {
    if (!token) throw new AppException('UNAUTHORIZED');
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new AppException('UNAUTHORIZED');
    }
    if (payload.typ !== 'access') throw new AppException('UNAUTHORIZED');
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, status: true, admin: { select: { subRoles: true } } },
    });
    if (!user || user.status === 'DELETED') throw new AppException('UNAUTHORIZED');
    if (user.status === 'BLOCKED' || user.status === 'SUSPENDED') throw new AppException('ACCOUNT_BLOCKED');
    return { id: user.id, role: user.role, subRoles: user.admin?.subRoles ?? [] };
  }
}

export function isAdminWith(user: AuthUser, ...roles: AdminSubRole[]): boolean {
  return user.role === 'ADMIN' && (user.subRoles.includes('SUPERADMIN') || roles.some((r) => user.subRoles.includes(r)));
}
