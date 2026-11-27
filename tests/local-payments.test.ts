import { afterAll, beforeAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { readEnv } from '../src/config/env.js';
import {
  financialTransactions,
  inventoryMovements,
  orders,
  paymentAttempts,
  paymentNotifications,
  productVariants,
  sales,
} from '../src/db/schema/index.js';
import { createCartService } from '../src/modules/cart/service.js';
import { createCheckout } from '../src/modules/checkout/service.js';
import {
  configureCheckoutShipping,
  reviewedCheckout,
  saveCheckoutAddress,
} from './helpers/checkout-fixture.js';
import { storefrontNavigationFixture } from './helpers/storefront-navigation-fixture.js';

const base = 'http://127.0.0.1:3061';
const baseOrder = '/account/orders/';
let f: Awaited<ReturnType<typeof storefrontNavigationFixture>>;
let app: Awaited<ReturnType<typeof buildApp>>;
let methodId: string;
let addressId: string;
let cookies: Record<string, string>;

beforeAll(async () => {
  f = await storefrontNavigationFixture();
  methodId = (await configureCheckoutShipping(f.db, f.catalog)).id;
  addressId = (await saveCheckoutAddress(f.db, f.customer.customer.id)).id;
  cookies = {
    lokka_customer: f.customer.sessionToken,
    lokka_customer_csrf: f.customer.csrfToken,
  };
  app = await buildApp(
    readEnv({
      ...process.env,
      DATABASE_URL: f.url,
      APP_URL: base,
      NODE_ENV: 'test',
      PAYMENT_PROVIDER: 'local',
    }),
    {
      database: { ...f.database, close: async () => {} },
      logger: false,
      paymentFetch: async () => {
        throw new Error('Local payment must not call DOKU');
      },
    },
  );
}, 30000);
afterAll(async () => {
  try {
    await app?.close();
  } finally {
    await f?.cleanup();
  }
});

async function savedOrder() {
  const customer = f.customer.customer.id;
  await createCartService(f.db).mutate(customer, 'add', f.variant.id, 1);
  return createCheckout(f.db).place(
    customer,
    await reviewedCheckout(f.db, customer, addressId, methodId),
  );
}
const get = (url: string, identity = cookies) =>
  app.inject({ url, cookies: identity });
const post = (
  url: string,
  fields: Record<string, unknown> = {},
  identity = cookies,
  origin = base,
) =>
  app.inject({
    url,
    method: 'POST',
    cookies: identity,
    headers: { origin },
    payload: { csrf: identity.lokka_customer_csrf, ...fields },
  });
const attempts = (orderId: string) =>
  f.db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.orderId, orderId))
    .orderBy(paymentAttempts.sequence);
const receipts = (attemptId: string) =>
  f.db
    .select()
    .from(paymentNotifications)
    .where(eq(paymentNotifications.attemptId, attemptId));
const counts = () =>
  Promise.all([
    f.db.$count(sales),
    f.db.$count(financialTransactions),
    f.db.$count(inventoryMovements),
  ]);
const stock = async () =>
  (
    await f.db
      .select()
      .from(productVariants)
      .where(eq(productVariants.id, f.variant.id))
  )[0]!.stockQuantity;
const orderRow = async (orderId: string) =>
  (await f.db.select().from(orders).where(eq(orders.id, orderId)))[0]!;

async function start(orderPath: string) {
  const response = await post(orderPath + '/payment');
  expect(response.statusCode).toBe(303);
  expect(response.headers.location).toMatch(
    /^\/account\/orders\/WEB-\d{8}-\d+\/payment\/local\/[a-f0-9-]+$/,
  );
  return String(response.headers.location);
}

it('reuses one local attempt and settles once through the signed-payment settlement path', async () => {
  const order = await savedOrder();
  const orderPath = baseOrder + order.orderNumber;
  const beforeStock = await stock();
  expect((await get(orderPath)).body).toContain('Pay now');
  const local = await start(orderPath);
  expect(await start(orderPath)).toBe(local);
  const [attempt] = await attempts(order.id);
  expect(await attempts(order.id)).toMatchObject([
    {
      provider: 'LOCAL',
      status: 'PENDING',
      amount: order.grandTotal,
      checkoutUrl: local,
    },
  ]);
  expect((await get(local)).body).toContain(
    'Development only. No money is collected.',
  );
  expect(
    (await get(orderPath + '/payment/return?status=SUCCESS')).body,
  ).toContain('Payment processing');
  expect((await get(local + '?action=success')).statusCode).toBe(200);
  expect(await orderRow(order.id)).toEqual(order);
  expect(await counts()).toEqual([0, 0, 0]);

  const other = await f.auth.register(
    {
      name: 'Other',
      email: 'local-other@example.test',
      password: 'temporary-other-password',
    },
    null,
    null,
  );
  const foreign = {
    lokka_customer: other.sessionToken,
    lokka_customer_csrf: other.csrfToken,
  };
  expect((await get(local, foreign)).statusCode).toBe(404);
  expect((await post(local, { action: 'success' }, foreign)).statusCode).toBe(
    404,
  );
  expect((await post(local, { action: 'success', csrf: '' })).statusCode).toBe(
    403,
  );
  expect(
    (
      await post(
        local,
        { action: 'success' },
        cookies,
        'https://foreign.example.test',
      )
    ).statusCode,
  ).toBe(403);
  expect((await post(local, { action: 'unknown' })).statusCode).toBe(422);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/payments/doku/notification',
        payload: {},
      })
    ).statusCode,
  ).toBe(404);
  expect(await receipts(attempt!.id)).toEqual([]);
  const replay = await Promise.all([
    post(local, { action: 'success' }),
    post(local, { action: 'success' }),
  ]);
  expect(replay.map(({ statusCode }) => statusCode)).toEqual([303, 303]);
  const settled = await orderRow(order.id);
  expect(settled).toMatchObject({
    status: 'PAID',
    grandTotal: order.grandTotal,
  });
  expect(await attempts(order.id)).toMatchObject([
    { status: 'PAID', paidAt: expect.any(Date) },
  ]);
  expect(await receipts(attempt!.id)).toMatchObject([
    { provider: 'LOCAL', outcome: 'PAID', result: 'PAID' },
  ]);
  expect((await post(local, { action: 'success' })).statusCode).toBe(303);
  expect(await orderRow(order.id)).toEqual(settled);
  expect(await counts()).toEqual([1, 1, 1]);
  expect((await f.db.select().from(sales))[0]).toMatchObject({
    orderId: order.id,
    source: 'WEBSTORE',
    total: order.grandTotal,
  });
  expect((await f.db.select().from(financialTransactions))[0]).toMatchObject({
    category: 'WEBSTORE_ORDER',
    amountRupiah: order.grandTotal,
  });
  expect(await stock()).toBe(beforeStock - 1);
});

