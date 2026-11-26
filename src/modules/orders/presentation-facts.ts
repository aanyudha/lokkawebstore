import { eq, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  orderFulfillments,
  orderItems,
  orders,
  paymentAttempts,
} from '../../db/schema/index.js';
import {
  effectivePaymentOrder,
  effectivePaymentStatus,
} from '../payments/read-model.js';

export type CustomerStatus =
  | 'WAITING_FOR_PAYMENT'
  | 'PAYMENT_PROCESSING'
  | 'PAYMENT_REVIEW'
  | 'PREPARING_ORDER'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'COMPLETED';

export const orderItemCount = sql<string>`(select coalesce(sum(${orderItems.quantity}), 0)::text from ${orderItems} where ${orderItems.orderId} = ${orders.id})`;

export function orderPresentationFacts(
  db: Pick<Database['db'], 'select'>,
  now: Date,
) {
  const payment = db
    .select({
      status: effectivePaymentStatus(now).as('effective_status'),
      provider: paymentAttempts.provider,
      amount: paymentAttempts.amount,
      createdAt: paymentAttempts.createdAt,
      paidAt: paymentAttempts.paidAt,
      sequence: paymentAttempts.sequence,
    })
    .from(paymentAttempts)
    .where(eq(paymentAttempts.orderId, orders.id))
    .orderBy(...effectivePaymentOrder)
    .limit(1)
    .as('effective_payment');

  const status = sql<CustomerStatus>`case
    when ${orders.status} = 'CANCELLED' then 'CANCELLED'
    when ${orderFulfillments.status} = 'DELIVERED' then 'DELIVERED'
    when ${orderFulfillments.status} = 'SHIPPED' then 'SHIPPED'
    when ${orders.status} = 'PAID' then 'PREPARING_ORDER'
    when ${orders.status} = 'COMPLETED' then 'COMPLETED'
    when ${payment.status} = 'REVIEW' then 'PAYMENT_REVIEW'
    when ${payment.status} in ('CREATED', 'PENDING') then 'PAYMENT_PROCESSING'
    else 'WAITING_FOR_PAYMENT'
  end`;
  return { payment, status };
}
