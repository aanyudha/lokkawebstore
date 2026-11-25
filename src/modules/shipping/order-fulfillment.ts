import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  financialTransactions,
  orderFulfillments,
  orders,
  orderTrackingChanges,
} from '../../db/schema/index.js';
import { FormError, textField, type Form } from '../catalog/validation.js';
import { rupiah } from '../finance/calculations.js';
import { periodMonthOf } from '../finance/ledger.js';
import type { Transaction } from '../cart/service.js';

function orderCondition(orderNumber: string) {
  return and(
    eq(orders.orderNumber, orderNumber),
    eq(orders.source, 'WEBSTORE'),
  );
}

export function createOrderFulfillment(db: Database['db']) {
  async function read(
    connection: Database['db'] | Transaction,
    orderId: string,
  ) {
    const [shipment] = await connection
      .select()
      .from(orderFulfillments)
      .where(eq(orderFulfillments.orderId, orderId));
    return shipment ?? null;
  }

  // Serialize fulfillment mutations with each other and with payment confirmation.
  async function withPaidOrder(
    orderNumber: string,
    work: (tx: Transaction, orderId: string) => Promise<void>,
  ) {
    await db.transaction(async (tx) => {
      const [order] = await tx
        .select({ id: orders.id, status: orders.status })
        .from(orders)
        .where(orderCondition(orderNumber))
        .for('update');
      if (order?.status !== 'PAID')
        throw new FormError(
          'order',
          'Only paid webstore orders can be fulfilled.',
        );
      await work(tx, order.id);
    });
  }

  return {
    ready() {
      return db
        .select({ orderNumber: orders.orderNumber })
        .from(orders)
        .leftJoin(orderFulfillments, eq(orders.id, orderFulfillments.orderId))
        .where(
          and(
            eq(orders.source, 'WEBSTORE'),
            eq(orders.status, 'PAID'),
            isNull(orderFulfillments.orderId),
          ),
        )
        .orderBy(desc(orders.updatedAt), desc(orders.id))
        .limit(20);
    },
    async lookup(orderNumber: string) {
      const [result] = await db
        .select({
          orderNumber: orders.orderNumber,
          status: orders.status,
          shippingAmount: orders.shippingAmount,
          quote: orders.shippingMethodSnapshot,
          shipment: orderFulfillments,
        })
        .from(orders)
        .leftJoin(orderFulfillments, eq(orders.id, orderFulfillments.orderId))
        .where(orderCondition(orderNumber));
      return result ?? null;
    },
    async markShipped(orderNumber: string, form: Form, adminId: string) {
      const courierName = textField(form, 'courierName', 120, true);
      const serviceName = textField(form, 'serviceName', 120, true);
      const trackingNumber = textField(form, 'trackingNumber', 120, true);
      const actualShippingCost = textField(form, 'actualShippingCost', 19)
        ? rupiah(form, 'actualShippingCost')
        : null;
      await withPaidOrder(orderNumber, async (tx, orderId) => {
        const existing = await read(tx, orderId);
        if (existing) {
          if (
            existing.courierName === courierName &&
            existing.serviceName === serviceName &&
            existing.trackingNumber === trackingNumber &&
            existing.actualShippingCost === actualShippingCost
          )
            return;
          throw new FormError(
            'order',
            'Shipment already recorded. Use the tracking correction form for resi changes.',
          );
        }
        const now = new Date();
        await tx.insert(orderFulfillments).values({
          orderId,
          courierName,
          serviceName,
          trackingNumber,
          actualShippingCost,
          status: 'SHIPPED',
          shippedAt: now,
          shippedById: adminId,
          updatedAt: now,
        });
        if (actualShippingCost !== null && actualShippingCost > 0n) {
          await tx.insert(financialTransactions).values({
            shipmentOrderId: orderId,
            source: 'WEBSTORE',
            direction: 'EXPENSE',
            type: 'SHIPPING_EXPENSE',
            category: 'TRANSPORT',
            amountRupiah: actualShippingCost,
            occurredAt: now,
            periodMonth: periodMonthOf(now),
            createdBy: adminId,
            notes: 'Shipment for ' + orderNumber,
          });
        }
      });
    },
    async correctTracking(orderNumber: string, form: Form, adminId: string) {
      const trackingNumber = textField(form, 'trackingNumber', 120, true);
      const previous = textField(form, 'previousTrackingNumber', 120, true);
      await withPaidOrder(orderNumber, async (tx, orderId) => {
        const shipment = await read(tx, orderId);
        if (!shipment)
          throw new FormError('tracking', 'Record the shipment first.');
        if (trackingNumber === shipment.trackingNumber) return;
        if (previous !== shipment.trackingNumber)
          throw new FormError(
            'tracking',
            'The tracking number changed. Review the current number and try again.',
          );
        const now = new Date();
        await tx.insert(orderTrackingChanges).values({
          orderId,
          previousTrackingNumber: previous,
          trackingNumber,
          changedById: adminId,
          createdAt: now,
        });
        await tx
          .update(orderFulfillments)
          .set({ trackingNumber, updatedAt: now })
          .where(eq(orderFulfillments.orderId, orderId));
      });
    },
    async markDelivered(orderNumber: string, adminId: string) {
      await withPaidOrder(orderNumber, async (tx, orderId) => {
        const shipment = await read(tx, orderId);
        if (!shipment)
          throw new FormError('order', 'Record the shipment first.');
        if (shipment.status === 'DELIVERED') return;
        const now = new Date();
        await tx
          .update(orderFulfillments)
          .set({
            status: 'DELIVERED',
            deliveredAt: now,
            deliveredById: adminId,
            updatedAt: now,
          })
          .where(eq(orderFulfillments.orderId, orderId));
      });
    },
  };
}
