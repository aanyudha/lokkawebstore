import { createHash } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { readEnv } from '../src/config/env.js';
import { createAuth } from '../src/modules/auth/service.js';
import { createCartService } from '../src/modules/cart/service.js';
import { createCustomerAddresses } from '../src/modules/customer/addresses.js';
import {
  financialTransactions,
  orders,
  orderFulfillments,
  orderTrackingChanges,
  shippingMethods,
} from '../src/db/schema/index.js';
import {
  jntFixtureEnv,
  configureCheckoutShipping,
  saveCheckoutAddress,
} from './helpers/checkout-fixture.js';
import { storefrontNavigationFixture } from './helpers/storefront-navigation-fixture.js';

const origin = 'http://localhost:3055';
const providerReply = (cost: string) =>
  Response.json({
    is_success: 'true',
    content: JSON.stringify([{ name: 'EZ', cost }]),
  });
const tariff = vi.fn<typeof fetch>();
let f: Awaited<ReturnType<typeof storefrontNavigationFixture>>;
let app: Awaited<ReturnType<typeof buildApp>>;
let addressId: string;
let manualId: string;
let orderNumber: string;
let orderId: string;

beforeAll(async () => {
  f = await storefrontNavigationFixture();
  addressId = (await saveCheckoutAddress(f.db, f.customer.customer.id)).id;
  manualId = (await configureCheckoutShipping(f.db, f.catalog)).id;
  app = await buildApp(
    readEnv({
      ...process.env,
      ...jntFixtureEnv,
      DATABASE_URL: f.url,
      NODE_ENV: 'test',
      APP_URL: origin,
    }),
    {
      database: { ...f.database, close: async () => {} },
      logger: false,
      shippingFetch: tariff,
    },
  );
}, 30000);
afterAll(async () => {
  await app?.close();
  await f?.cleanup();
});

function customerPost(url: string, payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url,
    headers: { origin },
    payload: { csrf: f.customer.csrfToken, ...payload },
    cookies: {
      lokka_customer: f.customer.sessionToken,
      lokka_customer_csrf: f.customer.csrfToken,
    },
  });
}

it('quotes from owned delivery facts, validates tariff signatures and rechecks the price before order placement', async () => {
  tariff
    .mockResolvedValueOnce(providerReply('21000'))
    .mockResolvedValueOnce(providerReply('21000'))
    .mockResolvedValueOnce(providerReply('22000'))
    .mockImplementation(async () => providerReply('22000'));
  const buyer = f.customer.customer.id;
  const foreign = await f.auth.register(
    {
      name: 'Other customer',
      email: 'other@example.test',
      password: 'other-fixture-password',
    },
    null,
    null,
  );
  const foreignAddress = await saveCheckoutAddress(f.db, foreign.customer!.id);
  const cart = createCartService(f.db);
  await cart.mutate(buyer, 'add', f.variant.id, 7);
  const foreignRates = await customerPost('/cart/review/rates', {
    addressId: foreignAddress.id,
  });
  expect(foreignRates.statusCode).toBe(422);
  expect(tariff).not.toHaveBeenCalled();
  const rates = await customerPost('/cart/review/rates', { addressId });
  expect(rates.body).toContain('Rp21,000');
  const [url, init] = tariff.mock.calls[0]!;
  expect(url).toBe(jntFixtureEnv.JNT_TARIFF_URL);
  expect(init).toMatchObject({ method: 'POST', redirect: 'error' });
  const body = new URLSearchParams(String(init?.body));
  expect([...body.keys()]).toEqual(['data', 'sign']);
  const data = body.get('data')!;
  expect(JSON.parse(data)).toEqual({
    weight: '1.400',
    sendSiteCode: 'FIXTURE_ORIGIN',
    destAreaCode: 'FIXTURE_DEST',
    cusName: 'fixture-customer',
    productType: 'EZ',
  });
  expect(Buffer.from(body.get('sign')!, 'base64').toString()).toBe(
    createHash('md5')
      .update(data + jntFixtureEnv.JNT_TARIFF_KEY)
      .digest('hex'),
  );
  const selection = { addressId, methodId: 'jnt:EZ' };
  const firstReview = await customerPost('/cart/review', selection);
  const quote = (html: string) =>
    html.match(/name="quote" value="([a-f0-9]{64})"/)?.[1];
  const revision = (await cart.get(buyer)).cart!.revision;
  expect(quote(firstReview.body)).toBeDefined();
  const changed = await customerPost('/cart/orders', {
    ...selection,
    revision,
    quote: quote(firstReview.body),
  });
  expect(changed.statusCode).toBe(422);
  expect(await f.db.select().from(orders)).toHaveLength(0);
  const reviewed = await customerPost('/cart/review', selection);
  const placed = await customerPost('/cart/orders', {
    ...selection,
    revision,
    quote: quote(reviewed.body),
    shippingAmount: '1',
    grandTotal: '1',
  });
  expect(placed.statusCode).toBe(303);
  const [order] = await f.db.select().from(orders);
  orderNumber = order!.orderNumber;
  orderId = order!.id;
  expect(order).toMatchObject({
    shipmentWeightGrams: 1400n,
    status: 'PENDING_PAYMENT',
    shippingAmount: 22000n,
    grandTotal: 5587000n,
    shippingMethodSnapshot: {
      courierCode: 'JNT',
      courierName: 'J&T Express',
      serviceCode: 'EZ',
      serviceName: 'EZ',
      quoteSource: 'JNT',
    },
  });
  expect(await f.db.select().from(financialTransactions)).toHaveLength(0);
});

