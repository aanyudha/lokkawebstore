import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { readEnv } from '../src/config/env.js';
import {
  directCosts,
  financialTransactions,
  inventoryMovements,
  orderItems,
  orders,
  paymentAttempts,
  paymentNotifications,
  productVariants,
  saleItems,
  sales,
} from '../src/db/schema/index.js';
import { resolvePeriod } from '../src/modules/finance/ledger.js';
import { dokuNotificationPath } from '../src/modules/payments/config.js';
import { DokuProvider } from '../src/modules/payments/doku-provider.js';
import { createPaymentService } from '../src/modules/payments/service.js';
import { storefrontNavigationFixture } from './helpers/storefront-navigation-fixture.js';
import {
  dokuFixture,
  dokuTime,
  signedHeaders,
} from './helpers/doku-fixture.js';

let f: Awaited<ReturnType<typeof storefrontNavigationFixture>>;
let app: Awaited<ReturnType<typeof buildApp>>;
let sequence = 0;

beforeAll(async () => {
  f = await storefrontNavigationFixture();
  app = await buildApp(
    readEnv({
      ...process.env,
      DATABASE_URL: f.url,
      NODE_ENV: 'test',
      APP_URL: 'http://localhost:3051',
      PAYMENT_PROVIDER: 'doku',
      DOKU_ENV: 'sandbox',
      DOKU_CLIENT_ID: dokuFixture.clientId,
      DOKU_SECRET_KEY: dokuFixture.secretKey,
      DOKU_NOTIFICATION_URL: dokuFixture.notificationUrl,
    }),
    { database: { ...f.database, close: async () => {} }, logger: false },
  );
}, 30000);

afterAll(async () => {
  await app?.close();
  await f?.cleanup();
});

async function sampleOrder(cost: bigint | null = 300000n) {
  const [order] = await f.db
    .insert(orders)
    .values({
      orderNumber: `WEB-20261123-${String(++sequence).padStart(6, '0')}`,
      customerId: f.customer.customer.id,
      idempotencyKey: randomUUID(),
      subtotal: 795000n,
      shippingAmount: 22000n,
      discountAmount: 2000n,
      grandTotal: 815000n,
    })
    .returning();
  await f.db.insert(orderItems).values({
    orderId: order!.id,
    productId: f.product.id,
    variantId: f.variant.id,
    productNameSnapshot: f.product.name,
    variantNameSnapshot: f.variant.name,
    skuSnapshot: f.variant.sku,
    quantity: 1,
    unitPriceSnapshot: 795000n,
    lineTotalSnapshot: 795000n,
    costSnapshot: cost,
  });
  return order!;
}

function harness(order: typeof orders.$inferSelect) {
  let clock = new Date(dokuTime);
  const checkoutUrl = 'https://sandbox.doku.com/checkout-link-v2/test';
  const fetchPayment = vi.fn<typeof fetch>(async (_url, options) => {
    const sent = JSON.parse(String(options?.body));
    return Response.json({
      message: ['SUCCESS'],
      response: {
        order: {
          invoice_number: sent.order.invoice_number,
          amount: sent.order.amount,
          session_id: randomUUID(),
        },
        payment: { url: checkoutUrl, expired_date: '20261123140000' },
      },
    });
  });
  const provider = new DokuProvider(dokuFixture, fetchPayment, () => clock);
  const payments = createPaymentService(
    f.db,
    provider,
    (candidate) => candidate.id === order.id,
    () => clock,
  );
  const input = {
    customerId: order.customerId,
    orderNumber: order.orderNumber,
    returnUrl: 'https://example.test/account/orders/' + order.orderNumber,
    locale: 'en' as const,
  };
  return {
    payments,
    fetchPayment,
    input,
    checkoutUrl,
    advance: () => {
      clock = new Date('2026-11-23T07:05:00Z');
    },
    initiate: () => payments.createPayment(input),
    attempts: () =>
      f.db
        .select()
        .from(paymentAttempts)
        .where(eq(paymentAttempts.orderId, order.id))
        .orderBy(paymentAttempts.sequence),
  };
}

