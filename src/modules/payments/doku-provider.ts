import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  PaymentNotificationError,
  PaymentProviderError,
  type PaymentCreation,
  type PaymentProvider,
} from './provider.js';

const paymentPath = '/checkout/v1/payment';
const requestIdPattern = /^[\x21-\x7e]{1,128}$/;
const invoicePattern = /^[A-Z0-9]{1,30}$/;
const utcPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

export interface DokuConfig {
  environment: 'sandbox' | 'production';
  clientId: string;
  secretKey: string;
  notificationUrl: string;
}

export function dokuSignature(
  secretKey: string,
  clientId: string,
  requestId: string,
  timestamp: string,
  target: string,
  rawBody: Buffer | string,
) {
  const digest = createHash('sha256').update(rawBody).digest('base64');
  const components = [
    'Client-Id:' + clientId,
    'Request-Id:' + requestId,
    'Request-Timestamp:' + timestamp,
    'Request-Target:' + target,
    'Digest:' + digest,
  ];
  return (
    'HMACSHA256=' +
    createHmac('sha256', secretKey)
      .update(components.join('\n'))
      .digest('base64')
  );
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseBody(raw: string): Record<string, unknown> {
  // Preserve the original numeric token when reading money from JSON.
  return object(
    JSON.parse(raw, (key, value: unknown, context?: { source?: string }) =>
      (key === 'amount' || key === 'uuid') && typeof value === 'number'
        ? context?.source
        : value,
    ),
  );
}

function amount(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^\d{1,12}(?:\.0+)?$/.test(value))
    return null;
  return BigInt(value.split('.')[0]!);
}

function utcDate(value: unknown) {
  if (typeof value !== 'string' || !utcPattern.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 19) === value.slice(0, 19)
    ? date
    : null;
}

function expiry(value: unknown) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d, hh, mm, ss] = match;
  const local = utcDate(`${y}-${m}-${d}T${hh}:${mm}:${ss}Z`);
  return local ? new Date(local.getTime() - 7 * 3_600_000) : null;
}

export class DokuProvider implements PaymentProvider {
  readonly name = 'DOKU';
  get account() {
    return createHash('sha256')
      .update(JSON.stringify([this.config.environment, this.config.clientId]))
      .digest('hex');
  }

  constructor(
    private readonly config: DokuConfig,
    private readonly fetchPayment: typeof fetch = fetch,
    private readonly now = () => new Date(),
  ) {}

  async createPayment(input: PaymentCreation) {
    if (
      input.amount <= 0n ||
      input.amount > 999_999_999_999n ||
      !requestIdPattern.test(input.requestId) ||
      !invoicePattern.test(input.invoice)
    )
      throw new PaymentProviderError('invalid-request');

    const body = JSON.stringify({
      order: {
        // DOKU requires a JSON integer. The provider's 12-digit limit is
        // within the exact integer range of JavaScript numbers.
        amount: Number(input.amount),
        invoice_number: input.invoice,
        currency: input.currency,
        callback_url: input.returnUrl,
        callback_url_result: input.returnUrl,
        callback_url_cancel: input.returnUrl,
        auto_redirect: true,
        language: input.locale.toUpperCase(),
        recover_abandoned_cart: false,
      },
      payment: { payment_due_date: 60, type: 'SALE' },
      additional_info: {
        override_notification_url: this.config.notificationUrl,
      },
    });
    const timestamp = this.now().toISOString().slice(0, 19) + 'Z';
    const { clientId, secretKey } = this.config;
    const host =
      this.config.environment === 'production'
        ? 'api.doku.com'
        : 'api-sandbox.doku.com';
    try {
      const response = await this.fetchPayment(
        `https://${host}${paymentPath}`,
        {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(8_000),
          headers: {
            'Content-Type': 'application/json',
            'Client-Id': clientId,
            'Request-Id': input.requestId,
            'Request-Timestamp': timestamp,
            Signature: dokuSignature(
              secretKey,
              clientId,
              input.requestId,
              timestamp,
              paymentPath,
              body,
            ),
          },
          body,
        },
      );
      // An HTTP error may describe a duplicate of an already-created payment.
      // Treat ambiguous results as uncertain and retain the original attempt.
      if (response.status === 401 || response.status === 403)
        throw new PaymentProviderError('rejected');
      if (!response.ok) throw new PaymentProviderError('uncertain');
      const data = parseBody(await response.text());
      const result = object(data.response);
      const order = object(result.order);
      const payment = object(result.payment);
      const expiresAt = expiry(payment.expired_date);
      if (
        !Array.isArray(data.message) ||
        !data.message.includes('SUCCESS') ||
        order.invoice_number !== input.invoice ||
        amount(order.amount) !== input.amount ||
        (order.currency !== undefined && order.currency !== input.currency) ||
        typeof payment.url !== 'string' ||
        !expiresAt
      )
        throw new PaymentProviderError('uncertain');
      const checkoutUrl = new URL(payment.url);
      const sandboxHost = checkoutUrl.hostname === 'sandbox.doku.com';
      if (
        checkoutUrl.protocol !== 'https:' ||
        checkoutUrl.username ||
        checkoutUrl.password ||
        checkoutUrl.port ||
        !checkoutUrl.hostname.endsWith('.doku.com') ||
        sandboxHost !== (this.config.environment === 'sandbox')
      )
        throw new PaymentProviderError('uncertain');
      const reference = order.session_id ?? result.uuid;
      return {
        checkoutUrl: checkoutUrl.href,
        reference:
          typeof reference === 'string' && reference.length <= 200
            ? reference
            : null,
        expiresAt,
      };
    } catch (error) {
      if (error instanceof PaymentProviderError) throw error;
      throw new PaymentProviderError('uncertain');
    }
  }