it('requires admin and CSRF, rejects pending orders, serializes shipment retries and audits tracking corrections', async () => {
  const creds = await createAuth(f.db).login(
    f.admin.email,
    'temporary-accounting-password',
    '127.0.0.1',
    'test',
  );
  const cookies = {
    lokka_admin: creds!.sessionToken,
    lokka_admin_csrf: creds!.csrf,
  };
  const ship = {
    courierName: 'SiCepat',
    serviceName: 'REG',
    trackingNumber: '000041',
    actualShippingCost: '17000',
  };
  const path = `/admin/fulfillment/shipments/${orderNumber}`;
  const send = (
    action: string,
    payload: Record<string, unknown>,
    csrf = creds!.csrf,
  ) =>
    app.inject({
      method: 'POST',
      url: `${path}/${action}`,
      headers: { origin },
      cookies,
      payload: { ...payload, csrf },
    });
  const calls = tariff.mock.calls.length;
  expect((await customerPost(`${path}/ship`, ship)).statusCode).toBe(303);
  expect((await send('ship', ship, '')).statusCode).toBe(403);
  expect((await send('ship', ship)).statusCode).toBe(422);
  expect(await f.db.select().from(orderFulfillments)).toHaveLength(0);
  expect(await f.db.select().from(financialTransactions)).toHaveLength(0);
  // E3 notification-to-PAID is exercised through the DOKU browser and payment suites.
  await f.db
    .update(orders)
    .set({ status: 'PAID', updatedAt: new Date() })
    .where(eq(orders.id, orderId));
  expect(
    (await send('ship', { ...ship, actualShippingCost: '17.5' })).statusCode,
  ).toBe(422);
  const retries = await Promise.all([send('ship', ship), send('ship', ship)]);
  expect(retries.map((r) => r.statusCode)).toEqual([303, 303]);
  expect(
    (await send('ship', { ...ship, actualShippingCost: '20000' })).statusCode,
  ).toBe(422);
  const shipment = await f.db.select().from(orderFulfillments);
  expect(shipment).toHaveLength(1);
  expect(shipment[0]).toMatchObject({
    orderId,
    shippedById: f.admin.id,
    actualShippingCost: 17000n,
    status: 'SHIPPED',
    ...{ courierName: 'SiCepat', trackingNumber: '000041' },
  });
  const ledger = await f.db.select().from(financialTransactions);
  expect(ledger).toHaveLength(1);
  expect(ledger[0]).toMatchObject({
    shipmentOrderId: orderId,
    type: 'SHIPPING_EXPENSE',
    direction: 'EXPENSE',
    source: 'WEBSTORE',
    category: 'TRANSPORT',
    amountRupiah: 17000n,
  });
  const correction = {
    previousTrackingNumber: '000041',
    trackingNumber: '000042',
  };
  expect((await send('tracking', correction)).statusCode).toBe(303);
  expect((await send('tracking', correction)).statusCode).toBe(303);
  expect(
    (await send('tracking', { ...correction, trackingNumber: '000043' }))
      .statusCode,
  ).toBe(422);
  expect(await f.db.select().from(orderTrackingChanges)).toMatchObject([
    { orderId, ...correction, changedById: f.admin.id },
  ]);
  expect((await send('deliver', {})).statusCode).toBe(303);
  const [delivered] = await f.db.select().from(orderFulfillments);
  expect((await send('deliver', {})).statusCode).toBe(303);
  expect(await f.db.select().from(orderFulfillments)).toEqual([delivered]);
  expect(await f.db.select().from(financialTransactions)).toEqual(ledger);
  expect(tariff).toHaveBeenCalledTimes(calls);
  const [order] = await f.db.select().from(orders);
  expect(order).toMatchObject({
    shippingAmount: 22000n,
    grandTotal: 5587000n,
    shippingMethodSnapshot: { courierCode: 'JNT' },
  });
});

it('shows explicitly configured fallback and blocks with no usable rate', async () => {
  tariff
    .mockReset()
    .mockRejectedValue(new Error('Synthetic unavailable provider'));
  const buyer = f.customer.customer.id;
  await createCartService(f.db).mutate(buyer, 'add', f.variant.id, 1);
  const options = await customerPost('/cart/review/rates', { addressId });
  expect(options.statusCode).toBe(200);
  expect(options.body).not.toContain('Shipping is not available');
  expect(options.body).toContain('Standard delivery');
  expect(options.body).toContain('Rp22,000');
  expect(
    (await customerPost('/cart/review', { addressId, methodId: manualId }))
      .body,
  ).toContain('data-shipping-method');
  await f.db
    .update(shippingMethods)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(shippingMethods.id, manualId));
  const result = await customerPost('/cart/review/rates', { addressId });
  expect(result.statusCode).toBe(422);
  expect(result.body).toContain(
    'Shipping is not available for this address yet.',
  );
  await createCustomerAddresses(f.db).save(
    buyer,
    {
      label: 'Unmapped',
      recipientName: 'Fixture',
      phone: '08123456789',
      addressLine1: 'Jalan',
      city: 'Different city',
      district: 'Menteng',
      province: 'DKI Jakarta',
      postalCode: '10310',
    },
    addressId,
  );
  const calls = tariff.mock.calls.length;
  expect(
    (await customerPost('/cart/review/rates', { addressId })).statusCode,
  ).toBe(422);
  expect(tariff).toHaveBeenCalledTimes(calls);
});
