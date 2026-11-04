import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { storefrontNavigationFixture } from './helpers/storefront-navigation-fixture.js';
import { createCartService } from '../src/modules/cart/service.js';
import { createOrderService } from '../src/modules/orders/service.js';
import { buildApp } from '../src/app.js';
import { readEnv } from '../src/config/env.js';
import { resolvePeriod } from '../src/modules/finance/ledger.js';
import { createAuth } from '../src/modules/auth/service.js';
import { createPosAuth } from '../src/modules/pos/auth.js';
import {
  cartItems,
  carts,
  directCosts,
  inventoryMovements,
  financialTransactions,
  orders as orderTable,
  products,
  productVariants,
  sales,
  salePayments,
} from '../src/db/schema/index.js';

let f: Awaited<ReturnType<typeof storefrontNavigationFixture>>;
let cart: ReturnType<typeof createCartService>;
let orders: ReturnType<typeof createOrderService>;
let app: FastifyInstance;
let customer: string;
let cookies: Record<string, string>;
let csrf: string;
const origin = 'http://127.0.0.1:3051';

beforeAll(async () => {
  f = await storefrontNavigationFixture();
  expect(new URL(f.url).pathname).toMatch(/^\/lokka_verify_/);
  cart = createCartService(f.db);
  orders = createOrderService(f.db);
  app = await buildApp(
    readEnv({
      ...process.env,
      DATABASE_URL: f.url,
      NODE_ENV: 'test',
      APP_URL: origin,
    }),
    { database: { ...f.database, close: async () => {} }, logger: false },
  );
}, 30000);
afterAll(async () => {
  await app?.close();
  await f?.cleanup();
});
beforeEach(async () => {
  await f.db
    .update(products)
    .set({ status: 'active', name: f.product.name, updatedAt: new Date() })
    .where(eq(products.id, f.product.id));
  await f.db
    .update(productVariants)
    .set({
      status: 'active',
      price: f.variant.price,
      stockQuantity: 100,
      sku: f.variant.sku,
      name: 'M',
      updatedAt: new Date(),
    })
    .where(eq(productVariants.id, f.variant.id));
  await f.db
    .update(directCosts)
    .set({ amountRupiah: 300000n, updatedAt: new Date() })
    .where(eq(directCosts.id, f.cost.id));
  const result = await f.auth.register(
    {
      name: 'Cart customer',
      email: `${randomUUID()}@example.test`,
      password: 'temporary-customer-password',
    },
    null,
    null,
  );
  customer = result.customer!.id;
  csrf = result.csrfToken;
  cookies = { lokka_customer: result.sessionToken, lokka_customer_csrf: csrf };
});
const add = (qty = 1) => cart.mutate(customer, 'add', f.variant.id, qty);
const create = async () =>
  orders.create(customer, (await cart.get(customer)).cart!.revision);
const post = (
  url: string,
  payload: Record<string, unknown>,
  customCookies = cookies,
) =>
  app.inject({
    method: 'POST',
    url,
    cookies: customCookies,
    headers: { origin },
    payload: { csrf, ...payload },
  });

