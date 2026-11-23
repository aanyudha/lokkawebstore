import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  orders,
  paymentAttempts,
  paymentNotifications,
} from '../../db/schema/index.js';
import { lockOrderStock, postPaidWebstoreSale } from '../sales/webstore.js';
import {
  PaymentProviderError,
  type HostedPayment,
  type PaymentProvider,
} from './provider.js';

type Order = typeof orders.$inferSelect;
type Attempt = typeof paymentAttempts.$inferSelect;
type Result =
  | { status: 'redirect'; checkoutUrl: string }
  | { status: 'processing' | 'failed' | 'ineligible' | 'missing' };

export function merchantInvoice(orderNumber: string, sequence: number) {
  const normalized = /^WEB-(\d{8})-(\d{6,10})$/.exec(orderNumber);
  if (
    !normalized ||
    !Number.isInteger(sequence) ||
    sequence < 1 ||
    sequence > 2147483647
  )
    throw new Error('Invalid web order invoice identity');
  return `W${normalized[1]}N${normalized[2]}P${sequence.toString(36).toUpperCase()}`;
}

export function createPaymentService(
  db: Database['db'],
  provider: PaymentProvider,
  canPay: (order: Order) => boolean,
  now = () => new Date(),
) {
  async function createPayment(input: {
    customerId: string;
    orderNumber: string;
    locale: 'en' | 'id';
    returnUrl: string;
  }): Promise<Result> {
    const prepared = await db.transaction<Result | { attempt: Attempt }>(
      async (tx) => {
        const [order] = await tx
          .select()
          .from(orders)
          .where(
            and(
              eq(orders.customerId, input.customerId),
              eq(orders.orderNumber, input.orderNumber),
            ),
          )
          .for('update');
        if (!order) return { status: 'missing' } as const;
        if (
          order.status !== 'PENDING_PAYMENT' ||
          order.currency !== 'IDR' ||
          order.grandTotal <= 0n ||
          !canPay(order)
        )
          return { status: 'ineligible' } as const;
        const [blocked] = await tx
          .select({ id: paymentAttempts.id })
          .from(paymentAttempts)
          .where(
            and(
              eq(paymentAttempts.orderId, order.id),
              eq(paymentAttempts.status, 'REVIEW'),
            ),
          )
          .limit(1);
        if (blocked) return { status: 'processing' } as const;
        const [previous] = await tx
          .select()
          .from(paymentAttempts)
          .where(eq(paymentAttempts.orderId, order.id))
          .orderBy(desc(paymentAttempts.sequence))
          .limit(1);
        if (previous?.status === 'CREATED')
          return { status: 'processing' } as const;
        const time = now();
        if (previous?.status === 'PENDING') {
          if (!previous.expiresAt || previous.expiresAt > time) {
            return previous.checkoutUrl
              ? ({
                  status: 'redirect',
                  checkoutUrl: previous.checkoutUrl,
                } as const)
              : ({ status: 'processing' } as const);
          }
          await tx
            .update(paymentAttempts)
            .set({
              status: 'EXPIRED',
              expiredAt: previous.expiresAt,
              updatedAt: time,
            })
            .where(eq(paymentAttempts.id, previous.id));
        }
        if (!(await lockOrderStock(tx, order.id)))
          return { status: 'ineligible' } as const;
        const sequence = (previous?.sequence ?? 0) + 1;
        const [attempt] = await tx
          .insert(paymentAttempts)
          .values({
            orderId: order.id,
            provider: provider.name,
            invoice: merchantInvoice(order.orderNumber, sequence),
            requestId: randomUUID(),
            amount: order.grandTotal,
            currency: 'IDR',
            sequence,
            createdAt: time,
            updatedAt: time,
          })
          .returning();
        return { attempt: attempt! };
      },
    );
    if ('status' in prepared) return prepared;

    const { attempt } = prepared;
    let hosted: HostedPayment;
    try {
      hosted = await provider.createPayment({
        invoice: attempt.invoice,
        requestId: attempt.requestId,
        amount: attempt.amount,
        currency: 'IDR',
        returnUrl: input.returnUrl,
        locale: input.locale,
      });
    } catch (error) {
      if (
        !(error instanceof PaymentProviderError) ||
        error.reason === 'uncertain'
      )
        return { status: 'processing' };
      const time = now();
      await txUpdateCreated(attempt, {
        status: 'FAILED',
        failedAt: time,
        updatedAt: time,
      });
      return { status: 'failed' };
    }
    const [updated] = await txUpdateCreated(attempt, {
      status: 'PENDING',
      checkoutUrl: hosted.checkoutUrl,
      providerReference: hosted.reference,
      expiresAt: hosted.expiresAt,
      updatedAt: now(),
    });
    return updated
      ? { status: 'redirect', checkoutUrl: hosted.checkoutUrl }
      : { status: 'processing' };
  }

  function txUpdateCreated(attempt: Attempt, values: Partial<Attempt>) {
    // A verified notification can win the race with the HTTP response.
    return db
      .update(paymentAttempts)
      .set(values)
      .where(
        and(
          eq(paymentAttempts.id, attempt.id),
          eq(paymentAttempts.status, 'CREATED'),
        ),
      )
      .returning({ id: paymentAttempts.id });
  }

  async function handleNotification(
    headers: Record<string, unknown>,
    body: Buffer,
  ) {
    const event = provider.verifyNotification(headers, body);
    return db.transaction(async (tx) => {
      const [candidate] = await tx
        .select()
        .from(paymentAttempts)
        .where(
          and(
            eq(paymentAttempts.provider, provider.name),
            eq(paymentAttempts.invoice, event.invoice),
          ),
        );
      // Use the same lock order as initiation and cancellation.
      const [order] = candidate
        ? await tx
            .select()
            .from(orders)
            .where(eq(orders.id, candidate.orderId))
            .for('update')
        : [];
      const [attempt] = candidate
        ? await tx
            .select()
            .from(paymentAttempts)
            .where(eq(paymentAttempts.id, candidate.id))
            .for('update')
        : [];
      const [inserted] = await tx
        .insert(paymentNotifications)
        .values({
          ...event,
          provider: provider.name,
          attemptId: attempt?.id,
          result: 'RECEIVED',
        })
        .onConflictDoNothing()
        .returning({ id: paymentNotifications.id });
      const [existing] = inserted
        ? []
        : await tx
            .select()
            .from(paymentNotifications)
            .where(
              and(
                eq(paymentNotifications.provider, provider.name),
                eq(paymentNotifications.eventId, event.eventId),
              ),
            );
      if (
        existing &&
        (existing.invoice !== event.invoice ||
          existing.originalRequestId !== event.originalRequestId ||
          existing.amount !== event.amount ||
          existing.currency !== event.currency ||
          existing.outcome !== event.outcome ||
          existing.providerStatus !== event.providerStatus ||
          existing.occurredAt.getTime() !== event.occurredAt.getTime())
      )
        return 'EVENT_CONFLICT';
      if (existing && existing.result !== 'STOCK_REVIEW')
        return existing.result;
      const receiptId = inserted?.id ?? existing!.id;
      const time = now();
      async function record(result: string) {
        await tx
          .update(paymentNotifications)
          .set({ result, updatedAt: time })
          .where(eq(paymentNotifications.id, receiptId));
        return result;
      }
      if (!attempt || !order) return record('UNKNOWN_PAYMENT');
      if (event.originalRequestId !== attempt.requestId)
        return record('REQUEST_MISMATCH');
      if (
        event.amount !== attempt.amount ||
        event.amount !== order.grandTotal ||
        attempt.currency !== order.currency ||
        (event.currency !== null && event.currency !== order.currency)
      )
        return record('MONEY_MISMATCH');
      if (event.outcome !== 'PAID') return record('IGNORED');
      if (attempt.status === 'PAID') return record('ALREADY_PAID');
      if (order.status !== 'PENDING_PAYMENT') {
        await tx
          .update(paymentAttempts)
          .set({ status: 'REVIEW', paidAt: event.occurredAt, updatedAt: time })
          .where(eq(paymentAttempts.id, attempt.id));
        return record(
          order.status === 'PAID' ? 'LATE_SUCCESS' : 'INELIGIBLE_ORDER',
        );
      }
      const stock = await lockOrderStock(tx, order.id);
      if (!stock) {
        await tx
          .update(paymentAttempts)
          .set({ status: 'REVIEW', paidAt: event.occurredAt, updatedAt: time })
          .where(eq(paymentAttempts.id, attempt.id));
        return record('STOCK_REVIEW');
      }
      await postPaidWebstoreSale(tx, order, stock, event.occurredAt, time);
      await tx
        .update(paymentAttempts)
        .set({ status: 'PAID', paidAt: event.occurredAt, updatedAt: time })
        .where(eq(paymentAttempts.id, attempt.id));
      await tx
        .update(paymentAttempts)
        .set({ status: 'CANCELLED', updatedAt: time })
        .where(
          and(
            eq(paymentAttempts.orderId, order.id),
            inArray(paymentAttempts.status, ['CREATED', 'PENDING']),
          ),
        );
      await tx
        .update(orders)
        .set({ status: 'PAID', updatedAt: time })
        .where(eq(orders.id, order.id));
      return record('PAID');
    });
  }

  async function status(orderId: string) {
    const attempts = await db
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.orderId, orderId))
      .orderBy(desc(paymentAttempts.sequence));
    const latest =
      attempts.find((attempt) => attempt.status === 'PAID') ??
      attempts.find((attempt) => attempt.status === 'REVIEW') ??
      attempts[0];
    if (
      latest?.status === 'PENDING' &&
      latest.expiresAt &&
      latest.expiresAt <= now()
    )
      return { ...latest, status: 'EXPIRED' as const };
    return latest ?? null;
  }

  return { createPayment, handleNotification, status };
}
