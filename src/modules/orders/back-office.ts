import {
  and,
  count,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  adminUsers,
  customers,
  financialTransactions,
  inventoryMovements,
  orderFulfillments,
  orderItems,
  orders,
  orderTrackingChanges,
  paymentAttempts,
  paymentNotifications,
  saleItems,
  sales,
} from '../../db/schema/index.js';
import { listInput, pagination, searchPattern } from '../catalog/listing.js';
import { FormError } from '../catalog/validation.js';
import { effectivePaymentStatus } from '../payments/read-model.js';
import {
  orderItemCount,
  orderPresentationFacts,
  type CustomerStatus,
} from './presentation-facts.js';

export const orderLabels: Record<CustomerStatus, string> = {
  WAITING_FOR_PAYMENT: 'Waiting for payment',
  PAYMENT_PROCESSING: 'Payment processing',
  PAYMENT_REVIEW: 'Payment review',
  PREPARING_ORDER: 'Ready to ship',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
};
export const paymentLabels: Record<
  typeof paymentAttempts.$inferSelect.status,
  string
> = {
  CREATED: 'Initiated',
  PENDING: 'Awaiting confirmation',
  REVIEW: 'Under review',
  PAID: 'Confirmed',
  FAILED: 'Failed',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
};
export const notificationLabels: Record<string, string> = {
  RECEIVED: 'Received',
  PAID: 'Payment confirmed and posted',
  ALREADY_PAID: 'Payment already confirmed',
  IGNORED: 'No payment confirmation',
  STOCK_REVIEW: 'Stock shortfall',
  LATE_SUCCESS: 'Late success after payment already confirmed',
  MONEY_MISMATCH: 'Amount or currency mismatch',
  ACCOUNT_MISMATCH: 'Provider account mismatch',
  REQUEST_MISMATCH: 'Payment request mismatch',
  INELIGIBLE_ORDER: 'Success received for an ineligible order',
  UNKNOWN_PAYMENT: 'Payment attempt unavailable',
};
const reviewResults = [
  'STOCK_REVIEW',
  'LATE_SUCCESS',
  'MONEY_MISMATCH',
  'ACCOUNT_MISMATCH',
  'REQUEST_MISMATCH',
  'INELIGIBLE_ORDER',
];
export const orderFilters = [
  ['all', 'All'],
  ['waiting', orderLabels.WAITING_FOR_PAYMENT],
  ['processing', orderLabels.PAYMENT_PROCESSING],
  ['review', orderLabels.PAYMENT_REVIEW],
  ['ready', orderLabels.PREPARING_ORDER],
  ['shipped', orderLabels.SHIPPED],
  ['delivered', orderLabels.DELIVERED],
  ['cancelled', orderLabels.CANCELLED],
] as const;
const filterStatuses = {
  waiting: 'WAITING_FOR_PAYMENT',
  processing: 'PAYMENT_PROCESSING',
  ready: 'PREPARING_ORDER',
  shipped: 'SHIPPED',
  delivered: 'DELIVERED',
  cancelled: 'CANCELLED',
} as const;
export const adminOrdersPath = '/admin/orders';
const webstore = eq(orders.source, 'WEBSTORE');

function needsReview(db: Pick<Database['db'], 'select'>) {
  return exists(
    db
      .select({ one: sql`1` })
      .from(paymentAttempts)
      .where(
        and(
          eq(paymentAttempts.orderId, orders.id),
          or(
            eq(paymentAttempts.status, 'REVIEW'),
            exists(
              db
                .select({ one: sql`1` })
                .from(paymentNotifications)
                .where(
                  and(
                    eq(paymentNotifications.attemptId, paymentAttempts.id),
                    inArray(paymentNotifications.result, reviewResults),
                  ),
                ),
            ),
          ),
        ),
      ),
  );
}

