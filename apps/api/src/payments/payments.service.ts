import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type Stripe from 'stripe';
import { formatMoney } from '@masterio/shared';
import { AppException } from '../common/app-exception';
import type { Prisma } from '../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { WalletService } from '../wallet/wallet.service';
import { STRIPE_GATEWAY, type StripeGateway } from './stripe.gateway';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway,
  ) {}

  /** Пополнение баланса мастера картой: предоплата услуг платформы (флаг WORKER_TOPUP_ENABLED). */
  async createTopup(workerId: string, amountCents: number, idempotencyKey: string | undefined) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: workerId } });
    const ctx = { countryCode: user.countryCode };
    if (!this.settings.get('WORKER_TOPUP_ENABLED', ctx)) throw new AppException('FEATURE_DISABLED');
    if (!this.stripe.configured) throw new AppException('FEATURE_DISABLED', { reason: 'payments_not_configured' });
    const min = this.settings.get('TOPUP_MIN_AMOUNT', ctx);
    const max = this.settings.get('TOPUP_MAX_AMOUNT', ctx);
    if (amountCents < min || amountCents > max) throw new AppException('VALIDATION_FAILED', { min, max });

    const currency = await this.wallet.workerCurrency(this.prisma, workerId);
    const key = idempotencyKey ?? randomUUID();
    const paymentId = randomUUID();
    const intent = await this.stripe.createTopupIntent({
      amountCents,
      currency,
      userId: workerId,
      paymentId,
      idempotencyKey: `topup:${workerId}:${key}`,
    });
    const payment = await this.prisma.payment.upsert({
      where: { stripeIntentId: intent.id },
      create: { id: paymentId, userId: workerId, purpose: 'worker_topup', amountCents, currency, stripeIntentId: intent.id },
      update: {},
    });
    return { paymentId: payment.id, clientSecret: intent.clientSecret, amountCents, currency };
  }

  /** Webhook Stripe: подпись проверена в контроллере; повтор события с тем же id ничего не делает. */
  async handleEvent(event: Stripe.Event): Promise<{ duplicate: boolean }> {
    const inserted = await this.prisma.stripeWebhookEvent.createMany({
      data: [{ id: event.id, type: event.type, payload: event as unknown as Prisma.InputJsonValue }],
      skipDuplicates: true,
    });
    if (inserted.count === 0) {
      const existing = await this.prisma.stripeWebhookEvent.findUnique({ where: { id: event.id } });
      if (existing?.processedAt) return { duplicate: true };
    }
    try {
      await this.process(event);
      await this.prisma.stripeWebhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), error: null } });
    } catch (error) {
      await this.prisma.stripeWebhookEvent.update({ where: { id: event.id }, data: { error: String(error).slice(0, 2_000) } });
      throw error;
    }
    return { duplicate: false };
  }

  private async process(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const intent = event.data.object;
        if (intent.metadata?.purpose !== 'worker_topup') return;
        await this.onTopupSucceeded(intent);
        return;
      }
      case 'payment_intent.payment_failed': {
        const intent = event.data.object;
        await this.prisma.payment.updateMany({ where: { stripeIntentId: intent.id }, data: { status: 'FAILED' } });
        return;
      }
      case 'charge.dispute.created': {
        const dispute = event.data.object;
        const intentId = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent?.id;
        if (!intentId) return;
        const payment = await this.prisma.payment.findUnique({ where: { stripeIntentId: intentId } });
        if (!payment || payment.purpose !== 'worker_topup') return;
        await this.prisma.$transaction((tx) =>
          this.wallet.reverseTopup(tx, {
            workerId: payment.userId,
            currency: payment.currency,
            amountCents: dispute.amount,
            paymentId: payment.id,
            providerRef: dispute.id,
          }),
        );
        await this.prisma.fraudFlag.create({
          data: { type: 'REFUND_SPIKE', userId: payment.userId, details: { reason: 'chargeback', disputeId: dispute.id, amount: dispute.amount } },
        });
        await this.wallet.emitChanged(payment.userId, payment.currency);
        return;
      }
      default:
        this.logger.debug(`ignored stripe event ${event.type}`);
    }
  }

  private async onTopupSucceeded(intent: Stripe.PaymentIntent): Promise<void> {
    const userId = intent.metadata?.userId;
    if (!userId) throw new Error(`payment intent ${intent.id} without userId`);
    const currency = intent.currency.toUpperCase();
    const cardFingerprint = this.cardFingerprint(intent);
    const payment = await this.prisma.payment.upsert({
      where: { stripeIntentId: intent.id },
      create: {
        userId,
        purpose: 'worker_topup',
        amountCents: intent.amount_received || intent.amount,
        currency,
        stripeIntentId: intent.id,
        status: 'SUCCEEDED',
        cardFingerprint,
      },
      update: { status: 'SUCCEEDED', cardFingerprint },
    });
    const result = await this.prisma.$transaction((tx) =>
      this.wallet.creditTopup(tx, {
        workerId: userId,
        currency,
        amountCents: payment.amountCents,
        paymentId: payment.id,
        providerRef: intent.id,
      }),
    );
    if (result.replayed) return;
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { locale: true } });
    await this.notifications.notify(userId, {
      key: 'push.topup_succeeded',
      params: { amount: formatMoney(payment.amountCents, currency, user.locale) },
    });
    await this.wallet.emitChanged(userId, currency);
  }

  private cardFingerprint(intent: Stripe.PaymentIntent): string | null {
    const charge = intent.latest_charge;
    if (charge && typeof charge === 'object') return charge.payment_method_details?.card?.fingerprint ?? null;
    return null;
  }
}
