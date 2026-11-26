import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  financialTransactions,
  orderFulfillments,
  orders,
  orderTrackingChanges,
  paymentAttempts,
} from '../src/db/schema/index.js';
import { createBackOfficeOrders } from '../src/modules/orders/back-office.js';
import { backOfficeOrdersFixture } from './helpers/back-office-orders-fixture.js';
import { historyBase } from './helpers/order-history-fixture.js';

let f: Awaited<ReturnType<typeof backOfficeOrdersFixture>>;
beforeAll(async () => {
  f = await backOfficeOrdersFixture();
}, 30000);
afterAll(async () => {
  await f?.close();
});

const base = '/admin/orders';
function admin(url: string) {
  return f.app.inject({ url, cookies: f.adminCookies });
}
function submit(
  number: string,
  action: string,
  body: Record<string, unknown> = {},
  cookies: Record<string, string> = f.adminCookies,
) {
  return f.app.inject({
    method: 'POST',
    url: `${base}/${number}/${action}`,
    cookies,
    headers: { origin: historyBase },
    payload: { csrf: f.adminCookies.lokka_admin_csrf, ...body },
  });
}
const shipment = {
  courierName: 'JNE',
  serviceName: 'REG',
  trackingNumber: '000E6-NEW',
  actualShippingCost: '18500',
};

it('lists, searches and filters canonical orders in a fixed number of queries', async () => {
  const list = createBackOfficeOrders(f.db).list;
  const spy = vi.spyOn(f.db.$client, 'query');
  try {
    const { rows, listing } = await list({ status: 'waiting', q: ' DIEGO ' });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(25);
    expect(listing).toMatchObject({
      total: 29,
      page: 1,
      pages: 2,
      next: `${base}?status=waiting&q=DIEGO&page=2`,
    });
    const next = await list({ status: 'waiting', q: 'DIEGO', page: '2' });
    expect(next.rows).toHaveLength(4);
    expect(
      new Set([...rows, ...next.rows].map((row) => row.orderNumber)).size,
    ).toBe(29);
    expect(next.rows.at(-1)).toMatchObject({
      orderNumber: f.pending.orderNumber,
      itemCount: '3',
      grandTotal: 170000n,
      customerName: 'Diego',
      email: f.customer.customer.email,
    });
    const newest = await list({});
    expect(newest.rows[0]!.createdAt.getTime()).toBeGreaterThan(
      newest.rows.at(-1)!.createdAt.getTime(),
    );
    for (const [query, expected] of [
      [f.pending.orderNumber.toLowerCase(), f.pending.orderNumber],
      ['-000030', f.pending.orderNumber],
      [' other-history@EXAMPLE.test ', f.foreign.orderNumber],
      ['Other buyer', f.foreign.orderNumber],
      ['000jne123', f.shipped.orderNumber],
    ])
      expect(
        (await list({ q: query })).rows.map((row) => row.orderNumber),
      ).toEqual([expected]);
    expect((await list({ q: '%_' })).rows).toEqual([]);
    for (const [filter, row, status] of [
      ['ready', f.preparing, 'PREPARING_ORDER'],
      ['shipped', f.shipped, 'SHIPPED'],
      ['delivered', f.delivered, 'DELIVERED'],
      ['cancelled', f.cancelled, 'CANCELLED'],
    ] as const)
      expect((await list({ status: filter })).rows).toMatchObject([
        { orderNumber: row.orderNumber, status },
      ]);
    expect(
      (await list({ status: 'review' })).rows.map((row) => row.orderNumber),
    ).toEqual([
      f.processing.orderNumber,
      f.review.orderNumber,
      f.preparing.orderNumber,
    ]);
  } finally {
    spy.mockRestore();
  }
  const page = await admin(`${base}?status=waiting&q=Diego&page=2`);
  expect(page.body).toContain('Rp170.000');
  expect(page.body).toContain(f.customer.customer.email);
  expect(page.body).not.toContain(f.foreign.orderNumber);
  expect((await admin(`${base}?q=${'a'.repeat(201)}`)).statusCode).toBe(422);
  expect((await admin(`${base}?status=unknown`)).statusCode).toBe(422);
  expect((await admin(`${base}?page=0`)).statusCode).toBe(422);
});