describe('cart domain', () => {
  it('adds, merges, increases, decreases and removes quantities', async () => {
    await add(2);
    await add(3);
    let state = await cart.get(customer);
    expect(state.items).toHaveLength(1);
    expect(state.items[0]!.item.quantity).toBe(5);
    await cart.mutate(customer, 'update', state.items[0]!.item.id, 8);
    expect((await cart.get(customer)).subtotal).toBe(6360000n);
    await cart.mutate(customer, 'update', state.items[0]!.item.id, 1);
    state = await cart.get(customer);
    expect(state.subtotal).toBe(795000n);
    await cart.mutate(customer, 'remove', state.items[0]!.item.id);
    expect((await cart.get(customer)).canOrder).toBe(false);
  });
  it.each([0, -1, 1.5, '1e2', '0', '99999999999', null, NaN])(
    'rejects invalid quantity %s',
    async (value) => {
      await expect(
        cart.mutate(customer, 'add', f.variant.id, value),
      ).rejects.toThrow('shop.error.quantity');
    },
  );
  it('rejects insufficient stock including duplicate adds', async () => {
    await add(100);
    await expect(add()).rejects.toThrow('shop.error.stock');
    await f.db
      .update(productVariants)
      .set({ stockQuantity: 0, updatedAt: new Date() })
      .where(eq(productVariants.id, f.variant.id));
    await expect(
      cart.mutate(
        customer,
        'update',
        (await cart.get(customer)).items[0]!.item.id,
        1,
      ),
    ).rejects.toThrow('shop.error.stock');
    expect((await cart.get(customer)).items[0]!.available).toBe(false);
  });
  it.each(['draft', 'archived'] as const)(
    'rejects %s products',
    async (status) => {
      await f.db
        .update(products)
        .set({ status, updatedAt: new Date() })
        .where(eq(products.id, f.product.id));
      await expect(add()).rejects.toThrow('shop.error.unavailable');
    },
  );
  it('rejects inactive variants', async () => {
    await f.db
      .update(productVariants)
      .set({ status: 'inactive', updatedAt: new Date() })
      .where(eq(productVariants.id, f.variant.id));
    await expect(add()).rejects.toThrow('shop.error.unavailable');
  });
  it('keeps variants distinct and prices above Number precision exact', async () => {
    const [v] = await f.db
      .insert(productVariants)
      .values({
        productId: f.product.id,
        name: 'L',
        sku: `L-${randomUUID()}`,
        price: 9007199254740993n,
        weightGrams: 100,
        stockQuantity: 10,
        status: 'active',
      })
      .returning();
    await add(2);
    await cart.mutate(customer, 'add', v!.id, 3);
    const state = await cart.get(customer);
    expect(state.items).toHaveLength(2);
    expect(state.subtotal).toBe(27021597765812979n);
  });
  it('serializes concurrent initial adds into one cart and item', async () => {
    await Promise.all([add(2), add(3), add(4)]);
    const state = await cart.get(customer);
    expect(state.items).toHaveLength(1);
    expect(state.items[0]!.item.quantity).toBe(9);
    expect(
      await f.db.select().from(carts).where(eq(carts.customerId, customer)),
    ).toHaveLength(1);
  });
});

