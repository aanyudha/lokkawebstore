import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  orderFulfillments,
  orderItems,
  orders,
} from '../../db/schema/index.js';
import {
  orderItemCount,
  orderPresentationFacts,
} from './presentation-facts.js';

const filters = {
  waiting: ['WAITING_FOR_PAYMENT'],
  processing: ['PAYMENT_PROCESSING', 'PAYMENT_REVIEW', 'PREPARING_ORDER'],
  shipped: ['SHIPPED'],
  delivered: ['DELIVERED'],
  cancelled: ['CANCELLED'],
} as const;
type Filter = 'all' | keyof typeof filters;
export const historyFilters = ['all', ...Object.keys(filters)] as Filter[];
const pageSize = 12;
const maxPage = Math.floor(Number.MAX_SAFE_INTEGER / pageSize);

export function historySuffix(filter: Filter, page: number) {
  const query = new URLSearchParams();
  if (filter !== 'all') query.set('status', filter);
  if (page > 1) query.set('page', String(page));
  const search = query.toString();
  return search ? `?${search}` : '';
}

export function createOrderHistory(db: Database['db']) {
  async function list(
    customerId: string,
    input: { status?: unknown; page?: unknown },
  ) {
    const filter =
      historyFilters.find((option) => option === input.status) ?? 'all';
    const value =
      typeof input.page === 'string' && /^\d{1,16}$/.test(input.page)
        ? Number(input.page)
        : 1;
    const page = value >= 1 && value <= maxPage ? value : 1;
    const { payment, status } = orderPresentationFacts(db, new Date());
    const rows = await db
      .select({
        orderNumber: orders.orderNumber,
        createdAt: orders.createdAt,
        grandTotal: orders.grandTotal,
        status,
        paymentStatus: sql<
          typeof payment.status._.type | null
        >`${payment.status}`,
        shipmentStatus: orderFulfillments.status,
        itemCount: orderItemCount,
      })
      .from(orders)
      .leftJoinLateral(payment, sql`true`)
      .leftJoin(orderFulfillments, eq(orderFulfillments.orderId, orders.id))
      .where(
        and(
          eq(orders.customerId, customerId),
          filter === 'all' ? undefined : inArray(status, filters[filter]),
        ),
      )
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(pageSize + 1)
      .offset((page - 1) * pageSize);
    return {
      orders: rows.slice(0, pageSize),
      filter,
      page,
      hasNext: rows.length > pageSize,
    };
  }

  async function detail(customerId: string, orderNumber: string) {
    const { payment, status } = orderPresentationFacts(db, new Date());
    const [result] = await db
      .select({
        order: orders,
        status,
        payment: {
          provider: payment.provider,
          status: payment.status,
          amount: payment.amount,
          createdAt: payment.createdAt,
          paidAt: payment.paidAt,
        },
        shipment: {
          courierName: orderFulfillments.courierName,
          serviceName: orderFulfillments.serviceName,
          trackingNumber: orderFulfillments.trackingNumber,
          status: orderFulfillments.status,
          shippedAt: orderFulfillments.shippedAt,
          deliveredAt: orderFulfillments.deliveredAt,
        },
      })
      .from(orders)
      .leftJoinLateral(payment, sql`true`)
      .leftJoin(orderFulfillments, eq(orderFulfillments.orderId, orders.id))
      .where(
        and(
          eq(orders.customerId, customerId),
          eq(orders.orderNumber, orderNumber),
        ),
      );
    if (!result) return null;
    const items = await db
      .select({
        productNameSnapshot: orderItems.productNameSnapshot,
        variantNameSnapshot: orderItems.variantNameSnapshot,
        skuSnapshot: orderItems.skuSnapshot,
        unitPriceSnapshot: orderItems.unitPriceSnapshot,
        quantity: orderItems.quantity,
        lineTotalSnapshot: orderItems.lineTotalSnapshot,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, result.order.id))
      .orderBy(orderItems.id);
    return {
      ...result,
      items,
      payment: result.payment?.provider ? result.payment : null,
    };
  }
  return { list, detail };
}
