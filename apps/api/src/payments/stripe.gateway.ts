import { Inject, Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { ENV, type Env } from '../config/env';

export interface CreatedIntent {
  id: string;
  clientSecret: string;
  status: string;
}

/** Обёртка над Stripe: создание платежей и проверка подписи webhooks. */
export interface StripeGateway {
  readonly configured: boolean;
  createTopupIntent(input: {
    amountCents: number;
    currency: string;
    userId: string;
    paymentId: string;
    idempotencyKey: string;
  }): Promise<CreatedIntent>;
  /** Проверяет подпись Stripe-Signature и возвращает событие; при неверной подписи бросает ошибку. */
  constructEvent(rawBody: Buffer, signature: string): Stripe.Event;
}

export const STRIPE_GATEWAY = Symbol('STRIPE_GATEWAY');

@Injectable()
export class StripeGatewayImpl implements StripeGateway {
  private readonly stripe: Stripe | null;
  private readonly webhookSecret: string;

  constructor(@Inject(ENV) env: Env) {
    this.stripe = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2 }) : null;
    this.webhookSecret = env.STRIPE_WEBHOOK_SECRET ?? '';
  }

  get configured(): boolean {
    return this.stripe !== null && this.webhookSecret !== '';
  }

  async createTopupIntent(input: {
    amountCents: number;
    currency: string;
    userId: string;
    paymentId: string;
    idempotencyKey: string;
  }): Promise<CreatedIntent> {
    if (!this.stripe) throw new Error('Stripe is not configured');
    const intent = await this.stripe.paymentIntents.create(
      {
        amount: input.amountCents,
        currency: input.currency.toLowerCase(),
        automatic_payment_methods: { enabled: true },
        description: 'Masterio: prepayment of platform services',
        metadata: { purpose: 'worker_topup', userId: input.userId, paymentId: input.paymentId },
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return { id: intent.id, clientSecret: intent.client_secret ?? '', status: intent.status };
  }

  constructEvent(rawBody: Buffer, signature: string): Stripe.Event {
    return Stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
  }
}