describe('canonical order foundation', () => {
  it('recomputes price, snapshots all facts and keeps history after catalog edits', async () => {
    await add(2);
    await f.db
      .update(productVariants)
      .set({ price: 800000n, updatedAt: new Date() })
      .where(eq(productVariants.id, f.variant.id));
    const order = await create();
    expect(order.source).toBe('WEBSTORE');
    expect(order.status).toBe('PENDING_PAYMENT');
    expect(order.subtotal).toBe(1600000n);
    expect(order.shippingAmount).toBe(0n);
    const snapshot = await orders.get(customer, order.orderNumber);
    expect(snapshot!.items[0]).toMatchObject({
      productNameSnapshot: f.product.name,
      variantNameSnapshot: 'M',
      skuSnapshot: 'ACC-M',
      unitPriceSnapshot: 800000n,
      lineTotalSnapshot: 1600000n,
      costSnapshot: 300000n,
      quantity: 2,
    });
    await f.db
      .update(products)
      .set({ name: 'Changed name', updatedAt: new Date() })
      .where(eq(products.id, f.product.id));
    await f.db
      .update(productVariants)
      .set({
        price: 900000n,
        sku: `changed-${randomUUID()}`,
        name: 'Changed variant',
        updatedAt: new Date(),
      })
      .where(eq(productVariants.id, f.variant.id));
    await f.db
      .update(directCosts)
      .set({ amountRupiah: 700000n, updatedAt: new Date() })
      .where(eq(directCosts.id, f.cost.id));
    expect(await orders.get(customer, order.orderNumber)).toEqual(snapshot);
    expect((await cart.get(customer)).items).toHaveLength(0);
  });
  it('stores unknown direct cost as null and explicit zero as zero', async () => {
    const [p] = await f.db
      .insert(products)
      .values({
        vendorId: f.product.vendorId,
        name: 'Unknown cost',
        slug: randomUUID(),
        status: 'active',
      })
      .returning();
    const [v] = await f.db
      .insert(productVariants)
      .values({
        productId: p!.id,
        name: 'One',
        sku: randomUUID(),
        price: 100n,
        weightGrams: 1,
        stockQuantity: 5,
        status: 'active',
      })
      .returning();
    await cart.mutate(customer, 'add', v!.id, 1);
    const first = await create();
    expect(
      (await orders.get(customer, first.orderNumber))!.items[0]!.costSnapshot,
    ).toBeNull();
    await f.db.insert(directCosts).values({
      productId: p!.id,
      name: 'Explicit zero',
      category: 'OTHER',
      amountRupiah: 0n,
    });
    await cart.mutate(customer, 'add', v!.id, 1);
    const second = await create();
    expect(
      (await orders.get(customer, second.orderNumber))!.items[0]!.costSnapshot,
    ).toBe(0n);
  });
  it('rejects empty carts and stale revisions', async () => {
    await add();
    const revision = (await cart.get(customer)).cart!.revision;
    await add();
    await expect(orders.create(customer, revision)).rejects.toThrow(
      'shop.error.changed',
    );
    await cart.mutate(
      customer,
      'remove',
      (await cart.get(customer)).items[0]!.item.id,
    );
    await expect(create()).rejects.toThrow('shop.error.empty');
  });
  it.each(['stock', 'archived', 'inactive'])(
    'revalidates %s inside order transaction',
    async (state) => {
      await add(2);
      if (state === 'stock')
        await f.db
          .update(productVariants)
          .set({ stockQuantity: 1, updatedAt: new Date() })
          .where(eq(productVariants.id, f.variant.id));
      else if (state === 'archived')
        await f.db
          .update(products)
          .set({ status: 'archived', updatedAt: new Date() })
          .where(eq(products.id, f.product.id));
      else
        await f.db
          .update(productVariants)
          .set({ status: 'inactive', updatedAt: new Date() })
          .where(eq(productVariants.id, f.variant.id));
      await expect(create()).rejects.toThrow(
        state === 'stock' ? 'shop.error.stock' : 'shop.error.unavailable',
      );
      expect(await orders.list(customer)).toHaveLength(0);
    },
  );
  it('rechecks stock after waiting for a concurrent stock writer', async () => {
    await add(2);
    let locked!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((r) => {
      locked = r;
    });
    const hold = new Promise<void>((r) => {
      release = r;
    });
    const writer = f.db.transaction(async (tx) => {
      await tx
        .select()
        .from(products)
        .where(eq(products.id, f.product.id))
        .for('update');
      await tx
        .update(productVariants)
        .set({ stockQuantity: 0, updatedAt: new Date() })
        .where(eq(productVariants.id, f.variant.id));
      locked();
      await hold;
    });
    await ready;
    const attempt = create();
    release();
    await writer;
    await expect(attempt).rejects.toThrow('shop.error.stock');
  });
  it('retries concurrently and after cart reuse return the same order', async () => {
    await add();
    const revision = (await cart.get(customer)).cart!.revision;
    const results = await Promise.all([
      orders.create(customer, revision),
      orders.create(customer, revision),
    ]);
    expect(results[0]!.id).toBe(results[1]!.id);
    await add(2);
    expect((await orders.create(customer, revision)).id).toBe(results[0]!.id);
    expect((await cart.get(customer)).items[0]!.item.quantity).toBe(2);
    expect(await orders.list(customer)).toHaveLength(1);
  });
  it('generates unique WEB numbers for concurrent customer orders', async () => {
    await add();
    await cart.mutate(f.customer.customer.id, 'add', f.variant.id, 1);
    const [a, b] = await Promise.all([
      create(),
      orders.create(
        f.customer.customer.id,
        (await cart.get(f.customer.customer.id)).cart!.revision,
      ),
    ]);
    expect(a.orderNumber).toMatch(/^WEB-\d{8}-\d{6,}$/);
    expect(a.orderNumber).not.toBe(b.orderNumber);
  });
  it('cancels without deleting history and permits idempotent cancellation', async () => {
    await add();
    const order = await create();
    const snapshot = await orders.get(customer, order.orderNumber);
    await orders.cancel(customer, order.orderNumber);
    await orders.cancel(customer, order.orderNumber);
    const cancelled = await orders.get(customer, order.orderNumber);
    expect(cancelled!.status).toBe('CANCELLED');
    expect(cancelled!.items).toEqual(snapshot!.items);
    expect(await orders.list(customer)).toHaveLength(1);
  });
  it('does not complete sales, create payments, move inventory, deduct stock or recognize income', async () => {
    const tables = [
      sales,
      salePayments,
      financialTransactions,
      inventoryMovements,
    ];
    const counts = async () =>
      Promise.all(
        tables.map((table) =>
          f.db.select({ count: sql<string>`count(*)::text` }).from(table),
        ),
      );
    const before = await counts();
    const period = resolvePeriod({
      period: 'custom',
      from: '2000-01-01',
      to: '2100-01-01',
    });
    const accountingBefore = await f.accounting.report(period);
    const ledgerBefore = await f.ledger.cashFlow(period);
    await add(3);
    const order = await create();
    expect(await counts()).toEqual(before);
    expect(await f.accounting.report(period)).toEqual(accountingBefore);
    expect(await f.ledger.cashFlow(period)).toEqual(ledgerBefore);
    expect(
      (
        await f.db
          .select()
          .from(productVariants)
          .where(eq(productVariants.id, f.variant.id))
      )[0]!.stockQuantity,
    ).toBe(100);
    await orders.cancel(customer, order.orderNumber);
    expect(await counts()).toEqual(before);
  });
});

