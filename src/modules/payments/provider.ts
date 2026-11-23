export interface PaymentCreation {
  invoice: string;
  requestId: string;
  amount: bigint;
  currency: 'IDR';
  returnUrl: string;
  locale: 'en' | 'id';
}

export interface HostedPayment {
  checkoutUrl: string;
  reference: string | null;
  expiresAt: Date;
}

export interface PaymentNotification {
  eventId: string;
  requestTimestamp: Date;
  originalRequestId: string;
  invoice: string;
  amount: bigint;
  currency: string | null;
  outcome: 'PAID' | 'IGNORED';
  providerStatus: string;
  occurredAt: Date;
}

export interface PaymentProvider {
  readonly name: string;
  readonly account: string;
  createPayment(input: PaymentCreation): Promise<HostedPayment>;
  verifyNotification(
    headers: Record<string, unknown>,
    body: Buffer,
  ): PaymentNotification;
}

export class PaymentProviderError extends Error {
  constructor(readonly reason: 'invalid-request' | 'rejected' | 'uncertain') {
    super(reason);
  }
}

export class PaymentNotificationError extends Error {
  constructor(readonly statusCode: 400 | 401) {
    super('Invalid payment notification');
  }
}
