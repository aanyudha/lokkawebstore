import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { investorFixture } from './helpers/investor-fixture.js';
import { importOwnerData } from '../src/modules/finance/owner-import.js';
import { createCatalogOperations } from '../src/modules/catalog/operations.js';
import { createCatalog } from '../src/modules/catalog/service.js';
import {
  canSellInPos,
  canSellInWebstore,
} from '../src/modules/catalog/sellability.js';
import { createSalesService } from '../src/modules/sales/service.js';
import { createCartService } from '../src/modules/cart/service.js';
import { createOrderService } from '../src/modules/orders/service.js';
import { createFixedAssets } from '../src/modules/finance/fixed-assets.js';
import { createLedger, resolvePeriod } from '../src/modules/finance/ledger.js';
import {
  products,
  productVariants,
  inventoryMovements,
  sales,
  saleItems,
  salePayments,
  financialTransactions,
  customers,
  vendors,
} from '../src/db/schema/index.js';
import { buildApp } from '../src/app.js';
import { readEnv } from '../src/config/env.js';
import type { FastifyInstance } from 'fastify';
let f: Awaited<ReturnType<typeof investorFixture>>;
let app: FastifyInstance;
let cookie = '';
let csrf = '';
let operations: ReturnType<typeof createCatalogOperations>;
let catalog: ReturnType<typeof createCatalog>;
let first: typeof products.$inferSelect;
let second: typeof products.$inferSelect;
let unknown: typeof products.$inferSelect;
const variant = async (productId: string) =>
  (
    await f.db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, productId))
  )[0]!;
const post = (
  url: string,
  payload: Record<string, unknown>,
  origin = 'http://127.0.0.1:3000',
) =>
  app.inject({
    method: 'POST',
    url,
    headers: { cookie, origin },
    payload: { csrf, ...payload },
  });