describe('customer security and localized routes', () => {
  it('does not accept valid admin or POS sessions as customer identity', async () => {
    const admin = await createAuth(f.db).login(
      f.admin.email,
      'temporary-accounting-password',
      '127.0.0.1',
      'test',
    );
    const pos = await createPosAuth(f.db).login(
      f.admin.email,
      'temporary-accounting-password',
      '127.0.0.1',
      'test',
    );
    expect(admin).not.toBeNull();
    expect(pos).not.toBeNull();
    for (const [prefix, session] of [
      ['admin', admin!],
      ['pos', pos!],
    ] as const) {
      const otherCookies = {
        [`lokka_${prefix}`]: session.sessionToken,
        [`lokka_${prefix}_csrf`]: session.csrf,
      };
      expect(
        (
          await post(
            '/cart/items',
            { variantId: f.variant.id, quantity: 1, csrf: session.csrf },
            otherCookies,
          )
        ).statusCode,
      ).toBe(303);
    }
    expect((await cart.get(customer)).items).toHaveLength(0);
  });
  it('rejects revoked customer sessions and mismatched session CSRF cookies', async () => {
    expect(
      (
        await post(
          '/cart/items',
          { variantId: f.variant.id, quantity: 1 },
          { ...cookies, lokka_customer_csrf: f.customer.csrfToken },
        )
      ).statusCode,
    ).toBe(303);
    await f.auth.logout(cookies.lokka_customer);
    expect(
      (await post('/cart/items', { variantId: f.variant.id, quantity: 1 }))
        .statusCode,
    ).toBe(303);
    expect((await cart.get(customer)).items).toHaveLength(0);
  });
  it('requires customer login and rejects invalid CSRF and origins', async () => {
    expect((await app.inject('/cart')).statusCode).toBe(303);
    expect(
      (await post('/cart/items', { variantId: f.variant.id, quantity: 1 }, {}))
        .statusCode,
    ).toBe(303);
    expect(
      (
        await post('/cart/items', {
          csrf: 'bad',
          variantId: f.variant.id,
          quantity: 1,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/cart/items',
          cookies,
          headers: { origin: 'https://evil.test' },
          payload: { csrf, variantId: f.variant.id, quantity: 1 },
        })
      ).statusCode,
    ).toBe(403);
    expect((await cart.get(customer)).items).toHaveLength(0);
  });
  it('enforces cart item and order ownership including foreign revision tokens', async () => {
    await add();
    const state = await cart.get(customer);
    const other = f.customer.customer.id;
    await expect(
      cart.mutate(other, 'update', state.items[0]!.item.id, 2),
    ).rejects.toThrow('shop.error.item');
    await expect(
      cart.mutate(other, 'remove', state.items[0]!.item.id),
    ).rejects.toThrow('shop.error.item');
    await expect(orders.create(other, state.cart!.revision)).rejects.toThrow(
      'shop.error.changed',
    );
    const order = await create();
    expect(await orders.get(other, order.orderNumber)).toBeNull();
    await expect(orders.cancel(other, order.orderNumber)).rejects.toThrow(
      'shop.error.cancel',
    );
    const foreignCookies = {
      lokka_customer: f.customer.sessionToken,
      lokka_customer_csrf: f.customer.csrfToken,
    };
    expect(
      (
        await app.inject({
          url: `/account/orders/${order.orderNumber}`,
          cookies: foreignCookies,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await post(
          `/account/orders/${order.orderNumber}/cancel`,
          { csrf: f.customer.csrfToken },
          foreignCookies,
        )
      ).statusCode,
    ).toBe(404);
  });
  it('renders EN/ID cart, review and historical order pages with header count', async () => {
    expect(
      (
        await post('/cart/items', {
          variantId: f.variant.id,
          quantity: '2',
          price: '1',
        })
      ).statusCode,
    ).toBe(303);
    const page = await app.inject({ url: '/cart', cookies });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('data-cart-count>2</span>');
    expect(page.headers['cache-control']).toContain('private');
    expect(
      (await app.inject({ url: '/id/keranjang', cookies })).body,
    ).toContain('Keranjang');
    expect((await app.inject({ url: '/cart/review', cookies })).body).toContain(
      'Create pending order',
    );
    const revision = (await cart.get(customer)).cart!.revision;
    const response = await post('/cart/orders', { revision, subtotal: '1' });
    expect(response.statusCode).toBe(303);
    const order = (await orders.list(customer))[0]!;
    expect(order.subtotal).toBe(1590000n);
    for (const path of [
      '/account/orders',
      `/account/orders/${order.orderNumber}`,
      '/id/akun/pesanan',
      `/id/akun/pesanan/${order.orderNumber}`,
    ]) {
      const result = await app.inject({ url: path, cookies });
      expect(result.statusCode).toBe(200);
      expect(result.body).toContain(order.orderNumber);
    }
  });
  it('rejects overflowing totals atomically', async () => {
    await f.db
      .update(productVariants)
      .set({ price: 9223372036854775807n, updatedAt: new Date() })
      .where(eq(productVariants.id, f.variant.id));
    await add(2);
    expect((await cart.get(customer)).canOrder).toBe(false);
    await expect(create()).rejects.toThrow('shop.error.total');
    expect(
      await f.db
        .select()
        .from(orderTable)
        .where(eq(orderTable.customerId, customer)),
    ).toHaveLength(0);
    expect(
      await f.db
        .select()
        .from(cartItems)
        .where(eq(cartItems.cartId, (await cart.get(customer)).cart!.id)),
    ).toHaveLength(1);
  });
});
