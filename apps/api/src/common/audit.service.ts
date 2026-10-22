import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';

/** Журнал действий админов (раздел 14). Записи только добавляются. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(
    entry: {
      adminId: string;
      action: string;
      entityType: string;
      entityId: string;
      before?: Prisma.InputJsonValue;
      after?: Prisma.InputJsonValue;
      ip?: string;
    },
    tx?: Tx,
  ): Promise<void> {
    await (tx ?? this.prisma).adminAuditLog.create({ data: entry });
  }
}