function notify(
  attempt: typeof paymentAttempts.$inferSelect,
  overrides: {
    invoice?: string;
    amount?: string;
    request?: string;
    status?: string;
    event?: string;
    currency?: string;
  } = {},
) {
  const body = JSON.stringify(
    {
      order: {
        invoice_number: overrides.invoice ?? attempt.invoice,
        amount: overrides.amount ?? attempt.amount.toString(),
        currency: overrides.currency ?? 'IDR',
      },
      transaction: {
        original_request_id: overrides.request ?? attempt.requestId,
        date: dokuTime,
        status: overrides.status ?? 'SUCCESS',
      },
      future_doku_field: 'ignored',
    },
    null,
    2,
  );
  return app.inject({
    method: 'POST',
    url: dokuNotificationPath,
    payload: body,
    headers: signedHeaders(body, overrides.event ?? randomUUID()),
  });
}

it('requires the owner and eligibility, submits the snapshot total and reuses one concurrent attempt', async () => {
  const order = await sampleOrder();
  const h = harness(order);
  expect(
    await h.payments.createPayment({ ...h.input, customerId: randomUUID() }),
  ).toEqual({ status: 'missing' });
  const ineligible = await sampleOrder();
  expect(
    await h.payments.createPayment({
      ...h.input,
      orderNumber: ineligible.orderNumber,
    }),
  ).toEqual({ status: 'ineligible' });
  const results = await Promise.all(
    Array.from({ length: 5 }, () => h.initiate()),
  );
  expect(results).toContainEqual({
    status: 'redirect',
    checkoutUrl: h.checkoutUrl,
  });
  expect(await h.initiate()).toEqual({
    status: 'redirect',
    checkoutUrl: h.checkoutUrl,
  });
  expect(h.fetchPayment).toHaveBeenCalledTimes(1);
  expect(
    JSON.parse(String(h.fetchPayment.mock.calls[0]?.[1]?.body)).order.amount,
  ).toBe(815000);
  expect(await h.attempts()).toEqual([
    expect.objectContaining({ status: 'PENDING', amount: 815000n }),
  ]);
  expect(await f.db.select().from(sales)).toHaveLength(0);
  expect(await f.db.select().from(financialTransactions)).toHaveLength(0);
  expect(await f.db.select().from(inventoryMovements)).toHaveLength(0);
});

it('keeps the original attempt when creation is ambiguous', async () => {
  const h = harness(await sampleOrder());
  h.fetchPayment.mockRejectedValueOnce(new Error('timeout'));
  expect(await h.initiate()).toEqual({ status: 'processing' });
  expect(await h.initiate()).toEqual({ status: 'processing' });
  expect(h.fetchPayment).toHaveBeenCalledTimes(1);
  expect(await h.attempts()).toEqual([
    expect.objectContaining({ status: 'CREATED' }),
  ]);
});

it('rejects mismatched notifications and processes a signed capture exactly once', async () => {
  const order = await sampleOrder();
  const h = harness(order);
  await h.initiate();
  const [attempt] = await h.attempts();
  const period = resolvePeriod({
    period: 'custom',
    from: '2026-11-23',
    to: '2026-11-23',
  });
  expect(await f.accounting.report(period)).toMatchObject({
    revenue: 0n,
    cogs: 0n,
  });
  expect((await notify(attempt!, { invoice: 'UNKNOWN' })).statusCode).toBe(404);
  expect((await notify(attempt!, { request: randomUUID() })).statusCode).toBe(
    409,
  );
  expect((await notify(attempt!, { amount: '815001' })).statusCode).toBe(409);
  expect((await notify(attempt!, { currency: 'USD' })).statusCode).toBe(409);
  const replay = randomUUID();
  expect(
    (await notify(attempt!, { status: 'FAILED', event: replay })).statusCode,
  ).toBe(200);
  expect((await notify(attempt!, { event: replay })).statusCode).toBe(409);
  const forged = await app.inject({
    method: 'POST',
    url: dokuNotificationPath,
    payload: '{}',
    headers: { ...signedHeaders('{}', 'forged'), signature: 'fake' },
  });
  expect(forged.statusCode).toBe(401);
  expect((await h.attempts())[0]!.status).toBe('PENDING');
  await f.db
    .update(directCosts)
    .set({ amountRupiah: 500000n, updatedAt: new Date() })
    .where(eq(directCosts.id, f.cost.id));
  const event = randomUUID();
  const deliveries = await Promise.all([
    notify(attempt!, { event }),
    notify(attempt!, { event }),
    notify(attempt!),
  ]);
  expect(deliveries.map((r) => r.statusCode)).toEqual([200, 200, 200]);
  expect(await h.attempts()).toEqual([
    expect.objectContaining({ status: 'PAID', paidAt: new Date(dokuTime) }),
  ]);
  expect(await h.initiate()).toEqual({ status: 'ineligible' });
  expect(
    await f.db.select().from(orders).where(eq(orders.id, order.id)),
  ).toEqual([expect.objectContaining({ status: 'PAID' })]);
  const posted = await f.db.select().from(sales);
  expect(posted).toEqual([
    expect.objectContaining({
      orderId: order.id,
      source: 'WEBSTORE',
      subtotal: 795000n,
      shippingAmount: 22000n,
      total: 815000n,
    }),
  ]);
  expect(await f.db.select().from(saleItems)).toEqual([
    expect.objectContaining({ costSnapshot: 300000n }),
  ]);
  expect(await f.db.select().from(financialTransactions)).toEqual([
    expect.objectContaining({
      category: 'WEBSTORE_ORDER',
      source: 'WEBSTORE',
      saleId: posted[0]!.id,
      amountRupiah: 815000n,
    }),
  ]);
  expect(await f.db.select().from(inventoryMovements)).toEqual([
    expect.objectContaining({
      referenceId: posted[0]!.id,
      quantityChange: -1,
    }),
  ]);
  expect(await f.db.select().from(productVariants)).toEqual([
    expect.objectContaining({ stockQuantity: 99 }),
  ]);
  expect(await f.accounting.report(period)).toMatchObject({
    revenue: 815000n,
    merchandiseRevenue: 793000n,
    shippingCharged: 22000n,
    cogs: 300000n,
  });
});

