import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createOrderHistory } from '../src/modules/orders/history.js';
import {
  historyBase,
  orderHistoryFixture,
} from './helpers/order-history-fixture.js';

const transport = vi.fn<typeof fetch>(async () => {
  throw new Error('Unexpected payment call');
});
let fixture: Awaited<ReturnType<typeof orderHistoryFixture>>;
beforeAll(async () => {
  fixture = await orderHistoryFixture(transport);
}, 30000);
afterAll(async () => {
  await fixture?.close();
});

function get(url: string, identity = fixture.customer) {
  return fixture.app.inject({
    url,
    cookies: {
      lokka_customer: identity.sessionToken,
      lokka_customer_csrf: identity.csrfToken,
    },
  });
}

it('loads a bounded, stable customer page with quantity counts and totals in one query', async () => {
  const history = createOrderHistory(fixture.db);
  const owner = fixture.customer.customer.id;
  const queries = vi.spyOn(fixture.db.$client, 'query');
  try {
    const first = await history.list(owner, { status: 'waiting' });
    expect(queries).toHaveBeenCalledTimes(1);
    const second = await history.list(owner, { status: 'waiting', page: '2' });
    const sorted = [...fixture.waiting].sort((a, b) =>
      b.id.localeCompare(a.id),
    );
    expect(first).toMatchObject({ page: 1, filter: 'waiting', hasNext: true });
    expect(first.orders.map((row) => row.orderNumber)).toEqual(
      sorted.slice(0, 12).map((row) => row.orderNumber),
    );
    expect(second).toMatchObject({
      page: 2,
      filter: 'waiting',
      hasNext: false,
    });
    expect(second.orders.map((row) => row.orderNumber)).toEqual([
      sorted[12]!.orderNumber,
      fixture.legacy.orderNumber,
      fixture.expired.orderNumber,
      fixture.pending.orderNumber,
    ]);
    expect(second.orders.at(-1)).toMatchObject({
      itemCount: '3',
      grandTotal: 170000n,
      paymentStatus: null,
      shipmentStatus: null,
    });
    expect(
      await history.list(owner, { status: '__proto__', page: '-1' }),
    ).toMatchObject({ page: 1, filter: 'all' });
  } finally {
    queries.mockRestore();
  }
});

it('uses the effective payment and fulfillment state consistently across list and detail', async () => {
  const history = createOrderHistory(fixture.db);
  const owner = fixture.customer.customer.id;
  const rows = await history.list(owner, { status: 'processing' });
  expect(
    rows.orders.map((row) => [row.orderNumber, row.status, row.paymentStatus]),
  ).toEqual([
    [fixture.created.orderNumber, 'PAYMENT_PROCESSING', 'CREATED'],
    [fixture.processing.orderNumber, 'PAYMENT_PROCESSING', 'PENDING'],
    [fixture.review.orderNumber, 'PAYMENT_REVIEW', 'REVIEW'],
    [fixture.preparing.orderNumber, 'PREPARING_ORDER', 'PAID'],
  ]);
  for (const [row, label, action] of [
    [fixture.pending, 'Waiting for payment', 'Pay now'],
    [fixture.processing, 'Payment processing', 'Continue to payment'],
    [fixture.expired, 'Waiting for payment', 'Retry payment'],
    [fixture.review, 'Payment confirmation under review', null],
    [fixture.created, 'Payment processing', null],
    [fixture.preparing, 'Preparing your order', null],
    [fixture.shipped, 'Shipped', null],
    [fixture.delivered, 'Delivered', null],
    [fixture.cancelled, 'Cancelled', null],
  ] as const) {
    const response = await get('/account/orders/' + row.orderNumber);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(`<p data-order-status>${label}</p>`);
    if (action) expect(response.body).toContain(`${action}</button>`);
    else
      expect(response.body).not.toContain(
        `action="/account/orders/${row.orderNumber}/payment"`,
      );
    expect(response.body).not.toContain(row.id);
  }
  expect(
    (await get('/account/orders/' + fixture.preparing.orderNumber)).body,
  ).not.toContain('Payment expired');
  expect(
    (await get('/account/orders/' + fixture.review.orderNumber)).body,
  ).not.toContain(fixture.paidAt.toISOString());
  for (const status of ['shipped', 'delivered', 'cancelled'] as const) {
    const filtered = await history.list(owner, { status });
    expect(filtered.orders.map((row) => row.orderNumber)).toEqual([
      fixture[status].orderNumber,
    ]);
  }
});

