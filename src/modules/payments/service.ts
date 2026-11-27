import { randomUUID } from 'node:crypto';
import { and, desc, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  orders,
  paymentAttempts,
  paymentNotifications,
} from '../../db/schema/index.js';
import type { Transaction } from '../cart/service.js';
import {
  LocalPaymentProvider,
  type LocalPaymentAction,
} from './local-provider.js';
import { lockOrderStock, postPaidWebstoreSale } from '../sales/webstore.js';
import { effectivePaymentOrder, effectivePaymentStatus } from './read-model.js';
import {
  PaymentProviderError,
  type HostedPayment,
  type PaymentNotification,
  type PaymentProvider,
} from './provider.js';

type Order = typeof orders.$inferSelect;
type Attempt = typeof paymentAttempts.$inferSelect;
type Result =
  | { status: 'redirect'; checkoutUrl: string }
  | { status: 'processing' | 'failed' | 'ineligible' | 'missing' };

export function isPayableWebstoreOrder(order: Order) {
  return (
    order.source === 'WEBSTORE' &&
    order.status === 'PENDING_PAYMENT' &&
    order.currency === 'IDR' &&
    order.grandTotal > 0n &&
    order.shippingAddressSnapshot !== null &&
    order.shippingMethodSnapshot !== null &&
    (order.shipmentWeightGrams ?? 0n) > 0n
  );
}

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
        if (!isPayableWebstoreOrder(order))
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
            return previous.provider === provider.name &&
              previous.providerAccount === provider.account &&
              previous.amount === order.grandTotal &&
              previous.checkoutUrl
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
            providerAccount: provider.account,
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
      const [updated] = await txUpdateCreated(attempt, {
        status: 'FAILED',
        failedAt: time,
        updatedAt: time,
      });
      return { status: updated ? 'failed' : 'processing' };
    }
    const [updated] = await db
      .update(paymentAttempts)
      .set({
        status: sql`case when ${paymentAttempts.status} = 'CREATED' then 'PENDING'::web_payment_status else ${paymentAttempts.status} end`,
        checkoutUrl: hosted.checkoutUrl,
        providerReference: hosted.reference,
        expiresAt: hosted.expiresAt,
        updatedAt: now(),
      })
      .where(eq(paymentAttempts.id, attempt.id))
      .returning({ status: paymentAttempts.status });
    return updated?.status === 'PENDING' && hosted.expiresAt > now()
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
      return settle(tx, event, order, attempt);
    });
  }

  async function settle(
    tx: Transaction,
    event: PaymentNotification,
    order: Order | undefined,
    attempt: Attempt | undefined,
  ) {
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
    if (existing && existing.result !== 'STOCK_REVIEW') return existing.result;
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
    if (attempt.providerAccount !== provider.account)
      return record('ACCOUNT_MISMATCH');
    if (event.originalRequestId !== attempt.requestId)
      return record('REQUEST_MISMATCH');
    if (
      event.amount !== attempt.amount ||
      event.amount !== order.grandTotal ||
      attempt.currency !== order.currency ||
      (event.currency !== null && event.currency !== order.currency)
    )
      return record('MONEY_MISMATCH');
    if (event.outcome !== 'PAID') {
      if (
        event.outcome === 'IGNORED' ||
        !(provider instanceof LocalPaymentProvider)
      )
        return record('IGNORED');
      await tx
        .update(paymentAttempts)
        .set({
          status: event.outcome,
          ...(event.outcome === 'FAILED' ? { failedAt: event.occurredAt } : {}),
          ...(event.outcome === 'EXPIRED'
            ? { expiredAt: event.occurredAt }
            : {}),
          updatedAt: time,
        })
        .where(eq(paymentAttempts.id, attempt.id));
      return record('LOCAL_' + event.outcome);
    }
    if (attempt.status === 'PAID') return record('ALREADY_PAID');
    if (!isPayableWebstoreOrder(order)) {
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
  }

  const localProvider =
    provider instanceof LocalPaymentProvider ? provider : null;
  type LocalCheckout = {
    customerId: string;
    orderNumber: string;
    requestId: string;
  };
  function ownedOrder(
    connection: Database['db'] | Transaction,
    input: LocalCheckout,
  ) {
    return connection
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.customerId, input.customerId),
          eq(orders.orderNumber, input.orderNumber),
        ),
      );
  }
  function localAttempt(
    connection: Database['db'] | Transaction,
    orderId: string,
    requestId: string,
  ) {
    return connection
      .select()
      .from(paymentAttempts)
      .where(
        and(
          eq(paymentAttempts.orderId, orderId),
          eq(paymentAttempts.requestId, requestId),
          eq(paymentAttempts.provider, provider.name),
          eq(paymentAttempts.providerAccount, provider.account),
        ),
      );
  }
  function canSimulate(order: Order, attempt: Attempt, time: Date) {
    return (
      isPayableWebstoreOrder(order) &&
      attempt.status === 'PENDING' &&
      !!attempt.expiresAt &&
      attempt.expiresAt > time
    );
  }
  const local = localProvider && {
    async detail(input: LocalCheckout) {
      const [order] = await ownedOrder(db, input);
      if (!order) return null;
      const [attempt] = await localAttempt(db, order.id, input.requestId);
      if (!attempt) return null;
      const time = now();
      return {
        amount: attempt.amount,
        status:
          attempt.status === 'PENDING' &&
          attempt.expiresAt &&
          attempt.expiresAt <= time
            ? 'EXPIRED'
            : attempt.status,
        canSimulate: canSimulate(order, attempt, time),
      };
    },
    simulate(input: LocalCheckout, action: LocalPaymentAction) {
      return db.transaction(async (tx) => {
        const [order] = await ownedOrder(tx, input).for('update');
        if (!order) return 'missing';
        const [attempt] = await localAttempt(tx, order.id, input.requestId).for(
          'update',
        );
        if (!attempt) return 'missing';
        const time = now();
        const event = localProvider.simulate(attempt, action, time);
        const [prior] = await tx
          .select({ occurredAt: paymentNotifications.occurredAt })
          .from(paymentNotifications)
          .where(
            and(
              eq(paymentNotifications.provider, provider.name),
              eq(paymentNotifications.eventId, event.eventId),
            ),
          );
        if (!prior && !canSimulate(order, attempt, time)) return 'ineligible';
        // Replay the original event, including its timestamp, under the order lock.
        return settle(
          tx,
          prior
            ? {
                ...event,
                occurredAt: prior.occurredAt,
                requestTimestamp: prior.occurredAt,
              }
            : event,
          order,
          attempt,
        );
      });
    },
  };

  return {
    createPayment,
    handleNotification,
    local,
    status: (orderId: string) => readPaymentStatus(db, orderId, now()),
  };
}

export async function readPaymentStatus(
  db: Database['db'],
  orderId: string,
  now = new Date(),
) {
  const [attempt] = await db
    .select({
      ...getTableColumns(paymentAttempts),
      status: effectivePaymentStatus(now),
    })
    .from(paymentAttempts)
    .where(eq(paymentAttempts.orderId, orderId))
    .orderBy(...effectivePaymentOrder)
    .limit(1);
  return attempt ?? null;
}
