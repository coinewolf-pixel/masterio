import { Injectable } from '@nestjs/common';
import { AppException } from '../common/app-exception';
import { Prisma, type LedgerAccountType, type LedgerTxKind } from '../generated/prisma/client';
import type { Tx } from '../prisma/prisma.service';

export interface Leg {
  type: LedgerAccountType;
  ownerId: string | null;
  amountCents: number;
}

export interface PostInput {
  kind: LedgerTxKind;
  idempotencyKey: string;
  currency: string;
  legs: Leg[];
  orderId?: string;
  grantId?: string;
  bonusAwardId?: string;
  paymentId?: string;
  reversesId?: string;
  actorId?: string;
  memo?: string;
}

export interface PostResult {
  transactionId: string;
  replayed: boolean;
  accountIds: Map<string, string>;
}

/**
 * Журнал операций с двойной записью (раздел 20.3).
 * Каждая операция — транзакция с записями, сумма которых равна 0; записи не меняются и не удаляются
 * (триггеры в БД), исправление — только обратной операцией. Повтор с тем же idempotencyKey ничего не создаёт.
 * Вызывать только внутри транзакции БД.
 */
@Injectable()
export class LedgerService {
  async post(tx: Tx, input: PostInput): Promise<PostResult> {
    const existing = await tx.ledgerTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      if (existing.kind !== input.kind) throw new AppException('IDEMPOTENCY_CONFLICT');
      return { transactionId: existing.id, replayed: true, accountIds: new Map() };
    }

    const legs = input.legs.filter((l) => l.amountCents !== 0);
    for (const leg of legs) {
      if (!Number.isSafeInteger(leg.amountCents)) throw new Error(`ledger amount must be integer cents: ${leg.amountCents}`);
    }
    const sum = legs.reduce((s, l) => s + l.amountCents, 0);
    if (sum !== 0) throw new Error(`ledger transaction must balance to zero, got ${sum}`);
    if (legs.length === 0) throw new Error('ledger transaction without movements');

    const accountIds = new Map<string, string>();
    for (const leg of legs) {
      const key = accountKey(leg.type, leg.ownerId);
      if (!accountIds.has(key)) accountIds.set(key, await this.ensureAccount(tx, leg.type, leg.ownerId, input.currency));
    }

    const created = await tx.ledgerTransaction.create({
      data: {
        kind: input.kind,
        idempotencyKey: input.idempotencyKey,
        orderId: input.orderId ?? null,
        grantId: input.grantId ?? null,
        bonusAwardId: input.bonusAwardId ?? null,
        paymentId: input.paymentId ?? null,
        reversesId: input.reversesId ?? null,
        actorId: input.actorId ?? null,
        memo: input.memo ?? null,
      },
    });
    await tx.ledgerEntry.createMany({
      data: legs.map((l) => ({
        transactionId: created.id,
        accountId: accountIds.get(accountKey(l.type, l.ownerId)) as string,
        amountCents: BigInt(l.amountCents),
      })),
    });