it('renders historical snapshots, both couriers and only recorded timeline timestamps without accounting writes', async () => {
  const before = await fixture.accountingRows();
  expect(before).toEqual([0, 0, 0, 0]);
  const pending = await get('/account/orders/' + fixture.pending.orderNumber);
  for (const fact of [
    'Historical shirt',
    'Medium',
    'OLD-001',
    'Rp150,000',
    'Rp22,000',
    'Rp2,000',
    'Rp170,000',
    '650 g',
    '2–3 days',
    'Jalan Merdeka 10',
  ])
    expect(pending.body).toContain(fact);
  expect(pending.body).not.toContain('Rp1,234');
  const delivered = await get(
    '/id/akun/pesanan/' + fixture.delivered.orderNumber,
  );
  for (const fact of [
    'J&amp;T Express',
    'JNE',
    'REG',
    'Nomor resi',
    'Terkirim',
    'JNE456',
    fixture.delivered.createdAt.toISOString(),
    fixture.paidAt.toISOString(),
    fixture.shippedAt.toISOString(),
    fixture.deliveredAt.toISOString(),
  ])
    expect(delivered.body).toContain(fact);
  expect(delivered.body).not.toMatch(
    /18\.765|18,765|actual_shipping_cost|actualShippingCost/,
  );
  const timeline = delivered.body.match(
    /<ol data-order-timeline>([\s\S]+?)<\/ol>/,
  )?.[1];
  expect(timeline?.match(/<time /g)).toHaveLength(4);
  const legacy = await get('/account/orders/' + fixture.legacy.orderNumber);
  expect(legacy.body).toContain('Delivery details are unavailable');
  expect(legacy.body).toContain('No payment recorded');
  expect(legacy.body).not.toContain('Pay now');
  expect(
    legacy.body
      .match(/<ol data-order-timeline>([\s\S]+?)<\/ol>/)?.[1]
      ?.match(/<time /g),
  ).toHaveLength(1);
  await get('/account/orders?status=waiting&page=2');
  await get(
    '/account/orders/' +
      fixture.pending.orderNumber +
      '/payment/return?status=SUCCESS',
  );
  expect(await fixture.accountingRows()).toEqual(before);
  expect(transport).not.toHaveBeenCalled();
});

it('enforces ownership and privacy for lists, details, returns and POST actions', async () => {
  const orderPath = '/account/orders/' + fixture.foreign.orderNumber;
  const page = await get('/account/orders?status=waiting&page=2');
  expect(page.body).not.toContain(fixture.foreign.orderNumber);
  expect(page.headers['cache-control']).toBe('private, no-store');
  expect(page.headers['x-robots-tag']).toBe('noindex, nofollow');
  expect((await get(orderPath)).statusCode).toBe(404);
  expect((await get(orderPath + '/payment/return')).statusCode).toBe(404);
  const identity = fixture.customer;
  const cookies = {
    lokka_customer: identity.sessionToken,
    lokka_customer_csrf: identity.csrfToken,
  };
  for (const action of ['/cancel', '/payment']) {
    expect(
      (
        await fixture.app.inject({
          method: 'POST',
          url: orderPath + action,
          headers: { origin: historyBase },
          cookies,
          payload: { csrf: identity.csrfToken },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await fixture.app.inject({
          method: 'POST',
          url: orderPath + action,
          headers: { origin: historyBase },
          cookies,
        })
      ).statusCode,
    ).toBe(403);
  }
  const guest = await fixture.app.inject(
    '/account/orders?status=waiting&page=2',
  );
  expect(guest.statusCode).toBe(303);
  expect(decodeURIComponent(String(guest.headers.location))).toContain(
    'returnTo=/account/orders?status=waiting&page=2',
  );
  expect((await fixture.app.inject('/sitemap.xml')).body).not.toMatch(
    /\/account\/orders|\/id\/akun\/pesanan/,
  );
  expect(transport).not.toHaveBeenCalled();
});
