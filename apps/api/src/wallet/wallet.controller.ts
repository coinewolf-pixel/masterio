import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { paginationSchema } from '@masterio/shared';
import { CurrentUser, Roles, type AuthUser } from '../common/auth';
import { ZQuery } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { WalletService } from './wallet.service';

/**
 * Кошелёк мастера. Операций вывода с карманов пополнения, бонуса и промо в API нет (раздел 21.8);
 * выплата заработка появится за флагом PAYOUTS_ENABLED вместе с карточными оплатами.
 */
@ApiTags('wallet')
@ApiBearerAuth()
@Roles('WORKER')
@Controller('wallet')
export class WalletController {
  constructor(
    private readonly wallet: WalletService,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  async get(@CurrentUser() user: AuthUser) {
    const currency = await this.wallet.workerCurrency(this.prisma, user.id);
    await this.prisma.$transaction((tx) => this.wallet.burnExpiredLots(tx, user.id, currency));
    const pockets = await this.wallet.pockets(this.prisma, user.id, currency);
    const promoLots = await this.prisma.balanceLot.findMany({
      where: { remainingCents: { gt: 0 }, accountId: { in: await this.accountIds(user.id, currency, 'WORKER_PROMO') } },
      orderBy: { expiresAt: 'asc' },
    });
    const bonusLots = await this.prisma.balanceLot.findMany({
      where: { remainingCents: { gt: 0 }, accountId: { in: await this.accountIds(user.id, currency, 'WORKER_BONUS') } },
      orderBy: { expiresAt: 'asc' },
    });
    return {
      ...pockets,
      showEarnings: this.settings.get('CARD_PAYMENTS_ENABLED') || pockets.earningsCents > 0,
      topupEnabled: this.settings.get('WORKER_TOPUP_ENABLED'),
      promoLots: promoLots.map((l) => ({ remainingCents: Number(l.remainingCents), expiresAt: l.expiresAt })),
      bonusLots: bonusLots.map((l) => ({ remainingCents: Number(l.remainingCents), expiresAt: l.expiresAt })),
      withdrawable: { topup: false, promo: false, bonus: false },
    };
  }

  @Get('transactions')
  async transactions(@CurrentUser() user: AuthUser, @ZQuery(paginationSchema) q: z.infer<typeof paginationSchema>) {
    const entries = await this.prisma.ledgerEntry.findMany({
      where: { account: { ownerId: user.id } },
      include: { account: { select: { type: true, currency: true } }, transaction: { select: { kind: true, orderId: true, createdAt: true } } },
      orderBy: { id: 'desc' },
      take: q.limit,
      ...(q.cursor ? { skip: 1, cursor: { id: BigInt(q.cursor) } } : {}),
    });
    return {
      items: entries.map((e) => ({
        id: e.id.toString(),
        pocket: e.account.type,
        currency: e.account.currency,
        amountCents: Number(e.amountCents),
        kind: e.transaction.kind,
        orderId: e.transaction.orderId,
        createdAt: e.transaction.createdAt,
      })),
      nextCursor: entries.length === q.limit ? entries[entries.length - 1]?.id.toString() : null,
    };
  }

  private async accountIds(ownerId: string, currency: string, type: 'WORKER_PROMO' | 'WORKER_BONUS'): Promise<string[]> {
    const rows = await this.prisma.ledgerAccount.findMany({ where: { ownerId, currency, type }, select: { id: true } });
    return rows.map((r) => r.id);
  }
}
