import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminCatalogController } from './admin/admin-catalog.controller';
import { AdminFinanceController } from './admin/admin-finance.controller';
import { AdminPeopleController } from './admin/admin-people.controller';
import { AdminQueryService } from './admin/admin-query.service';
import { AdminController } from './admin/admin.controller';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { ReviewAccounts, ReviewSmsVerifier } from './auth/review';
import { ConsoleSmsVerifier, SMS_VERIFIER, TwilioVerifyService } from './auth/sms';
import { TokensService } from './auth/tokens.service';
import { BootstrapService } from './bootstrap.service';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';
import { ChatController } from './chat/chat.controller';
import { AuditService } from './common/audit.service';
import { AuthGuard } from './common/auth';
import { PII_CIPHER, PiiCipher } from './common/crypto';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { RateLimiter } from './common/rate-limiter';
import { ENV, type Env } from './config/env';
import { DispatchService } from './dispatch/dispatch.service';
import { OffersController } from './dispatch/offers.controller';
import { HealthController } from './health.controller';
import { JobsService } from './jobs/jobs.service';
import { MatchingService } from './matching/matching.service';
import { NotificationsService } from './notifications/notifications.service';
import { ExpoPushSender, FcmPushSender, LogPushSender, PUSH_SENDER } from './notifications/push';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { PaymentsController } from './payments/payments.controller';
import { PaymentsService } from './payments/payments.service';
import { STRIPE_GATEWAY, StripeGatewayImpl } from './payments/stripe.gateway';
import { PrismaService } from './prisma/prisma.service';
import { RealtimeService } from './realtime/realtime.service';
import { RedisModule } from './redis/redis.module';
import { SettingsService } from './settings/settings.service';
import { EtaService } from './tracking/eta.service';
import { TrackingController } from './tracking/tracking.controller';
import { TrackingGateway } from './tracking/tracking.gateway';
import { TrackingService } from './tracking/tracking.service';
import { MeController } from './users/me.controller';
import { GrantsService } from './wallet/grants.service';
import { LedgerService } from './wallet/ledger.service';
import { WalletController } from './wallet/wallet.controller';
import { WalletService } from './wallet/wallet.service';
import { WorkersController } from './workers/workers.controller';
import { WorkersService } from './workers/workers.service';
import { StorageService } from './storage/storage.service';
import { DocumentsService } from './documents/documents.service';
import { DocumentsController } from './documents/documents.controller';
import { HistoryService } from './history/history.service';
import { HistoryController } from './history/history.controller';
import { GeoService } from './geo/geo.service';
import { ClientController } from './client/client.controller';
import { AdminDisputesController, DisputesController } from './disputes/disputes.controller';
import { DisputesService } from './disputes/disputes.service';
import { AdminSupportController, SupportController } from './support/support.controller';
import { SupportService } from './support/support.service';
import { AdminLegalController, LegalController } from './legal/legal.controller';
import { LegalService } from './legal/legal.service';
import { AdminComplianceController, ComplianceController } from './compliance/compliance.controller';
import { InsuranceService } from './compliance/insurance.service';
import { BonusesService } from './bonuses/bonuses.service';
import { PrivacyService } from './privacy/privacy.service';
import { AdminTeamsController, TeamsController } from './teams/teams.controller';
import { TeamsService } from './teams/teams.service';

@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        { module: EnvModule, global: true, providers: [{ provide: ENV, useValue: env }], exports: [ENV] },
        RedisModule,
        JwtModule.register({ secret: env.JWT_ACCESS_SECRET, signOptions: { algorithm: 'HS256' } }),
        ThrottlerModule.forRoot({
          throttlers: [{ ttl: 60_000, limit: 120 }],
          // в тестах лимиты по IP отключены (все запросы с 127.0.0.1); лимиты SMS в Redis действуют всегда
          skipIf: () => env.NODE_ENV === 'test',
        }),
      ],
      controllers: [
        HealthController,
        AuthController,
        MeController,
        CatalogController,
        WorkersController,
        OrdersController,
        OffersController,
        TrackingController,
        ChatController,
        WalletController,
        PaymentsController,
        AdminController,
        AdminPeopleController,
        AdminCatalogController,
        AdminFinanceController,
        DocumentsController,
        HistoryController,
        ClientController,
        DisputesController,
        AdminDisputesController,
        SupportController,
        AdminSupportController,
        LegalController,
        AdminLegalController,
        ComplianceController,
        AdminComplianceController,
        TeamsController,
        AdminTeamsController,
      ],
      providers: [
        PrismaService,
        { provide: PII_CIPHER, useFactory: () => new PiiCipher(env.PII_ENCRYPTION_KEY) },
        TwilioVerifyService,
        ConsoleSmsVerifier,
        ReviewAccounts,
        {
          provide: SMS_VERIFIER,
          // для номеров проверки магазинами (REVIEW_PHONES) — постоянный код без SMS, остальным — настоящий провайдер
          useFactory: (twilio: TwilioVerifyService, consoleSms: ConsoleSmsVerifier) => {
            const inner = env.SMS_PROVIDER === 'twilio' ? twilio : consoleSms;
            return env.REVIEW_PHONES.length > 0 && env.REVIEW_OTP_CODE ? new ReviewSmsVerifier(inner, env.REVIEW_PHONES, env.REVIEW_OTP_CODE) : inner;
          },
          inject: [TwilioVerifyService, ConsoleSmsVerifier],
        },
        { provide: PUSH_SENDER, useClass: env.PUSH_PROVIDER === 'fcm' ? FcmPushSender : env.PUSH_PROVIDER === 'expo' ? ExpoPushSender : LogPushSender },
        { provide: STRIPE_GATEWAY, useClass: StripeGatewayImpl },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useExisting: AuthGuard },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        AuthGuard,
        RateLimiter,
        AuditService,
        SettingsService,
        TokensService,
        AuthService,
        NotificationsService,
        RealtimeService,
        JobsService,
        LedgerService,
        WalletService,
        GrantsService,
        PaymentsService,
        MatchingService,
        CatalogService,
        WorkersService,
        DispatchService,
        OrdersService,
        EtaService,
        TrackingService,
        TrackingGateway,
        BootstrapService,
        StorageService,
        DocumentsService,
        HistoryService,
        GeoService,
        AdminQueryService,
        DisputesService,
        SupportService,
        LegalService,
        InsuranceService,
        BonusesService,
        PrivacyService,
        TeamsService,
      ],
    };
  }
}

@Module({})
class EnvModule {}