beforeAll(async () => {
  f = await investorFixture();
  await importOwnerData(f.db, f.storage, f.payload, f.admin.id, true);
  operations = createCatalogOperations(f.db, f.storage);
  catalog = createCatalog(f.db, f.storage);
  first = (
    await f.db
      .select()
      .from(products)
      .where(eq(products.slug, 'synthetic-inventory-1-owner-1'))
  )[0]!;
  second = (
    await f.db
      .select()
      .from(products)
      .where(eq(products.slug, 'synthetic-inventory-2-owner-2'))
  )[0]!;
  unknown = (
    await f.db
      .select()
      .from(products)
      .where(eq(products.slug, 'synthetic-inventory-34-owner-34'))
  )[0]!;
  app = await buildApp(
    readEnv({
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: f.url,
      APP_URL: 'http://127.0.0.1:3000',
    }),
    { database: { ...f.database, close: async () => {} }, logger: false },
  );
  const login = await app.inject('/admin/login');
  const token = login.cookies.find((c) => c.name === 'lokka_login_csrf')!.value;
  const response = await app.inject({
    method: 'POST',
    url: '/admin/login',
    cookies: { lokka_login_csrf: token },
    payload: {
      csrf: token,
      email: f.admin.email,
      password: 'temporary-investor-password',
    },
  });
  expect(response.statusCode).toBe(303);
  cookie = response.cookies
    .filter((c) => c.value)
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  csrf = response.cookies.find((c) => c.name === 'lokka_admin_csrf')!.value;
}, 60000);
afterAll(async () => {
  await app?.close();
  await f?.cleanup();
}, 60000);
describe('catalog operations and channel contracts', () => {
  it('bulk activates selected eligible variants without weight, reports unknown and archived failures, and leaves unselected products alone', async () => {
    const [archived] = await f.db
      .select()
      .from(products)
      .where(eq(products.slug, 'lokka-demo-shirt'));
    const result = await operations.bulkProducts({
      action: 'activate',
      selected: [first.id, second.id, unknown.id, archived!.id, randomUUID()],
    });
    expect(result).toMatchObject({ updated: 2, skipped: 1, failed: 2 });
    expect(result.rows.find((r) => r.id === unknown.id)!.reason).toContain(
      'Stock unknown',
    );
    expect((await catalog.product(first.id)).status).toBe('active');
    expect(await variant(first.id)).toMatchObject({
      status: 'active',
      weightGrams: 0,
      stockKnown: true,
      stockQuantity: 2,
    });
    expect((await catalog.product(unknown.id)).status).toBe('draft');
    expect(
      (await operations.productList({ q: 'LOKKA-SYS-OWNER-001' })).products[0]!
        .readiness,
    ).toEqual(
      expect.arrayContaining([
        'POS Ready',
        'Webstore Incomplete',
        'Weight Missing',
      ]),
    );
    const untouched = (
      await f.db
        .select()
        .from(products)
        .where(eq(products.slug, 'synthetic-inventory-3-owner-3'))
    )[0]!;
    expect(untouched.status).toBe('draft');
  });
  it('rolls back variant activation when the parent product cannot be activated', async () => {
    const product = (
      await f.db
        .select()
        .from(products)
        .where(eq(products.slug, 'synthetic-inventory-3-owner-3'))
    )[0]!;
    const original = await variant(product.id);
    const [bad] = await f.db
      .insert(productVariants)
      .values({
        productId: product.id,
        name: 'Invalid legacy active row',
        sku: 'INVALID-ACTIVE-FIXTURE',
        price: 0n,
        weightGrams: 0,
        status: 'active',
        stockQuantity: 1,
      })
      .returning();
    const result = await operations.bulkProducts({
      action: 'activate',
      selected: product.id,
    });
    expect(result.failed).toBe(1);
    expect((await catalog.product(product.id)).status).toBe('draft');
    expect(
      (
        await f.db
          .select()
          .from(productVariants)
          .where(eq(productVariants.id, original.id))
      )[0]!.status,
    ).toBe('inactive');
    await f.db.delete(productVariants).where(eq(productVariants.id, bad!.id));
  });
  it('saves an active variant with optional weight, sells it through POS, blocks online cart/direct completion, then enables online after confirmation', async () => {
    const original = await variant(first.id);
    const values = {
      name: original.name,
      sku: original.sku,
      price: String(original.price),
      stockKnown: 'true',
      stockQuantity: '2',
      status: 'active',
      weightGrams: '',
    };
    const saved = await catalog.saveVariant(first.id, values, original.id);
    expect(saved.weightGrams).toBe(0);
    const product = await catalog.product(first.id);
    expect(canSellInPos(product, saved)).toBe(true);
    expect(canSellInWebstore(product, saved)).toBe(false);
    const salesService = createSalesService(f.db);
    expect(
      (await salesService.searchProducts(saved.sku))[0]!.variants[0]!.posReady,
    ).toBe(true);
    const [customer] = await f.db
      .insert(customers)
      .values({
        name: 'Synthetic operations customer',
        email: 'operations@example.test',
        emailNormalized: 'operations@example.test',
        passwordHash: 'unused',
      })
      .returning();
    const cart = createCartService(f.db);
    await expect(cart.mutate(customer!.id, 'add', saved.id, 1)).rejects.toThrow(
      'unavailable',
    );
    await expect(
      salesService.completeSale({
        source: 'WEBSTORE',
        cashierId: f.admin.id,
        items: [{ variantId: saved.id, quantity: 1 }],
        cashTendered: 500n,
      }),
    ).rejects.toThrow('Webstore');
    const sale = await salesService.completeSale({
      source: 'POS',
      cashierId: f.admin.id,
      items: [{ variantId: saved.id, quantity: 1 }],
      cashTendered: 500n,
    });
    expect(sale.total).toBe(500n);
    expect((await variant(first.id)).stockQuantity).toBe(1);
    const ready = await catalog.saveVariant(
      first.id,
      { ...values, stockQuantity: '1', weightGrams: '300' },
      saved.id,
    );
    expect(canSellInWebstore(product, ready)).toBe(true);
    await cart.mutate(customer!.id, 'add', saved.id, 1);
    const before = await cart.get(customer!.id);
    expect(before.canOrder).toBe(true);
    await catalog.saveVariant(
      first.id,
      { ...values, stockQuantity: '1', weightGrams: '' },
      saved.id,
    );
    expect((await cart.get(customer!.id)).canOrder).toBe(false);
    await expect(
      createOrderService(f.db).create(customer!.id, before.cart!.revision),
    ).rejects.toThrow('unavailable');
    await catalog.saveVariant(
      first.id,
      { ...values, stockQuantity: '1', weightGrams: '300' },
      saved.id,
    );
    expect(
      (
        await createOrderService(f.db).create(
          customer!.id,
          before.cart!.revision,
        )
      ).status,
    ).toBe('PENDING_PAYMENT');
  });
  it('keeps confirmed zero distinct from unknown across both channels', async () => {
    const current = await variant(second.id);
    const product = await catalog.product(second.id);
    await catalog.stock(second.id, current.id, {
      stockKnown: 'true',
      stockQuantity: '0',
    });
    expect(canSellInPos(product, await variant(second.id))).toBe(false);
    expect(canSellInWebstore(product, await variant(second.id))).toBe(false);
    expect(
      (await operations.productList({ q: current.sku })).products[0]!.readiness,
    ).toContain('Out of Stock');
    await catalog.stock(second.id, current.id, {
      stockKnown: 'false',
      stockQuantity: '',
    });
    expect(
      (await operations.productList({ q: current.sku })).products[0]!.readiness,
    ).toContain('Stock Unknown');
    expect(
      (await operations.productList({ q: current.sku })).products[0]!.readiness,
    ).not.toContain('Out of Stock');
  });
  it('deactivates and safely archives referenced products without touching sale/payment/ledger snapshots', async () => {
    const before = await f.db.select().from(sales);
    const items = await f.db.select().from(saleItems);
    const payments = await f.db.select().from(salePayments);
    const ledger = await f.db.select().from(financialTransactions);
    expect(
      (
        await operations.bulkProducts({
          action: 'deactivate',
          selected: first.id,
        })
      ).updated,
    ).toBe(1);
    expect((await catalog.product(first.id)).status).toBe('draft');
    expect(
      (
        await operations.bulkProducts({
          action: 'activate',
          selected: first.id,
        })
      ).updated,
    ).toBe(1);
    expect(
      (await operations.bulkProducts({ action: 'archive', selected: first.id }))
        .updated,
    ).toBe(1);
    expect((await catalog.product(first.id)).status).toBe('archived');
    expect(await f.db.select().from(sales)).toEqual(before);
    expect(await f.db.select().from(saleItems)).toEqual(items);
    expect(await f.db.select().from(salePayments)).toEqual(payments);
    expect(await f.db.select().from(financialTransactions)).toEqual(ledger);
  });
  it('bulk stock updates use entered quantities, preserve invalid rows, and create factual correction/confirmation events only', async () => {
    const a = await variant(unknown.id);
    const b = await variant(second.id);
    const before = await f.db.select().from(inventoryMovements);
    const result = await operations.bulkInventory({
      action: 'save',
      selected: [a.id, b.id],
      ['stockKnown_' + a.id]: 'true',
      ['stockQuantity_' + a.id]: '5',
      ['stockKnown_' + b.id]: 'true',
      ['stockQuantity_' + b.id]: '-1',
      price: '999999',
      name: 'Must not change product',
    });
    expect(result).toMatchObject({ updated: 1, skipped: 0, failed: 1 });
    expect(await variant(unknown.id)).toMatchObject({
      stockKnown: true,
      stockQuantity: 5,
      price: 500n,
    });
    expect((await catalog.product(unknown.id)).name).toBe(unknown.name);
    expect((await variant(second.id)).stockKnown).toBe(false);
    const after = await f.db.select().from(inventoryMovements);
    expect(after).toHaveLength(before.length + 1);
    expect(after.filter((r) => r.variantId === a.id).at(-1)).toMatchObject({
      quantityChange: 5,
      type: 'CORRECTION',
      referenceType: 'MANUAL',
      notes: 'Bulk owner stock confirmation / correction',
    });
    expect(
      (await operations.bulkInventory({ action: 'save', selected: a.id }))
        .failed,
    ).toBe(1);
    expect(
      (
        await operations.bulkInventory({
          action: 'save',
          selected: a.id,
          ['stockKnown_' + a.id]: 'false',
          ['stockQuantity_' + a.id]: '',
        })
      ).failed,
    ).toBe(1);
    const blocked = await operations.bulkInventory({
      action: 'unknown',
      selected: a.id,
    });
    expect(blocked.failed).toBe(1);
    expect((await variant(unknown.id)).stockQuantity).toBe(5);
    await operations.bulkInventory({
      action: 'save',
      selected: a.id,
      ['stockKnown_' + a.id]: 'true',
      ['stockQuantity_' + a.id]: '0',
    });
    const count = (await f.db.select().from(inventoryMovements)).length;
    expect(
      (await operations.bulkInventory({ action: 'unknown', selected: a.id }))
        .updated,
    ).toBe(1);
    expect(await f.db.select().from(inventoryMovements)).toHaveLength(count);
    expect(await variant(unknown.id)).toMatchObject({
      stockKnown: false,
      stockQuantity: 0,
    });
  });
  it('searches product names, SKU, variant and category literally and paginates only on the server', async () => {
    for (const q of ['  sYnThEtIc InVeNtOrY 34  ', '  LOKKA-SYS-OWNER-034  '])
      expect(
        (await operations.productList({ q })).products.map((p) => p.id),
      ).toEqual([unknown.id]);
    expect((await operations.productList({ q: 'Default' })).listing.total).toBe(
      34,
    );
    expect(
      (await operations.productList({ q: 'accessories' })).listing.total,
    ).toBe(2);
    const firstPage = await operations.productList({
      q: 'Synthetic inventory',
    });
    const next = await operations.productList({
      q: 'Synthetic inventory',
      page: '2',
    });
    expect(firstPage.products).toHaveLength(25);
    expect(next.products).toHaveLength(9);
    expect(
      new Set([...firstPage.products, ...next.products].map((p) => p.id)).size,
    ).toBe(34);
    expect(firstPage.listing.next).toContain('q=Synthetic+inventory');
    expect(
      (await operations.inventoryList({ q: 'LOKKA-SYS-OWNER-034' })).inventory,
    ).toHaveLength(1);
    expect(
      (await operations.inventoryList({ q: 'Default', page: '2' })).inventory,
    ).toHaveLength(9);
    expect(
      (await operations.inventoryList({ stock: 'unknown' })).inventory.every(
        (r) => !r.variant.stockKnown,
      ),
    ).toBe(true);
    const literal = await catalog.saveProduct({
      name: 'Literal_% product',
      slug: 'literal-symbols',
      status: 'draft',
    });
    expect(
      (await operations.productList({ q: '_%' })).products.map((p) => p.id),
    ).toEqual([literal.id]);
  });
  it('searches fixed asset names, units and statuses without filtering the global acquisition total', async () => {
    const fixed = createFixedAssets(f.db);
    const [asset] = await fixed.list();
    await fixed.save(
      {
        assetName: asset!.assetName,
        quantity: String(asset!.quantity),
        unit: 'Pack',
        acquisitionCostPerUnit: String(asset!.acquisitionCostPerUnit),
        status: 'DISPOSED',
      },
      f.admin.id,
      asset!.id,
    );
    const page = await fixed.listPage({ q: '  disposed ' });
    expect(page.assets).toHaveLength(1);
    expect(page.activeTotal).toBe(38000n);
    expect((await fixed.listPage({ q: 'pack' })).assets).toHaveLength(1);
    expect(
      (await fixed.listPage({ q: 'Synthetic asset 20' })).assets,
    ).toHaveLength(1);
  });
  it('searches finance descriptions, human category labels and POS references without changing totals', async () => {
    const ledger = createLedger(f.db);
    await ledger.recordManual(
      {
        direction: 'EXPENSE',
        category: 'SALARIES',
        amountRupiah: '10',
        occurredAt: '2026-11-01T10:00',
        notes: 'Search regression wages',
      },
      f.admin.id,
    );
    const period = resolvePeriod({
      period: 'custom',
      from: '2026-01-01',
      to: '2027-01-01',
    });
    const before = await ledger.cashFlow(period);
    expect(
      (await ledger.history({ q: 'regression wages' })).manual,
    ).toHaveLength(1);
    expect(
      (await ledger.history({ q: 'Salaries & wages' })).manual[0]!.category,
    ).toBe('SALARIES');
    expect((await ledger.history({ q: 'POS-' })).automated).toHaveLength(1);
    const sale = (await f.db.select().from(sales))[0]!;
    expect(
      (
        await createSalesService(f.db).listSales({
          q: sale.transactionNumber.toLowerCase(),
          source: 'POS',
        })
      ).total,
    ).toBe(1);
    expect(
      (await createSalesService(f.db).listSales({ q: 'NOT-A-TRANSACTION' }))
        .total,
    ).toBe(0);
    const after = await ledger.cashFlow(period);
    expect([after.income, after.expenses, after.endingBalance]).toEqual([
      before.income,
      before.expenses,
      before.endingBalance,
    ]);
  });
  it('secures bulk POSTs with sessions, CSRF, origin, ID validation and ownership; Inventory cannot create master data', async () => {
    const payload = { action: 'deactivate', selected: second.id };
    expect(
      (
        await post('/admin/inventory/bulk', {
          action: 'unknown',
          selected: (await variant(second.id)).id,
          csrf: '',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await post(
          '/admin/inventory/bulk',
          { action: 'unknown', selected: (await variant(second.id)).id },
          'https://untrusted.example',
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/admin/products/bulk',
          payload,
        })
      ).statusCode,
    ).toBe(303);
    expect(
      (await post('/admin/products/bulk', { ...payload, csrf: '' })).statusCode,
    ).toBe(403);
    expect(
      (await post('/admin/products/bulk', payload, 'https://untrusted.example'))
        .statusCode,
    ).toBe(403);
    expect(
      (await post('/admin/products/bulk', { ...payload, selected: 'bad-id' }))
        .statusCode,
    ).toBe(422);
    expect(
      (
        await post('/admin/products/bulk', {
          ...payload,
          selected: [second.id, second.id],
        })
      ).statusCode,
    ).toBe(422);
    const [vendor] = await f.db
      .insert(vendors)
      .values({ name: 'Other fixture', slug: 'other-fixture' })
      .returning();
    const [foreign] = await f.db
      .insert(products)
      .values({
        name: 'Foreign fixture',
        slug: 'foreign',
        vendorId: vendor!.id,
      })
      .returning();
    const foreignResponse = await post('/admin/products/bulk', {
      action: 'archive',
      selected: foreign!.id,
    });
    expect(foreignResponse.statusCode).toBe(200);
    expect(foreignResponse.body).toContain('1 failed');
    expect(
      (
        await f.db.select().from(products).where(eq(products.id, foreign!.id))
      )[0]!.status,
    ).toBe('draft');
    const before = (await f.db.select().from(products)).length;
    const absent = randomUUID();
    const noCreate = await post('/admin/inventory/bulk', {
      action: 'save',
      selected: absent,
      ['stockKnown_' + absent]: 'true',
      ['stockQuantity_' + absent]: '3',
      name: 'Fake product',
      price: '1',
    });
    expect(noCreate.statusCode).toBe(200);
    expect(noCreate.body).toContain('1 failed');
    expect(await f.db.select().from(products)).toHaveLength(before);
    const get = await app.inject({
      url: '/admin/products/bulk',
      headers: { cookie },
    });
    expect(get.statusCode).toBe(404);
  });
  it('renders semantic search, page-specific selection, factual result counts and optional weight editor', async () => {
    for (const path of [
      '/admin/products',
      '/admin/inventory',
      '/admin/finance/fixed-assets',
      '/admin/finance/income-expense',
      '/admin/media',
    ]) {
      const response = await app.inject({ url: path, headers: { cookie } });
      expect(response.statusCode, path).toBe(200);
      expect(response.body).toContain('role="search"');
      expect(response.body).toContain('Clear search');
      expect(response.body).toContain('List pages');
    }
    const editor = await app.inject({
      url: `/admin/products/${second.id}/edit`,
      headers: { cookie },
    });
    expect(editor.body).toContain('Weight (gram)');
    expect(editor.body).toContain('Optional.');
    const result = await post('/admin/products/bulk', {
      action: 'deactivate',
      selected: second.id,
    });
    expect(result.statusCode).toBe(200);
    expect(result.body).toContain('updated');
    expect(result.body).toContain('skipped');
    expect(result.body).toContain('failed');
  });
});
