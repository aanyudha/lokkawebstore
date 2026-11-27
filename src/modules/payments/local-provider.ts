import { assertLocalPaymentEnvironment } from './config.js';
import {
  PaymentNotificationError,
  type PaymentCreation,
  type PaymentNotification,
  type PaymentProvider,
} from './provider.js';

export const localPaymentActions = [
  'success',
  'failed',
  'expired',
  'review',
] as const;
export type LocalPaymentAction = (typeof localPaymentActions)[number];
const outcomes = {
  success: 'PAID',
  failed: 'FAILED',
  expired: 'EXPIRED',
  review: 'REVIEW',
} as const;

export class LocalPaymentProvider implements PaymentProvider {
  readonly name = 'LOCAL';
  readonly account = 'local-development';

  constructor(
    nodeEnv: string,
    private readonly now = () => new Date(),
  ) {
    assertLocalPaymentEnvironment(nodeEnv);
  }

  async createPayment(input: PaymentCreation) {
    const orderPath = new URL(input.returnUrl).pathname.replace(
      /\/return$/,
      '',
    );
    return {
      checkoutUrl: `${orderPath}/local/${encodeURIComponent(input.requestId)}`,
      reference: null,
      expiresAt: new Date(this.now().getTime() + 60 * 60 * 1000),
    };
  }

  verifyNotification(): never {
    throw new PaymentNotificationError(401);
  }

  simulate(
    attempt: Pick<PaymentCreation, 'requestId' | 'invoice' | 'amount'> & {
      currency: string;
    },
    action: LocalPaymentAction,
    time: Date,
  ): PaymentNotification {
    return {
      eventId: `local:${attempt.requestId}:${action}`,
      originalRequestId: attempt.requestId,
      invoice: attempt.invoice,
      amount: attempt.amount,
      currency: attempt.currency,
      outcome: outcomes[action],
      providerStatus: outcomes[action],
      occurredAt: time,
      requestTimestamp: time,
    };
  }
}