it('shows snapshots, effective payment, safe reconciliation and only canonical posting evidence', async () => {
  const before = await f.accountingRows();
  expect(before).toEqual([1, 1, 1, 1]);
  const detail = await admin(`${base}/${f.preparing.orderNumber}`);
  expect(detail.statusCode).toBe(200);
  for (const fact of [
    'Paid historical item',
    'PAID-OLD-001',
    'HPP unavailable',
    'Jalan Merdeka 10',
    '650 g',
    'J&amp;T Express',
    'Rp170.000',
    'Rp22.000',
    'Rp2.000',
    'provider-reference-LATE_SUCCESS',
    'Late success after payment already confirmed',
    'Cash Flow receipt</dt><dd>Posted',
    'Inventory movement</dt><dd>Posted',
    '2 · Effective',
  ])
    expect(detail.body).toContain(fact);
  expect(detail.body).toContain('data-shipping-expense>Not posted');
  expect(detail.body).not.toMatch(
    /secret-checkout|internal-request-id|SECRET_RAW_PROVIDER_STATUS|secret-event|Mark Paid|Force Paid|Approve Payment/i,
  );
  const review = await admin(`${base}/${f.review.orderNumber}`);
  expect(review.body).toContain('Stock shortfall');
  expect(review.body).not.toMatch(
    /Mark Paid|Force Paid|Approve Payment|Mark as shipped/i,
  );
  const mismatch = await admin(`${base}/${f.processing.orderNumber}`);
  expect(mismatch.body).toContain('Amount or currency mismatch');
  expect(mismatch.body).toContain('Rp169.999');
  const shipped = await admin(`${base}/${f.shipped.orderNumber}`);
  expect(shipped.body).toContain('Rp18.765');
  expect(shipped.body).toContain('data-shipping-expense>Not posted');
  expect((await admin(`${base}/${f.legacy.orderNumber}`)).body).toContain(
    'Delivery snapshot unavailable',
  );
  await admin(base);
  expect(await f.accountingRows()).toEqual(before);
});

it('requires admin session and CSRF, denies unsafe lifecycle actions and validates input', async () => {
  const detail = `${base}/${f.pending.orderNumber}`;
  expect((await f.app.inject(detail)).headers.location).toBe('/admin/login');
  expect(
    (await f.app.inject({ url: base, cookies: f.customerCookies })).headers
      .location,
  ).toBe('/admin/login');
  expect(
    (await f.app.inject({ url: '/account/orders', cookies: f.adminCookies }))
      .headers.location,
  ).toMatch(/^\/account\/login/);
  expect(
    (await submit(f.preparing.orderNumber, 'ship', shipment, f.customerCookies))
      .headers.location,
  ).toBe('/admin/login');
  expect(
    (await submit(f.preparing.orderNumber, 'ship', { ...shipment, csrf: '' }))
      .statusCode,
  ).toBe(403);
  const valid = await admin(detail);
  expect(valid.headers['cache-control']).toBe(
    'private, no-store, no-cache, must-revalidate',
  );
  expect(valid.headers['referrer-policy']).toBe('strict-origin');
  expect(valid.headers['x-robots-tag']).toBe('noindex, nofollow');
  expect((await submit('not-an-order', 'ship', shipment)).statusCode).toBe(404);
  for (const number of [
    f.pending.orderNumber,
    f.cancelled.orderNumber,
    f.review.orderNumber,
  ])
    expect((await submit(number, 'ship', shipment)).statusCode).toBe(422);
  for (const invalid of [
    { actualShippingCost: '-1' },
    { actualShippingCost: '2.5' },
    { serviceName: '' },
    { courierName: 'x'.repeat(121) },
    { trackingNumber: '' },
  ])
    expect(
      (
        await submit(f.preparing.orderNumber, 'ship', {
          ...shipment,
          ...invalid,
        })
      ).statusCode,
    ).toBe(422);
  expect((await submit(f.preparing.orderNumber, 'cancel')).statusCode).toBe(
    404,
  );
  expect((await submit(f.review.orderNumber, 'mark-paid')).statusCode).toBe(
    404,
  );
});

