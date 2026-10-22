import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { paginationSchema, periodSchema } from '@masterio/shared';
import { AuditService } from '../common/audit.service';
import { AdminRoles, CurrentUser, type AuthUser } from '../common/auth';
import { ZodPipe, ZQuery } from '../common/zod';
import { AdminQueryService } from './admin-query.service';

const TX_KINDS = [
  'TOPUP',
  'COMMISSION',
  'BONUS_ACCRUAL',
  'BONUS_EXPIRY',
  'PROMO_GRANT',
  'PROMO_EXPIRY',
  'PENALTY',
  'COMPENSATION',
  'REFUND',
  'CHARGEBACK',
  'CARD_CAPTURE',
  'PAYOUT',
  'TOPUP_REFUND',
  'REVERSAL',
] as const;

const transactionsQuery = paginationSchema.extend({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  kind: z.enum(TX_KINDS).optional(),
  ownerId: z.uuid().optional(),
});

/** Финансы (раздел 14): обороты, комиссии, пополнения, кредиты, долги, журнал операций и CSV. Только finance и superadmin. */
@ApiTags('admin')
@ApiBearerAuth()
@AdminRoles('FINANCE')
@Controller('admin/finance')
export class AdminFinanceController {
  constructor(
    private readonly query: AdminQueryService,
    private readonly audit: AuditService,
  ) {}

  @Get('summary')
  summary(@ZQuery(periodSchema) q: z.infer<typeof periodSchema>) {
    return this.query.financeSummary(new Date(q.from), new Date(q.to));
  }

  @Get('transactions')
  transactions(@ZQuery(transactionsQuery) q: z.infer<typeof transactionsQuery>) {
    return this.query.transactions({ ...q, from: new Date(q.from), to: new Date(q.to) });
  }

  /** Выгрузка журнала операций за период; каждая выгрузка пишется в журнал действий админов. */
  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async exportCsv(@CurrentUser() admin: AuthUser, @Query(new ZodPipe(periodSchema)) q: z.infer<typeof periodSchema>): Promise<string> {
    const csv = await this.query.ledgerCsv(new Date(q.from), new Date(q.to));
    await this.audit.log({ adminId: admin.id, action: 'finance.export', entityType: 'Ledger', entityId: `${q.from}..${q.to}` });
    return csv;
  }
}