export function createBackOfficeOrders(db: Database['db']) {
  async function list(query: Record<string, unknown>) {
    const input = listInput(query);
    if (input.q.includes('\0'))
      throw new FormError('q', 'Enter valid search text.');
    const filter = orderFilters.find(
      ([key]) => key === (query.status ?? 'all'),
    )?.[0];
    if (!filter) throw new FormError('status', 'Choose a valid order status.');
    const { payment, status } = orderPresentationFacts(db, new Date());
    const review = needsReview(db);
    const match = input.q ? searchPattern(input.q) : '';
    const where = and(
      webstore,
      match
        ? or(
            ilike(orders.orderNumber, match),
            ilike(customers.name, match),
            ilike(customers.email, match),
            ilike(orderFulfillments.trackingNumber, match),
          )
        : undefined,
      filter === 'review'
        ? review
        : filter === 'all'
          ? undefined
          : eq(status, filterStatuses[filter]),
    );
    const [rows, totals] = await Promise.all([
      db
        .select({
          orderNumber: orders.orderNumber,
          createdAt: orders.createdAt,
          customerName: customers.name,
          email: customers.email,
          status,
          grandTotal: orders.grandTotal,
          itemCount: orderItemCount,
          paymentStatus: payment.status,
          shipmentStatus: orderFulfillments.status,
          courier: orderFulfillments.courierName,
          tracking: orderFulfillments.trackingNumber,
          review: sql<boolean>`${review}`,
        })
        .from(orders)
        .innerJoin(customers, eq(customers.id, orders.customerId))
        .leftJoinLateral(payment, sql`true`)
        .leftJoin(orderFulfillments, eq(orderFulfillments.orderId, orders.id))
        .where(where)
        .orderBy(desc(orders.createdAt), desc(orders.id))
        .limit(input.limit)
        .offset(input.offset),
      db
        .select({ total: count() })
        .from(orders)
        .innerJoin(customers, eq(customers.id, orders.customerId))
        .leftJoinLateral(payment, sql`true`)
        .leftJoin(orderFulfillments, eq(orderFulfillments.orderId, orders.id))
        .where(where),
    ]);
    return {
      rows,
      filter,
      listing: pagination(
        totals[0]!.total,
        input,
        adminOrdersPath,
        filter === 'all' ? {} : { status: filter },
      ),
    };
  }

  return {
    list,
    detail(orderNumber: string) {
      return db.transaction(
        async (tx) => {
          const now = new Date();
          const { payment, status } = orderPresentationFacts(tx, now);
          const [detail] = await tx
            .select({
              order: orders,
              customer: { name: customers.name, email: customers.email },
              status,
              effectivePaymentStatus: payment.status,
              effectiveSequence: payment.sequence,
              review: sql<boolean>`${needsReview(tx)}`,
              shipment: orderFulfillments,
              sale: {
                id: sales.id,
                reference: sales.transactionNumber,
                status: sales.status,
              },
              inventoryPosted: sql<boolean>`${exists(
                tx
                  .select({ one: sql`1` })
                  .from(inventoryMovements)
                  .where(
                    and(
                      eq(inventoryMovements.referenceType, 'SALE'),
                      eq(inventoryMovements.referenceId, sales.id),
                      eq(inventoryMovements.type, 'SALE'),
                    ),
                  ),
              )}`,
              postedCosts: sql<boolean>`${exists(
                tx
                  .select({ one: sql`1` })
                  .from(saleItems)
                  .where(eq(saleItems.saleId, sales.id)),
              )}`,
              missingCosts: sql<boolean>`${exists(
                tx
                  .select({ one: sql`1` })
                  .from(saleItems)
                  .where(
                    and(
                      eq(saleItems.saleId, sales.id),
                      isNull(saleItems.costSnapshot),
                    ),
                  ),
              )}`,
              incomePosted: sql<boolean>`${exists(
                tx
                  .select({ one: sql`1` })
                  .from(financialTransactions)
                  .where(
                    and(
                      eq(financialTransactions.saleId, sales.id),
                      eq(financialTransactions.source, 'WEBSTORE'),
                      eq(financialTransactions.status, 'POSTED'),
                      eq(financialTransactions.direction, 'INCOME'),
                    ),
                  ),
              )}`,
              shippingExpensePosted: sql<boolean>`${exists(
                tx
                  .select({ one: sql`1` })
                  .from(financialTransactions)
                  .where(
                    and(
                      eq(financialTransactions.shipmentOrderId, orders.id),
                      eq(financialTransactions.type, 'SHIPPING_EXPENSE'),
                      eq(financialTransactions.status, 'POSTED'),
                    ),
                  ),
              )}`,
            })
            .from(orders)
            .innerJoin(customers, eq(customers.id, orders.customerId))
            .leftJoinLateral(payment, sql`true`)
            .leftJoin(
              orderFulfillments,
              eq(orderFulfillments.orderId, orders.id),
            )
            .leftJoin(
              sales,
              and(eq(sales.orderId, orders.id), eq(sales.source, 'WEBSTORE')),
            )
            .where(and(webstore, eq(orders.orderNumber, orderNumber)));
          if (!detail) return null;
          const id = detail.order.id;
          const items = await tx
            .select()
            .from(orderItems)
            .where(eq(orderItems.orderId, id))
            .orderBy(orderItems.id);
          const attempts = await tx
            .select({
              sequence: paymentAttempts.sequence,
              provider: paymentAttempts.provider,
              invoice: paymentAttempts.invoice,
              amount: paymentAttempts.amount,
              status: effectivePaymentStatus(now),
              reference: paymentAttempts.providerReference,
              createdAt: paymentAttempts.createdAt,
              paidAt: paymentAttempts.paidAt,
              expiredAt:
                sql<Date | null>`coalesce(${paymentAttempts.expiredAt}, case when ${paymentAttempts.status} = 'PENDING' and ${paymentAttempts.expiresAt} <= ${now.toISOString()}::timestamptz then ${paymentAttempts.expiresAt} end)`.mapWith(
                  paymentAttempts.expiredAt,
                ),
              failedAt: paymentAttempts.failedAt,
            })
            .from(paymentAttempts)
            .where(eq(paymentAttempts.orderId, id))
            .orderBy(desc(paymentAttempts.sequence));
          const notifications = await tx
            .select({
              sequence: paymentAttempts.sequence,
              expected: paymentAttempts.amount,
              received: paymentNotifications.amount,
              currency: paymentNotifications.currency,
              outcome: paymentNotifications.outcome,
              result: paymentNotifications.result,
              occurredAt: paymentNotifications.occurredAt,
            })
            .from(paymentNotifications)
            .innerJoin(
              paymentAttempts,
              eq(paymentAttempts.id, paymentNotifications.attemptId),
            )
            .where(eq(paymentAttempts.orderId, id))
            .orderBy(
              desc(paymentNotifications.occurredAt),
              desc(paymentNotifications.id),
            );
          const tracking = await tx
            .select({
              previous: orderTrackingChanges.previousTrackingNumber,
              current: orderTrackingChanges.trackingNumber,
              date: orderTrackingChanges.createdAt,
              staff: adminUsers.name,
            })
            .from(orderTrackingChanges)
            .innerJoin(
              adminUsers,
              eq(adminUsers.id, orderTrackingChanges.changedById),
            )
            .where(eq(orderTrackingChanges.orderId, id))
            .orderBy(
              desc(orderTrackingChanges.createdAt),
              desc(orderTrackingChanges.id),
            );
          return { ...detail, items, attempts, notifications, tracking };
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
    },
  };
}
