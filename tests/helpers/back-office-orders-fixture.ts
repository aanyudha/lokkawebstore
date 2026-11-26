import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  orderItems,
  orders,
  paymentAttempts,
  paymentNotifications,
} from '../../src/db/schema/index.js';
import { createAuth } from '../../src/modules/auth/service.js';
import {
  lockOrderStock,
  postPaidWebstoreSale,
} from '../../src/modules/sales/webstore.js';
import { orderHistoryFixture } from './order-history-fixture.js';

export const accountingPassword = 'temporary-accounting-password';

export async function backOfficeOrdersFixture() {
  const fixture = await orderHistoryFixture(async () => {
    throw new Error('Unexpected payment transport');
  });
  try {
    const { db, preparing, processing, review, paidAt } = fixture;
    await db.insert(orders).values(
      Array.from({ length: 13 }, (_, index) => ({
        orderNumber: `WEB-20261120-${String(101 + index).padStart(6, '0')}`,
        customerId: fixture.customer.customer.id,
        idempotencyKey: randomUUID(),
        status: 'PENDING_PAYMENT' as const,
        subtotal: 10000n,
        grandTotal: 10000n,
        createdAt: new Date('2026-11-20T03:00:00Z'),
      })),
    );
    await db.insert(orderItems).values({
      orderId: preparing.id,
      productId: fixture.product.id,
      variantId: fixture.variant.id,
      productNameSnapshot: 'Paid historical item',
      variantNameSnapshot: 'Historical variant',
      skuSnapshot: 'PAID-OLD-001',
      unitPriceSnapshot: 150000n,
      quantity: 1,
      lineTotalSnapshot: 150000n,
      costSnapshot: null,
    });
    await db.transaction(async (tx) => {
      const stock = await lockOrderStock(tx, preparing.id);
      if (!stock) throw new Error('Paid sale fixture needs stock.');
      await postPaidWebstoreSale(tx, preparing, stock, paidAt, paidAt);
    });
    for (const [id, status, result, amount] of [
      [review.id, 'REVIEW', 'STOCK_REVIEW', 170000n],
      [processing.id, 'PENDING', 'MONEY_MISMATCH', 169999n],
      [preparing.id, 'REVIEW', 'LATE_SUCCESS', 170000n],
    ] as const) {
      const [attempt] = (
        await db
          .select()
          .from(paymentAttempts)
          .where(eq(paymentAttempts.orderId, id))
      ).filter((entry) => entry.status === status);
      await db
        .update(paymentAttempts)
        .set({
          providerReference: `provider-reference-${result}`,
          requestId: `internal-request-id-${result}`,
          checkoutUrl: 'https://secret-checkout.example.test/',
          updatedAt: new Date(),
        })
        .where(eq(paymentAttempts.id, attempt!.id));
      await db.insert(paymentNotifications).values({
        provider: 'DOKU',
        eventId: `secret-event-${result}`,
        attemptId: attempt!.id,
        invoice: attempt!.invoice,
        originalRequestId: `internal-request-id-${result}`,
        requestTimestamp: paidAt,
        occurredAt: paidAt,
        amount,
        currency: 'IDR',
        outcome: 'PAID',
        result,
        providerStatus: 'SECRET_RAW_PROVIDER_STATUS',
      });
    }
    const login = await createAuth(db).login(
      fixture.admin.email,
      accountingPassword,
      '127.0.0.1',
      'test',
    );
    return {
      ...fixture,
      adminCookies: {
        lokka_admin: login!.sessionToken,
        lokka_admin_csrf: login!.csrf,
      },
      customerCookies: {
        lokka_customer: fixture.customer.sessionToken,
        lokka_customer_csrf: fixture.customer.csrfToken,
      },
    };
  } catch (error) {
    await fixture.close();
    throw error;
  }
}