    // Кэш остатков в той же транзакции; триггер БД не даёт карманам мастера уйти в минус
    const deltas = new Map<string, number>();
    for (const l of legs) {
      const id = accountIds.get(accountKey(l.type, l.ownerId)) as string;
      deltas.set(id, (deltas.get(id) ?? 0) + l.amountCents);
    }
    try {
      for (const [accountId, delta] of deltas) {
        await tx.$executeRaw`
          INSERT INTO "AccountBalance" ("accountId", "balanceCents", "updatedAt")
          VALUES (${accountId}::uuid, ${BigInt(delta)}, now())
          ON CONFLICT ("accountId") DO UPDATE
            SET "balanceCents" = "AccountBalance"."balanceCents" + EXCLUDED."balanceCents", "updatedAt" = now()`;
      }
    } catch (error) {
      if (String(error).includes('cannot go negative')) throw new AppException('INSUFFICIENT_BALANCE');
      throw error;
    }
    return { transactionId: created.id, replayed: false, accountIds };
  }

  async ensureAccount(tx: Tx, type: LedgerAccountType, ownerId: string | null, currency: string): Promise<string> {
    if (ownerId === null) {
      // системный счёт платформы: уникальность (type, currency) по частичному индексу
      await tx.$executeRaw`
        INSERT INTO "LedgerAccount" ("id", "type", "ownerId", "currency", "createdAt")
        VALUES (gen_random_uuid(), ${type}::"LedgerAccountType", NULL, ${currency}, now())
        ON CONFLICT ("type", "currency") WHERE "ownerId" IS NULL DO NOTHING`;
    } else {
      await tx.$executeRaw`
        INSERT INTO "LedgerAccount" ("id", "type", "ownerId", "currency", "createdAt")
        VALUES (gen_random_uuid(), ${type}::"LedgerAccountType", ${ownerId}::uuid, ${currency}, now())
        ON CONFLICT ("type", "ownerId", "currency") DO NOTHING`;
    }
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "LedgerAccount"
      WHERE "type" = ${type}::"LedgerAccountType" AND "ownerId" IS NOT DISTINCT FROM ${ownerId}::uuid AND "currency" = ${currency}`;
    const id = rows[0]?.id;
    if (!id) throw new Error('ledger account was not created');
    return id;
  }

  /** Найти счёт без создания (для чтения). */
  async findAccount(tx: Tx, type: LedgerAccountType, ownerId: string | null, currency: string): Promise<string | null> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "LedgerAccount"
      WHERE "type" = ${type}::"LedgerAccountType" AND "ownerId" IS NOT DISTINCT FROM ${ownerId}::uuid AND "currency" = ${currency}`;
    return rows[0]?.id ?? null;
  }

  /** Остатки счетов владельца по типам (из кэша AccountBalance). */
  async balances(tx: Tx, ownerId: string, currency: string): Promise<Partial<Record<LedgerAccountType, number>>> {
    const rows = await tx.$queryRaw<Array<{ type: LedgerAccountType; balance: bigint }>>`
      SELECT a."type", COALESCE(b."balanceCents", 0) AS balance
      FROM "LedgerAccount" a LEFT JOIN "AccountBalance" b ON b."accountId" = a."id"
      WHERE a."ownerId" = ${ownerId}::uuid AND a."currency" = ${currency}`;
    const out: Partial<Record<LedgerAccountType, number>> = {};
    for (const r of rows) out[r.type] = Number(r.balance);
    return out;
  }

  /** Сверка: сумма всех записей журнала должна быть 0, а кэш остатков совпадать с записями. */
  async verifyIntegrity(tx: Tx): Promise<{ totalCents: number; mismatchedAccounts: number }> {
    const [total] = await tx.$queryRaw<Array<{ s: bigint | null }>>`SELECT SUM("amountCents") AS s FROM "LedgerEntry"`;
    const [mismatch] = await tx.$queryRaw<Array<{ c: bigint }>>`
      SELECT COUNT(*) AS c FROM (
        SELECT a."id", COALESCE(SUM(e."amountCents"), 0) AS s, COALESCE(MAX(b."balanceCents"), 0) AS cached
        FROM "LedgerAccount" a
        LEFT JOIN "LedgerEntry" e ON e."accountId" = a."id"
        LEFT JOIN "AccountBalance" b ON b."accountId" = a."id"
        GROUP BY a."id"
      ) t WHERE t.s <> t.cached`;
    return { totalCents: Number(total?.s ?? 0n), mismatchedAccounts: Number(mismatch?.c ?? 0n) };
  }
}

function accountKey(type: LedgerAccountType, ownerId: string | null): string {
  return `${type}:${ownerId ?? 'platform'}`;
}

export function isPrismaError(e: unknown): e is Prisma.PrismaClientKnownRequestError {
  return e instanceof Prisma.PrismaClientKnownRequestError;
}
