-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CLIENT', 'WORKER', 'ADMIN');

-- CreateEnum
CREATE TYPE "AdminSubRole" AS ENUM ('SUPPORT', 'MODERATOR', 'FINANCE', 'SUPERADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'WARNED', 'PREPAY_REQUIRED', 'SUSPENDED', 'BLOCKED', 'DELETED');

-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('en', 'ru', 'de', 'es', 'hy');

-- CreateEnum
CREATE TYPE "WorkerType" AS ENUM ('INDEPENDENT', 'COMPANY');

-- CreateEnum
CREATE TYPE "TeamMemberRole" AS ENUM ('LEADER', 'MASTER', 'HELPER', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('NOT_VERIFIED', 'VERIFIED', 'EXPIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('ID_DOCUMENT', 'SELFIE', 'LICENSE', 'INSURANCE', 'COMPANY_REGISTRATION', 'QUALIFICATION', 'OTHER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'SEARCHING', 'NO_WORKERS', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED_BY_WORKER', 'CONFIRMED', 'AUTO_CONFIRMED', 'CANCELLED_BY_CLIENT', 'CANCELLED_BY_WORKER', 'CANCELLED_BY_ADMIN', 'DISPUTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "OrderTiming" AS ENUM ('ASAP', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'REVOKED', 'TAKEN_BY_OTHER', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EstimateStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "EstimateItemType" AS ENUM ('LABOR', 'MATERIAL', 'TRAVEL', 'OTHER');

-- CreateEnum
CREATE TYPE "CancelActor" AS ENUM ('CLIENT', 'WORKER', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "DisputeReason" AS ENUM ('POOR_QUALITY', 'UNFINISHED', 'PROPERTY_DAMAGE', 'ACCIDENT_INJURY', 'PRICE_DISAGREEMENT', 'CLIENT_NO_SHOW', 'WORKER_NO_SHOW', 'PAYMENT_REFUSED', 'REFUND_REFUSED', 'FRAUD_SUSPECTED', 'PERFORMER_MISMATCH', 'INSURANCE_OR_LICENSE', 'CASH_AMOUNT_MISMATCH', 'OTHER');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'AWAITING_RESPONSE', 'UNDER_REVIEW', 'ESCALATED', 'SETTLED', 'UNRESOLVED_REFERRED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'PENDING_USER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('CLIENT_PAYMENT', 'PLATFORM_REVENUE', 'WORKER_EARNINGS', 'WORKER_TOPUP', 'WORKER_PENDING', 'WORKER_BONUS', 'WORKER_PROMO', 'WORKER_DEBT', 'BONUS_EXPENSE', 'BONUS_EXPIRED', 'PROMO_EXPENSE', 'PROMO_EXPIRED', 'REFUNDS', 'COMPENSATION', 'STRIPE_CLEARING', 'PENALTIES');

-- CreateEnum
CREATE TYPE "LedgerTxKind" AS ENUM ('TOPUP', 'COMMISSION', 'BONUS_ACCRUAL', 'BONUS_EXPIRY', 'PROMO_GRANT', 'PROMO_EXPIRY', 'PENALTY', 'COMPENSATION', 'REFUND', 'CHARGEBACK', 'CARD_CAPTURE', 'PAYOUT', 'TOPUP_REFUND', 'REVERSAL');

-- CreateEnum
CREATE TYPE "GrantStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXPIRED', 'BURNED');

-- CreateEnum
CREATE TYPE "BonusRunStatus" AS ENUM ('DRAFT', 'APPROVED', 'APPLIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'REQUIRES_ACTION', 'SUCCEEDED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "SettingScope" AS ENUM ('GLOBAL', 'COUNTRY', 'CITY', 'CATEGORY', 'CITY_CATEGORY');

-- CreateEnum
CREATE TYPE "LegalAudience" AS ENUM ('CLIENT', 'INDEPENDENT_WORKER', 'COMPANY', 'TEAM_MEMBER', 'DISPUTE_POLICY', 'INCIDENT_POLICY', 'INSURANCE_REQUIREMENTS', 'PRIVACY_POLICY', 'TOPUP_TERMS');

-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('ACCIDENT', 'INJURY', 'PROPERTY_DAMAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "FraudFlagType" AS ENUM ('HIGH_CANCEL_RATE', 'HIGH_DISPUTE_RATE', 'GPS_MISMATCH', 'SUSPICIOUS_PAIR', 'OFF_PLATFORM_ATTEMPT', 'MULTI_ACCOUNT', 'CASH_HIDDEN_ORDER', 'LARGE_GRANT', 'REFUND_SPIKE', 'TOPUP_SPIKE');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "role" "UserRole" NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "firstNameEnc" BYTEA,
    "lastNameEnc" BYTEA,
    "photoKey" TEXT,
    "locale" "Locale" NOT NULL DEFAULT 'en',
    "countryCode" CHAR(2) NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminProfile" (
    "userId" UUID NOT NULL,
    "subRoles" "AdminSubRole"[],
    "passwordHash" TEXT NOT NULL,
    "totpSecretEnc" BYTEA,
    "dailyGrantLimitCents" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AdminProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ClientProfile" (
    "userId" UUID NOT NULL,
    "cancelCount30d" INTEGER NOT NULL DEFAULT 0,
    "completedOrders" INTEGER NOT NULL DEFAULT 0,
    "stripeCustomerId" TEXT,

    CONSTRAINT "ClientProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "WorkerProfile" (
    "userId" UUID NOT NULL,
    "type" "WorkerType" NOT NULL DEFAULT 'INDEPENDENT',
    "companyName" TEXT,
    "companyRegNumber" TEXT,
    "kycStatus" "VerificationStatus" NOT NULL DEFAULT 'NOT_VERIFIED',
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "lastLocation" geography(Point,4326),
    "lastLocationAt" TIMESTAMP(3),
    "preferredRadiusM" INTEGER,
    "ratingAvg" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "acceptRate" DECIMAL(5,4) NOT NULL DEFAULT 1,
    "cancelCount30d" INTEGER NOT NULL DEFAULT 0,
    "cancelRate" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "autoUseEarnings" BOOLEAN NOT NULL DEFAULT false,
    "stripeAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "pushToken" TEXT,
    "appVersion" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpCode" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Address" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "label" TEXT,
    "formatted" TEXT NOT NULL,
    "placeId" TEXT,
    "location" geography(Point,4326),
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedPaymentMethod" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "stripePmId" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "last4" CHAR(4) NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedPaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "City" (
    "id" UUID NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "names" JSONB NOT NULL,
    "timezone" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "center" geography(Point,4326),
    "emergencyNumber" TEXT NOT NULL DEFAULT '112',
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryGroup" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "names" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CategoryGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "groupId" UUID NOT NULL,
    "names" JSONB NOT NULL,
    "icon" TEXT,
    "isUrgent" BOOLEAN NOT NULL DEFAULT false,
    "requiresLicense" BOOLEAN NOT NULL DEFAULT false,
    "requiresInsurance" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CityCategory" (
    "cityId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CityCategory_pkey" PRIMARY KEY ("cityId","categoryId")
);

-- CreateTable
CREATE TABLE "WorkerCategory" (
    "workerId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,

    CONSTRAINT "WorkerCategory_pkey" PRIMARY KEY ("workerId","categoryId")
);

-- CreateTable
CREATE TABLE "WorkerCity" (
    "workerId" UUID NOT NULL,
    "cityId" UUID NOT NULL,

    CONSTRAINT "WorkerCity_pkey" PRIMARY KEY ("workerId","cityId")
);

-- CreateTable
CREATE TABLE "ClientBlacklist" (
    "clientId" UUID NOT NULL,
    "workerId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientBlacklist_pkey" PRIMARY KEY ("clientId","workerId")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "TeamMemberRole" NOT NULL,
    "kycStatus" "VerificationStatus" NOT NULL DEFAULT 'NOT_VERIFIED',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "teamMemberId" UUID,
    "kind" "DocumentKind" NOT NULL,
    "fileKey" TEXT NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'NOT_VERIFIED',
    "rejectReason" TEXT,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "retentionUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "License" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "number" TEXT,
    "issuer" TEXT,
    "countryCode" CHAR(2) NOT NULL,

    CONSTRAINT "License_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsurancePolicy" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "insurerName" TEXT NOT NULL,
    "policyNumber" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "coveredRisks" TEXT[],
    "remindersSent" INTEGER[] DEFAULT ARRAY[]::INTEGER[],

    CONSTRAINT "InsurancePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsuranceRule" (
    "id" UUID NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "categoryId" UUID,
    "workerType" "WorkerType",
    "required" BOOLEAN NOT NULL DEFAULT true,
    "requiredRisks" TEXT[],
    "note" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InsuranceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentAccessLog" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "viewerId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "clientId" UUID NOT NULL,
    "workerId" UUID,
    "categoryId" UUID NOT NULL,
    "cityId" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 0,
    "timing" "OrderTiming" NOT NULL DEFAULT 'ASAP',
    "scheduledAt" TIMESTAMP(3),
    "description" TEXT NOT NULL,
    "addressFormatted" TEXT NOT NULL,
    "addressDetails" TEXT,
    "location" geography(Point,4326),
    "searchRadiusM" INTEGER NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "confirmedAmountCents" INTEGER,
    "cashReportedByWorkerCents" INTEGER,
    "cashReportedByClientCents" INTEGER,
    "commissionPercentBp" INTEGER,
    "commissionCents" INTEGER,
    "bonusDiscountCents" INTEGER,
    "clientUnconfirmed" BOOLEAN NOT NULL DEFAULT false,
    "dispatchRound" INTEGER NOT NULL DEFAULT 0,
    "dispatchStartedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "enRouteAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderPhoto" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "uploaderId" UUID NOT NULL,
    "fileKey" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "workerId" UUID NOT NULL,
    "round" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "score" DECIMAL(10,4) NOT NULL,
    "distanceM" INTEGER NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "jobId" TEXT,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderEvent" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" UUID,
    "payload" JSONB,
    "location" geography(Point,4326),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Estimate" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "EstimateStatus" NOT NULL DEFAULT 'PROPOSED',
    "totalCents" INTEGER NOT NULL,
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Estimate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimateItem" (
    "id" UUID NOT NULL,
    "estimateId" UUID NOT NULL,
    "type" "EstimateItemType" NOT NULL,
    "title" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "photoKeys" TEXT[],

    CONSTRAINT "EstimateItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderAssignment" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "teamMemberId" UUID NOT NULL,
    "assignedById" UUID NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "clientConsentRequired" BOOLEAN NOT NULL DEFAULT false,
    "clientConsentAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "OrderAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationPoint" (
    "id" BIGSERIAL NOT NULL,
    "orderId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "point" geography(Point,4326) NOT NULL,
    "accuracyM" INTEGER,
    "speedMps" DECIMAL(6,2),
    "heading" INTEGER,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "bodyOriginalEnc" BYTEA,
    "filtered" BOOLEAN NOT NULL DEFAULT false,
    "filterHits" TEXT[],
    "attachmentKey" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "targetId" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "text" TEXT,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cancellation" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "actor" "CancelActor" NOT NULL,
    "actorId" UUID,
    "reasonCode" TEXT NOT NULL,
    "comment" TEXT,
    "statusAtCancel" "OrderStatus" NOT NULL,
    "penaltyCents" INTEGER NOT NULL DEFAULT 0,
    "compensationCents" INTEGER NOT NULL DEFAULT 0,
    "createsReview" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cancellation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "openedById" UUID NOT NULL,
    "againstId" UUID,
    "reason" "DisputeReason" NOT NULL,
    "description" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "isSuspicious" BOOLEAN NOT NULL DEFAULT false,
    "isAutomatic" BOOLEAN NOT NULL DEFAULT false,
    "assigneeId" UUID,
    "responseDueAt" TIMESTAMP(3),
    "outcome" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisputeEvidence" (
    "id" UUID NOT NULL,
    "disputeId" UUID NOT NULL,
    "submittedById" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "fileKey" TEXT,
    "content" JSONB,
    "retentionUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisputeEvent" (
    "id" UUID NOT NULL,
    "disputeId" UUID NOT NULL,
    "actorId" UUID,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentReport" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "reporterId" UUID NOT NULL,
    "type" "IncidentType" NOT NULL,
    "description" TEXT NOT NULL,
    "emergencyCalled" BOOLEAN NOT NULL DEFAULT false,
    "location" geography(Point,4326),
    "fileKeys" TEXT[],
    "ticketId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "orderId" UUID,
    "disputeId" UUID,
    "subject" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "assigneeId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketMessage" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "attachmentKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" UUID NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "ownerId" UUID,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerTransaction" (
    "id" UUID NOT NULL,
    "kind" "LedgerTxKind" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "orderId" UUID,
    "grantId" UUID,
    "bonusAwardId" UUID,
    "paymentId" UUID,
    "reversesId" UUID,
    "actorId" UUID,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" BIGSERIAL NOT NULL,
    "transactionId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountBalance" (
    "accountId" UUID NOT NULL,
    "balanceCents" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountBalance_pkey" PRIMARY KEY ("accountId")
);

-- CreateTable
CREATE TABLE "BalanceLot" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "originTxId" UUID NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "remainingCents" BIGINT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BalanceLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletGrant" (
    "id" UUID NOT NULL,
    "workerId" UUID NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "GrantStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "createdById" UUID NOT NULL,
    "approvedById" UUID,
    "isAutoWelcome" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "WalletGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "stripeIntentId" TEXT NOT NULL,
    "cardFingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeWebhookEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" UUID NOT NULL,
    "workerId" UUID NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "stripeTransferId" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationReport" (
    "id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "ledgerCents" BIGINT NOT NULL,
    "stripeCents" BIGINT NOT NULL,
    "diffCents" BIGINT NOT NULL,
    "alerted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BonusRule" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "minOrders" INTEGER NOT NULL,
    "maxOrders" INTEGER,
    "percentBp" INTEGER NOT NULL,
    "minRating" DECIMAL(3,2) NOT NULL DEFAULT 4.7,
    "maxCancelRateBp" INTEGER NOT NULL DEFAULT 500,
    "maxLostDisputes" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),

    CONSTRAINT "BonusRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BonusRun" (
    "id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "status" "BonusRunStatus" NOT NULL DEFAULT 'DRAFT',
    "budgetCapCents" INTEGER NOT NULL,
    "totalRawCents" INTEGER NOT NULL DEFAULT 0,
    "scaleFactor" DECIMAL(6,5) NOT NULL DEFAULT 1,
    "approvedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "BonusRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BonusAward" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "workerId" UUID NOT NULL,
    "ruleId" UUID,
    "ordersCount" INTEGER NOT NULL,
    "commissionPaidCents" INTEGER NOT NULL,
    "rawCents" INTEGER NOT NULL,
    "finalCents" INTEGER NOT NULL,
    "excludedOrders" TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "breakdown" JSONB NOT NULL,

    CONSTRAINT "BonusAward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "scope" "SettingScope" NOT NULL DEFAULT 'GLOBAL',
    "scopeRef" TEXT NOT NULL DEFAULT '',
    "value" JSONB NOT NULL,
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettingHistory" (
    "id" UUID NOT NULL,
    "settingId" UUID NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB NOT NULL,
    "changedById" UUID NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettingHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalDocument" (
    "id" UUID NOT NULL,
    "audience" "LegalAudience" NOT NULL,
    "countryCode" CHAR(2) NOT NULL,

    CONSTRAINT "LegalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalDocumentVersion" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "locale" "Locale" NOT NULL,
    "body" TEXT NOT NULL,
    "legalReviewedBy" TEXT,
    "publishedById" UUID,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalDocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserConsent" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "context" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),

    CONSTRAINT "UserConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudFlag" (
    "id" UUID NOT NULL,
    "type" "FraudFlagType" NOT NULL,
    "userId" UUID,
    "orderId" UUID,
    "pairUserId" UUID,
    "score" INTEGER NOT NULL DEFAULT 0,
    "details" JSONB NOT NULL,
    "resolvedById" UUID,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FraudFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "params" JSONB,
    "orderId" UUID,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataRequest" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "retainedReason" TEXT,
    "fileKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DataRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ClientProfile_stripeCustomerId_key" ON "ClientProfile"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerProfile_stripeAccountId_key" ON "WorkerProfile"("stripeAccountId");

-- CreateIndex
CREATE INDEX "worker_last_location_gix" ON "WorkerProfile" USING GIST ("lastLocation");

-- CreateIndex
CREATE INDEX "Device_fingerprint_idx" ON "Device"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "Device_userId_fingerprint_key" ON "Device"("userId", "fingerprint");

-- CreateIndex
CREATE INDEX "OtpCode_phone_createdAt_idx" ON "OtpCode"("phone", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedPaymentMethod_stripePmId_key" ON "SavedPaymentMethod"("stripePmId");

-- CreateIndex
CREATE INDEX "SavedPaymentMethod_fingerprint_idx" ON "SavedPaymentMethod"("fingerprint");

-- CreateIndex
CREATE INDEX "city_center_gix" ON "City" USING GIST ("center");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryGroup_code_key" ON "CategoryGroup"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Category_code_key" ON "Category"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Team_ownerId_key" ON "Team"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_teamId_userId_key" ON "TeamMember"("teamId", "userId");

-- CreateIndex
CREATE INDEX "Document_status_kind_idx" ON "Document"("status", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "License_documentId_key" ON "License"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "InsurancePolicy_documentId_key" ON "InsurancePolicy"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "InsuranceRule_countryCode_categoryId_workerType_key" ON "InsuranceRule"("countryCode", "categoryId", "workerType");

-- CreateIndex
CREATE INDEX "DocumentAccessLog_documentId_createdAt_idx" ON "DocumentAccessLog"("documentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_number_key" ON "Order"("number");

-- CreateIndex
CREATE INDEX "Order_status_cityId_categoryId_idx" ON "Order"("status", "cityId", "categoryId");

-- CreateIndex
CREATE INDEX "Order_clientId_createdAt_idx" ON "Order"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_workerId_createdAt_idx" ON "Order"("workerId", "createdAt");

-- CreateIndex
CREATE INDEX "order_location_gix" ON "Order" USING GIST ("location");

-- CreateIndex
CREATE INDEX "Offer_orderId_round_idx" ON "Offer"("orderId", "round");

-- CreateIndex
CREATE INDEX "Offer_workerId_status_idx" ON "Offer"("workerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_orderId_workerId_round_key" ON "Offer"("orderId", "workerId", "round");

-- CreateIndex
CREATE INDEX "OrderEvent_orderId_createdAt_idx" ON "OrderEvent"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Estimate_orderId_version_key" ON "Estimate"("orderId", "version");

-- CreateIndex
CREATE INDEX "OrderAssignment_orderId_isCurrent_idx" ON "OrderAssignment"("orderId", "isCurrent");

-- CreateIndex
CREATE INDEX "LocationPoint_orderId_recordedAt_idx" ON "LocationPoint"("orderId", "recordedAt");

-- CreateIndex
CREATE INDEX "location_point_gix" ON "LocationPoint" USING GIST ("point");

-- CreateIndex
CREATE INDEX "ChatMessage_orderId_createdAt_idx" ON "ChatMessage"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Review_orderId_authorId_key" ON "Review"("orderId", "authorId");

-- CreateIndex
CREATE UNIQUE INDEX "Cancellation_orderId_key" ON "Cancellation"("orderId");

-- CreateIndex
CREATE INDEX "Dispute_status_createdAt_idx" ON "Dispute"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentReport_ticketId_key" ON "IncidentReport"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_disputeId_key" ON "SupportTicket"("disputeId");

-- CreateIndex
CREATE INDEX "LedgerAccount_ownerId_idx" ON "LedgerAccount"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_type_ownerId_currency_key" ON "LedgerAccount"("type", "ownerId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerTransaction_idempotencyKey_key" ON "LedgerTransaction"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerTransaction_reversesId_key" ON "LedgerTransaction"("reversesId");

-- CreateIndex
CREATE INDEX "LedgerEntry_accountId_createdAt_idx" ON "LedgerEntry"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "BalanceLot_accountId_expiresAt_idx" ON "BalanceLot"("accountId", "expiresAt");

-- CreateIndex
CREATE INDEX "WalletGrant_workerId_idx" ON "WalletGrant"("workerId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripeIntentId_key" ON "Payment"("stripeIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_stripeTransferId_key" ON "Payout"("stripeTransferId");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationReport_day_key" ON "ReconciliationReport"("day");

-- CreateIndex
CREATE UNIQUE INDEX "BonusRun_period_key" ON "BonusRun"("period");

-- CreateIndex
CREATE UNIQUE INDEX "BonusAward_runId_workerId_key" ON "BonusAward"("runId", "workerId");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_key_scope_scopeRef_key" ON "Setting"("key", "scope", "scopeRef");

-- CreateIndex
CREATE UNIQUE INDEX "LegalDocument_audience_countryCode_key" ON "LegalDocument"("audience", "countryCode");

-- CreateIndex
CREATE UNIQUE INDEX "LegalDocumentVersion_documentId_version_locale_key" ON "LegalDocumentVersion"("documentId", "version", "locale");

-- CreateIndex
CREATE INDEX "UserConsent_userId_idx" ON "UserConsent"("userId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_entityType_entityId_idx" ON "AdminAuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_adminId_createdAt_idx" ON "AdminAuditLog"("adminId", "createdAt");

-- CreateIndex
CREATE INDEX "FraudFlag_type_resolvedAt_idx" ON "FraudFlag"("type", "resolvedAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "AdminProfile" ADD CONSTRAINT "AdminProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProfile" ADD CONSTRAINT "ClientProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerProfile" ADD CONSTRAINT "WorkerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedPaymentMethod" ADD CONSTRAINT "SavedPaymentMethod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CategoryGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CityCategory" ADD CONSTRAINT "CityCategory_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CityCategory" ADD CONSTRAINT "CityCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerCategory" ADD CONSTRAINT "WorkerCategory_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "WorkerProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerCategory" ADD CONSTRAINT "WorkerCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerCity" ADD CONSTRAINT "WorkerCity_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "WorkerProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerCity" ADD CONSTRAINT "WorkerCity_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBlacklist" ADD CONSTRAINT "ClientBlacklist_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "WorkerProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "License" ADD CONSTRAINT "License_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "License" ADD CONSTRAINT "License_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsurancePolicy" ADD CONSTRAINT "InsurancePolicy_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAccessLog" ADD CONSTRAINT "DocumentAccessLog_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "WorkerProfile"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPhoto" ADD CONSTRAINT "OrderPhoto_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "WorkerProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateItem" ADD CONSTRAINT "EstimateItem_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "Estimate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAssignment" ADD CONSTRAINT "OrderAssignment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAssignment" ADD CONSTRAINT "OrderAssignment_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationPoint" ADD CONSTRAINT "LocationPoint_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cancellation" ADD CONSTRAINT "Cancellation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeEvidence" ADD CONSTRAINT "DisputeEvidence_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeEvent" ADD CONSTRAINT "DisputeEvent_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentReport" ADD CONSTRAINT "IncidentReport_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "LedgerTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountBalance" ADD CONSTRAINT "AccountBalance_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusAward" ADD CONSTRAINT "BonusAward_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BonusRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettingHistory" ADD CONSTRAINT "SettingHistory_settingId_fkey" FOREIGN KEY ("settingId") REFERENCES "Setting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalDocumentVersion" ADD CONSTRAINT "LegalDocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "LegalDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserConsent" ADD CONSTRAINT "UserConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserConsent" ADD CONSTRAINT "UserConsent_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "LegalDocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────── Masterio: ограничения, которые Prisma не описывает ─────────────

-- Проверки данных
ALTER TABLE "Review" ADD CONSTRAINT "review_rating_range" CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "EstimateItem" ADD CONSTRAINT "estimate_item_nonneg" CHECK ("unitCents" >= 0 AND "totalCents" >= 0 AND "quantity" > 0);
ALTER TABLE "Order" ADD CONSTRAINT "order_commission_cap" CHECK ("commissionPercentBp" IS NULL OR "commissionPercentBp" BETWEEN 0 AND 2000);
ALTER TABLE "Order" ADD CONSTRAINT "order_location_required" CHECK ("status" = 'DRAFT' OR "location" IS NOT NULL);
ALTER TABLE "WalletGrant" ADD CONSTRAINT "grant_positive" CHECK ("amountCents" > 0);
ALTER TABLE "WalletGrant" ADD CONSTRAINT "grant_four_eyes" CHECK ("approvedById" IS NULL OR "approvedById" <> "createdById");

-- Один активный заказ на мастера
CREATE UNIQUE INDEX "one_active_order_per_worker" ON "Order" ("workerId")
  WHERE "status" IN ('ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS');
-- Одно активное предложение на мастера одновременно
CREATE UNIQUE INDEX "one_pending_offer_per_worker" ON "Offer" ("workerId") WHERE "status" = 'PENDING';

-- Системные счета платформы (ownerId = NULL): один счёт на (тип, валюта)
CREATE UNIQUE INDEX "ledger_account_platform_unique" ON "LedgerAccount" ("type", "currency") WHERE "ownerId" IS NULL;

-- Ledger только дописывается
CREATE OR REPLACE FUNCTION ledger_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger is append-only';
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "ledger_entry_no_update" BEFORE UPDATE OR DELETE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
CREATE TRIGGER "ledger_tx_no_update" BEFORE UPDATE OR DELETE ON "LedgerTransaction"
  FOR EACH ROW EXECUTE FUNCTION ledger_immutable();

-- Сумма записей транзакции = 0 (проверка при COMMIT)
CREATE OR REPLACE FUNCTION ledger_tx_balanced() RETURNS trigger AS $$
DECLARE s BIGINT;
BEGIN
  SELECT COALESCE(SUM("amountCents"), 0) INTO s FROM "LedgerEntry" WHERE "transactionId" = NEW."transactionId";
  IF s <> 0 THEN
    RAISE EXCEPTION 'ledger transaction % is unbalanced: %', NEW."transactionId", s;
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "ledger_entry_balanced" AFTER INSERT ON "LedgerEntry"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_tx_balanced();

-- Карманы мастера не уходят в минус (недостача ведётся на WORKER_DEBT).
-- AFTER-триггер: при INSERT ... ON CONFLICT DO UPDATE проверяется итоговая строка, а не предлагаемая вставка.
CREATE OR REPLACE FUNCTION balance_non_negative() RETURNS trigger AS $$
DECLARE t TEXT;
BEGIN
  SELECT "type" INTO t FROM "LedgerAccount" WHERE "id" = NEW."accountId";
  IF t IN ('WORKER_BONUS', 'WORKER_PROMO', 'WORKER_TOPUP', 'WORKER_EARNINGS', 'WORKER_PENDING') AND NEW."balanceCents" < 0 THEN
    RAISE EXCEPTION 'account % (%) cannot go negative', NEW."accountId", t;
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "account_balance_non_negative" AFTER INSERT OR UPDATE ON "AccountBalance"
  FOR EACH ROW EXECUTE FUNCTION balance_non_negative();
