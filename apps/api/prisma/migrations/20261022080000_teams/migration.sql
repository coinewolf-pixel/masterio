-- CreateEnum
CREATE TYPE "TeamInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AssignmentState" AS ENUM ('ACTIVE', 'PENDING_CONSENT', 'ENDED', 'DECLINED', 'CANCELLED');

-- AlterTable
ALTER TABLE "OrderAssignment" ADD COLUMN     "automatic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "state" "AssignmentState" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "TeamInvite" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "role" "TeamMemberRole" NOT NULL,
    "status" "TeamInviteStatus" NOT NULL DEFAULT 'PENDING',
    "invitedById" UUID NOT NULL,
    "acceptedById" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "TeamInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamEvent" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "actorId" UUID,
    "memberId" UUID,
    "orderId" UUID,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamInvite_phone_status_idx" ON "TeamInvite"("phone", "status");

-- CreateIndex
CREATE INDEX "TeamInvite_teamId_status_idx" ON "TeamInvite"("teamId", "status");

-- CreateIndex
CREATE INDEX "TeamEvent_teamId_createdAt_idx" ON "TeamEvent"("teamId", "createdAt");

-- AddForeignKey
ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamEvent" ADD CONSTRAINT "TeamEvent_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Фаза 7: компания с командой может вести несколько заказов одновременно (по одному на свободного
-- исполнителя). Ограничение «один активный заказ на мастера» проверяется в транзакции принятия
-- под блокировкой команды (pg_advisory_xact_lock), а не уникальным индексом.
DROP INDEX IF EXISTS "one_active_order_per_worker";

-- Один текущий исполнитель и одна ожидающая согласия замена на заказ
CREATE UNIQUE INDEX "one_current_assignment_per_order" ON "OrderAssignment" ("orderId") WHERE "isCurrent" = true;
CREATE UNIQUE INDEX "one_pending_change_per_order" ON "OrderAssignment" ("orderId") WHERE "state" = 'PENDING_CONSENT';
-- Одно ожидающее приглашение на номер в команде
CREATE UNIQUE INDEX "one_pending_invite_per_phone" ON "TeamInvite" ("teamId", "phone") WHERE "status" = 'PENDING';
-- Человек может быть активным участником (не руководителем) только одной команды
CREATE UNIQUE INDEX "one_team_per_member" ON "TeamMember" ("userId") WHERE "isActive" = true AND "role" <> 'LEADER';
-- прежние строки без состояния: снятые назначения считаются завершёнными
UPDATE "OrderAssignment" SET "state" = 'ENDED' WHERE "isCurrent" = false;
ALTER TABLE "OrderAssignment" ADD CONSTRAINT "assignment_current_is_active" CHECK (("isCurrent" = true) = ("state" = 'ACTIVE'));

-- Журнал команды только дописывается
CREATE OR REPLACE FUNCTION team_event_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'team journal is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER team_event_no_update BEFORE UPDATE OR DELETE ON "TeamEvent" FOR EACH ROW EXECUTE FUNCTION team_event_immutable();