  verifyNotification(headers: Record<string, unknown>, rawBody: Buffer) {
    const { clientId, secretKey, notificationUrl } = this.config;
    const eventId = headers['request-id'];
    const timestamp = headers['request-timestamp'];
    const signature = headers.signature;
    const requestTimestamp = utcDate(timestamp);
    if (
      headers['client-id'] !== clientId ||
      typeof eventId !== 'string' ||
      !requestIdPattern.test(eventId) ||
      typeof timestamp !== 'string' ||
      !requestTimestamp ||
      typeof signature !== 'string' ||
      !/^HMACSHA256=[A-Za-z0-9+/]{43}=$/.test(signature)
    )
      throw new PaymentNotificationError(401);
    const expected = dokuSignature(
      secretKey,
      clientId,
      eventId,
      timestamp,
      new URL(notificationUrl).pathname,
      rawBody,
    );
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))
      throw new PaymentNotificationError(401);

    let data;
    try {
      data = parseBody(
        new TextDecoder('utf-8', { fatal: true }).decode(rawBody),
      );
    } catch {
      throw new PaymentNotificationError(400);
    }
    const order = object(data.order);
    const transaction = object(data.transaction);
    const originalRequestId = transaction.original_request_id;
    const invoice = order.invoice_number;
    const value = amount(order.amount);
    const currency = order.currency ?? null;
    // Some documented channel bodies omit the UTC suffix.
    const transactionDate = transaction.date;
    const occurredAt = utcDate(
      typeof transactionDate === 'string' && !transactionDate.endsWith('Z')
        ? transactionDate + 'Z'
        : transactionDate,
    );
    if (
      typeof originalRequestId !== 'string' ||
      !requestIdPattern.test(originalRequestId) ||
      typeof invoice !== 'string' ||
      !invoicePattern.test(invoice) ||
      value === null ||
      (currency !== null &&
        (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency))) ||
      typeof transaction.status !== 'string' ||
      !/^[A-Z0-9_]{1,40}$/.test(transaction.status) ||
      !occurredAt
    )
      throw new PaymentNotificationError(400);

    const type = transaction.type;
    const completed =
      transaction.status === 'SUCCESS' &&
      (type === undefined || type === 'SALE' || type === 'INSTALLMENT');
    return {
      eventId,
      requestTimestamp,
      originalRequestId,
      invoice,
      amount: value,
      currency,
      outcome: completed ? ('PAID' as const) : ('IGNORED' as const),
      providerStatus: transaction.status,
      occurredAt,
    };
  }
}
