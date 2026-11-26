import { randomUUID } from 'node:crypto';
import { buildApp } from '../../src/app.js';
import { readEnv } from '../../src/config/env.js';
import {
  financialTransactions,
  inventoryMovements,
  orderFulfillments,
  orderItems,
  orders,
  paymentAttempts,
  saleItems,
  sales,
} from '../../src/db/schema/index.js';
import { addressSnapshot } from '../../src/modules/customer/addresses.js';
import { saveCheckoutAddress } from './checkout-fixture.js';
import { dokuFixture } from './doku-fixture.js';
import { storefrontNavigationFixture } from './storefront-navigation-fixture.js';

export const historyBase = 'http://127.0.0.1:3057';

export async function orderHistoryFixture(paymentFetch: typeof fetch) {
  const f = await storefrontNavigationFixture();
  try {
    const customerId = f.customer.customer.id;
    const other = await f.auth.register(
      {
        name: 'Other buyer',
        email: 'other-history@example.test',
        password: 'temporary-customer-password',
      },
      null,
      null,
    );
    const address = addressSnapshot(
      await saveCheckoutAddress(f.db, customerId),
    );
    type OrderStatus = typeof orders.$inferSelect.status;
    async function order(
      sequence: number,
      status: OrderStatus,
      owner = customerId,
      legacy = false,
    ) {
      const createdAt = new Date(
        Date.UTC(2026, 10, 20, 0, Math.min(sequence, 50)),
      );
      const [row] = await f.db
        .insert(orders)
        .values({
          orderNumber: `WEB-20261120-${String(sequence).padStart(6, '0')}`,
          customerId: owner,
          idempotencyKey: randomUUID(),
          status,
          createdAt,
          subtotal: 150000n,
          shippingAmount: legacy ? 0n : 22000n,
          discountAmount: 2000n,
          grandTotal: legacy ? 148000n : 170000n,
          ...(!legacy
            ? {
                shippingAddressSnapshot: address,
                shippingMethodSnapshot: {
                  code: 'EZ',
                  name: 'EZ',
                  description: null,
                  courierName: 'J&T Express',
                  serviceName: 'EZ',
                  etaText: '2–3 days',
                },
                shipmentWeightGrams: 650n,
              }
            : {}),
        })
        .returning();
      return row!;
    }
    const pending = await order(30, 'PENDING_PAYMENT');
    const preparing = await order(31, 'PAID');
    const shipped = await order(32, 'PAID');
    const delivered = await order(33, 'PAID');
    const cancelled = await order(34, 'CANCELLED');
    const review = await order(35, 'PENDING_PAYMENT');
    const processing = await order(36, 'PENDING_PAYMENT');
    const expired = await order(37, 'PENDING_PAYMENT');
    const created = await order(38, 'PENDING_PAYMENT');
    const legacy = await order(39, 'PENDING_PAYMENT', customerId, true);
    const foreign = await order(40, 'PENDING_PAYMENT', other.customer!.id);
    const waiting = await Promise.all(
      Array.from({ length: 13 }, (_, index) =>
        order(51 + index, 'PENDING_PAYMENT'),
      ),
    );

    await f.db.insert(orderItems).values([
      {
        orderId: pending.id,
        productNameSnapshot: 'Historical shirt',
        variantNameSnapshot: 'Medium',
        skuSnapshot: 'OLD-001',
        unitPriceSnapshot: 50000n,
        quantity: 2,
        lineTotalSnapshot: 100000n,
        costSnapshot: 1234n,
      },
      {
        orderId: pending.id,
        productNameSnapshot: 'Historical scarf',
        variantNameSnapshot: 'Black',
        skuSnapshot: 'OLD-002',
        unitPriceSnapshot: 50000n,
        quantity: 1,
        lineTotalSnapshot: 50000n,
      },
    ]);
    const paidAt = new Date('2026-11-20T01:00:00Z');
    const shippedAt = new Date('2026-11-20T02:00:00Z');
    const deliveredAt = new Date('2026-11-21T02:00:00Z');
    type PaymentStatus = typeof paymentAttempts.$inferSelect.status;
    function attempt(
      row: typeof orders.$inferSelect,
      sequence: number,
      status: PaymentStatus,
      expiresAt?: Date,
    ) {
      return {
        orderId: row.id,
        provider: 'DOKU',
        sequence,
        invoice: row.orderNumber + '-' + sequence,
        requestId: randomUUID(),
        amount: row.grandTotal,
        currency: 'IDR',
        status,
        expiresAt,
        createdAt: row.createdAt,
        paidAt: status === 'PAID' || status === 'REVIEW' ? paidAt : null,
      };
    }
    await f.db
      .insert(paymentAttempts)
      .values([
        attempt(preparing, 1, 'EXPIRED'),
        attempt(preparing, 2, 'PAID'),
        attempt(preparing, 3, 'REVIEW'),
        attempt(shipped, 1, 'PAID'),
        attempt(delivered, 1, 'PAID'),
        attempt(review, 1, 'REVIEW'),
        attempt(review, 2, 'FAILED'),
        attempt(processing, 1, 'PENDING', new Date('2099-01-01')),
        attempt(expired, 1, 'PENDING', new Date('2000-01-01')),
        attempt(created, 1, 'CREATED'),
      ]);
    await f.db.insert(orderFulfillments).values([
      {
        orderId: shipped.id,
        courierName: 'JNE',
        serviceName: 'REG',
        trackingNumber: '000JNE123',
        status: 'SHIPPED',
        shippedAt,
        shippedById: f.admin.id,
        actualShippingCost: 18765n,
      },
      {
        orderId: delivered.id,
        courierName: 'JNE',
        serviceName: 'REG',
        trackingNumber: 'JNE456',
        status: 'DELIVERED',
        shippedAt,
        shippedById: f.admin.id,
        deliveredAt,
        deliveredById: f.admin.id,
        actualShippingCost: 18765n,
      },
    ]);
    const app = await buildApp(
      readEnv({
        ...process.env,
        DATABASE_URL: f.url,
        APP_URL: historyBase,
        NODE_ENV: 'test',
        PAYMENT_PROVIDER: 'doku',
        DOKU_ENV: 'sandbox',
        DOKU_CLIENT_ID: dokuFixture.clientId,
        DOKU_SECRET_KEY: dokuFixture.secretKey,
        DOKU_NOTIFICATION_URL: dokuFixture.notificationUrl,
      }),
      {
        database: { ...f.database, close: async () => {} },
        logger: false,
        paymentFetch,
      },
    );
    const accountingRows = async () =>
      Promise.all([
        f.db.$count(sales),
        f.db.$count(financialTransactions),
        f.db.$count(inventoryMovements),
        f.db.$count(saleItems),
      ]);
    return {
      ...f,
      app,
      accountingRows,
      other,
      pending,
      preparing,
      shipped,
      delivered,
      cancelled,
      review,
      processing,
      expired,
      created,
      legacy,
      foreign,
      waiting,
      paidAt,
      shippedAt,
      deliveredAt,
      async close() {
        try {
          await app.close();
        } finally {
          await f.cleanup();
        }
      },
    };
  } catch (error) {
    await f.cleanup();
    throw error;
  }
}