it('retains expired attempts and records late success for reconciliation', async () => {
  const order = await sampleOrder(null);
  const h = harness(order);
  await h.initiate();
  const [first] = await h.attempts();
  for (const status of ['FAILED', 'EXPIRED', 'CANCELLED'])
    expect((await notify(first!, { status })).statusCode).toBe(200);
  expect((await h.attempts())[0]!.status).toBe('PENDING');
  expect(
    await f.db.select().from(sales).where(eq(sales.orderId, order.id)),
  ).toHaveLength(0);
  h.advance();
  expect((await h.payments.status(order.id))?.status).toBe('EXPIRED');
  await h.initiate();
  const [, second] = await h.attempts();
  expect(second?.invoice).not.toBe(first?.invoice);
  expect((await notify(second!)).statusCode).toBe(200);
  expect((await notify(first!)).statusCode).toBe(200);
  expect((await h.attempts()).map((attempt) => attempt.status)).toEqual([
    'REVIEW',
    'PAID',
  ]);
  expect(
    await f.db
      .select()
      .from(paymentNotifications)
      .where(eq(paymentNotifications.attemptId, first!.id)),
  ).toContainEqual(expect.objectContaining({ result: 'LATE_SUCCESS' }));
  expect(
    await f.db.select().from(sales).where(eq(sales.orderId, order.id)),
  ).toHaveLength(1);
  expect(
    await f.accounting.report(
      resolvePeriod({ period: 'custom', from: '2026-11-23', to: '2026-11-23' }),
    ),
  ).toMatchObject({ cogs: null, netProfit: null });
});

it('preserves a verified receipt during a stock race and completes once after restock', async () => {
  const order = await sampleOrder();
  const h = harness(order);
  await h.initiate();
  const [attempt] = await h.attempts();
  await f.db
    .update(productVariants)
    .set({ stockQuantity: 0, updatedAt: new Date() })
    .where(eq(productVariants.id, f.variant.id));
  const event = randomUUID();
  expect((await notify(attempt!, { event })).statusCode).toBe(503);
  expect(await h.initiate()).toEqual({ status: 'processing' });
  expect(await h.attempts()).toEqual([
    expect.objectContaining({
      status: 'REVIEW',
      paidAt: new Date(dokuTime),
    }),
  ]);
  expect(
    await f.db.select().from(sales).where(eq(sales.orderId, order.id)),
  ).toHaveLength(0);
  await f.db
    .update(productVariants)
    .set({ stockQuantity: 1, updatedAt: new Date() })
    .where(eq(productVariants.id, f.variant.id));
  expect((await notify(attempt!, { event })).statusCode).toBe(200);
  expect((await notify(attempt!, { event })).statusCode).toBe(200);
  expect(
    await f.db.select().from(sales).where(eq(sales.orderId, order.id)),
  ).toHaveLength(1);
  expect(await f.db.select().from(productVariants)).toContainEqual(
    expect.objectContaining({ stockQuantity: 0 }),
  );
});