it.each(['failed', 'expired'] as const)(
  'simulates %s without posting and allows a new attempt',
  async (action) => {
    const order = await savedOrder();
    const orderPath = baseOrder + order.orderNumber;
    const before = await counts();
    const beforeStock = await stock();
    const local = await start(orderPath);
    expect((await post(local, { action })).statusCode).toBe(303);
    expect((await post(local, { action })).statusCode).toBe(303);
    const [first] = await attempts(order.id);
    expect(first?.status).toBe(action.toUpperCase());
    expect(
      first?.[action === 'failed' ? 'failedAt' : 'expiredAt'],
    ).toBeInstanceOf(Date);
    expect(await receipts(first!.id)).toMatchObject([
      { result: 'LOCAL_' + action.toUpperCase() },
    ]);
    expect((await get(orderPath)).body).toContain('Retry payment');
    expect(await start(orderPath)).not.toBe(local);
    expect(await attempts(order.id)).toMatchObject([
      { sequence: 1, status: action.toUpperCase() },
      { sequence: 2, status: 'PENDING' },
    ]);
    expect((await post(local, { action: 'success' })).statusCode).toBe(409);
    expect(await orderRow(order.id)).toEqual(order);
    expect(await counts()).toEqual(before);
    expect(await stock()).toBe(beforeStock);
  },
);

it('keeps simulated review pending and blocks another payment attempt', async () => {
  const order = await savedOrder();
  const orderPath = baseOrder + order.orderNumber;
  const before = await counts();
  const local = await start(orderPath);
  expect((await post(local, { action: 'review' })).statusCode).toBe(303);
  expect((await post(local, { action: 'success' })).statusCode).toBe(409);
  expect((await post(orderPath + '/payment')).headers.location).toBe(orderPath);
  const [attempt] = await attempts(order.id);
  expect(await attempts(order.id)).toMatchObject([
    { status: 'REVIEW', paidAt: null },
  ]);
  expect(await receipts(attempt!.id)).toMatchObject([
    { result: 'LOCAL_REVIEW' },
  ]);
  const page = await get(orderPath);
  expect(page.body).toContain('Payment confirmation under review');
  expect(page.body).not.toMatch(/Pay now|Retry payment|Continue to payment/);
  expect(await orderRow(order.id)).toEqual(order);
  expect(await counts()).toEqual(before);
});

it('uses canonical stock review and safely replays the same success after restocking', async () => {
  const order = await savedOrder();
  const orderPath = baseOrder + order.orderNumber;
  const local = await start(orderPath);
  const before = await counts();
  const setStock = (stockQuantity: number) =>
    f.db
      .update(productVariants)
      .set({ stockQuantity, updatedAt: new Date() })
      .where(eq(productVariants.id, f.variant.id));
  const beforeStock = await stock();
  try {
    await setStock(0);
    expect((await post(local, { action: 'success' })).statusCode).toBe(303);
    const [attempt] = await attempts(order.id);
    expect(attempt?.status).toBe('REVIEW');
    expect(await receipts(attempt!.id)).toMatchObject([
      { result: 'STOCK_REVIEW' },
    ]);
    expect(await counts()).toEqual(before);
    expect(await orderRow(order.id)).toEqual(order);
    await setStock(1);
    expect((await post(local, { action: 'success' })).statusCode).toBe(303);
    expect(await attempts(order.id)).toMatchObject([{ status: 'PAID' }]);
    expect(await receipts(attempt!.id)).toMatchObject([{ result: 'PAID' }]);
    expect(await counts()).toEqual(before.map((count) => count + 1));
    expect(await stock()).toBe(0);
  } finally {
    await setStock(beforeStock);
  }
});