it('serializes dispatch, tracking corrections and delivery with E5 visibility and one expense', async () => {
  const order = f.preparing;
  const customerDetail = (prefix = '/account/orders') =>
    f.app.inject({
      url: `${prefix}/${order.orderNumber}`,
      cookies: f.customerCookies,
    });
  const attempts = await f.db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.orderId, order.id));
  const readShipment = () =>
    f.db
      .select()
      .from(orderFulfillments)
      .where(eq(orderFulfillments.orderId, order.id));
  const expense = () =>
    f.db
      .select()
      .from(financialTransactions)
      .where(eq(financialTransactions.shipmentOrderId, order.id));
  const shipments = await Promise.all([
    submit(order.orderNumber, 'ship', shipment),
    submit(order.orderNumber, 'ship', shipment),
  ]);
  for (const result of shipments) {
    expect(result.statusCode).toBe(303);
    expect(result.headers.location).toBe(`${base}/${order.orderNumber}`);
  }
  expect(await readShipment()).toMatchObject([
    {
      trackingNumber: shipment.trackingNumber,
      status: 'SHIPPED',
      actualShippingCost: 18500n,
    },
  ]);
  expect(await expense()).toMatchObject([
    { amountRupiah: 18500n, type: 'SHIPPING_EXPENSE', category: 'TRANSPORT' },
  ]);
  expect((await customerDetail()).body).toContain(shipment.trackingNumber);
  expect((await customerDetail()).body).not.toContain('Rp18,500');
  const corrected = {
    previousTrackingNumber: shipment.trackingNumber,
    trackingNumber: '000E6-CORRECTED',
  };
  const corrections = await Promise.all([
    submit(order.orderNumber, 'tracking', corrected),
    submit(order.orderNumber, 'tracking', corrected),
  ]);
  expect(corrections.map((result) => result.statusCode)).toEqual([303, 303]);
  expect(
    (
      await submit(order.orderNumber, 'tracking', {
        ...corrected,
        trackingNumber: 'STALE',
      })
    ).statusCode,
  ).toBe(422);
  expect(await f.db.select().from(orderTrackingChanges)).toMatchObject([
    { orderId: order.id, ...corrected, changedById: f.admin.id },
  ]);
  const detail = await admin(`${base}/${order.orderNumber}`);
  expect(detail.body).toContain(f.admin.name);
  expect(detail.body).toContain('data-shipping-expense>Posted');
  expect(detail.body).toContain(corrected.trackingNumber);
  expect((await customerDetail()).body).toContain(corrected.trackingNumber);
  const before = await f.accountingRows();
  const previousExpenses = await expense();
  const deliveries = await Promise.all([
    submit(order.orderNumber, 'deliver'),
    submit(order.orderNumber, 'deliver'),
  ]);
  expect(deliveries.map((result) => result.statusCode)).toEqual([303, 303]);
  const delivered = await readShipment();
  expect(delivered).toMatchObject([
    { status: 'DELIVERED', deliveredAt: expect.any(Date) },
  ]);
  await submit(order.orderNumber, 'deliver');
  expect(await readShipment()).toEqual(delivered);
  expect((await customerDetail('/id/akun/pesanan')).body).toContain(
    'data-order-status>Terkirim',
  );
  expect((await admin(`${base}/${order.orderNumber}`)).body).not.toContain(
    'Mark as delivered',
  );
  expect(await f.accountingRows()).toEqual(before);
  expect(await expense()).toEqual(previousExpenses);
  expect(
    await f.db
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.orderId, order.id)),
  ).toEqual(attempts);
  const [unchanged] = await f.db
    .select()
    .from(orders)
    .where(eq(orders.id, order.id));
  expect(unchanged).toEqual(order);
});
