import { reconcileInitialOwnerImport } from '../src/modules/finance/owner-reconciliation.js';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  investorFixture,
  syntheticOwnerPayload,
} from './helpers/investor-fixture.js';
import {
  importOwnerData,
  parseOwnerPayload,
} from '../src/modules/finance/owner-import.js';
import { createInvestorReports } from '../src/modules/finance/investor-reports.js';
import { createFixedAssets } from '../src/modules/finance/fixed-assets.js';
import { createCatalog } from '../src/modules/catalog/service.js';
import { createSalesService } from '../src/modules/sales/service.js';
import { createCartService } from '../src/modules/cart/service.js';
import { createOrderService } from '../src/modules/orders/service.js';
import { createFulfillment } from '../src/modules/shipping/service.js';
import {
  products,
  productVariants,
  directCosts,
  fixedAssets,
  ownerImports,
  inventoryMovements,
  customers,
  sales,
  saleItems,
  reportingCoverage,
  vendors,
} from '../src/db/schema/index.js';
import { commercialDatabase } from './helpers/commercial-database.js';
import { accountingFixture } from './helpers/accounting-fixture.js';
import { buildApp } from '../src/app.js';
import { readEnv } from '../src/config/env.js';
import type { FastifyInstance } from 'fastify';
let f: Awaited<ReturnType<typeof investorFixture>>;
let app: FastifyInstance;
let cookie = '';
let csrf = '';
const serialize = (value: unknown) =>
  JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
const history = async () =>
  (
    await f.db.execute(
      sql`SELECT jsonb_build_object('sales',(SELECT jsonb_agg(to_jsonb(s)) FROM sales s),'items',(SELECT jsonb_agg(to_jsonb(s)) FROM sale_items s),'payments',(SELECT jsonb_agg(to_jsonb(s)) FROM sale_payments s),'ledger',(SELECT jsonb_agg(to_jsonb(s)) FROM financial_transactions s))::text AS value`,
    )
  ).rows[0]!.value;
beforeAll(async () => {
  f = await investorFixture();
  const [variant] = await f.db
    .select()
    .from(productVariants)
    .where(eq(productVariants.sku, 'LOKKA-DEMO-SHIRT-M'));
  await createSalesService(f.db).completeSale({
    source: 'POS',
    cashierId: f.admin.id,
    items: [{ variantId: variant!.id, quantity: 1 }],
    cashTendered: 495000n,
  });
  app = await buildApp(
    readEnv({
      ...process.env,
      DATABASE_URL: f.url,
      NODE_ENV: 'test',
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
describe('owner import and investor valuation', () => {
  it('localizes authenticated report routes and document titles without changing monetary figures', async () => {
    for (const [path, enTitle, idTitle] of [
      ['assets', 'Asset Register + Valuation', 'Daftar Aset + Valuasi'],
      [
        '12-month-plan',
        '12-Month Plan + Prospective',
        'Rencana 12 Bulan + Prospektif',
      ],
    ]) {
      const get = (query: string) =>
        app.inject({
          url: `/admin/reports/${path}${query}`,
          headers: { cookie },
        });
      const en = await get('?lang=en');
      const id = await get('?lang=id');
      expect(en.statusCode).toBe(200);
      expect(id.statusCode).toBe(200);
      expect(en.body).toContain(`<title>LOKKA — ${enTitle}</title>`);
      expect(id.body).toContain(`<title>LOKKA — ${idTitle}</title>`);
      expect(id.body.match(/Rp[\d.]+/g)).toEqual(en.body.match(/Rp[\d.]+/g));
      for (const query of ['', '?lang=fr', '?lang=ID']) {
        const fallback = await get(query);
        expect(fallback.body).toContain(`<title>LOKKA — ${enTitle}</title>`);
        expect(fallback.body).toContain('<article lang="en"');
      }
      expect(
        (await app.inject(`/admin/reports/${path}?lang=id`)).statusCode,
      ).toBe(303);
    }
  });
  it('validates all 34/20 rows, preserves blank quantities, and rejects changed HPP/duplicate identity', () => {
    const payload = parseOwnerPayload(f.payload);
    expect(payload.products).toHaveLength(34);
    expect(payload.assets).toHaveLength(20);
    expect(payload.products.filter((p) => p.stock === null)).toHaveLength(6);
    const wrong = syntheticOwnerPayload();
    wrong.products[0]!.hpp = '151';
    expect(() => parseOwnerPayload(wrong)).toThrow('HPP');
    const duplicate = syntheticOwnerPayload();
    duplicate.products[1]!.sourceRow = 2;
    expect(() => parseOwnerPayload(duplicate)).toThrow('Source row');
  });
  it('dry runs without writes, then imports canonical costs, units and assets and archives only seed-matched catalog', async () => {
    const before = await history();
    const beforeMoves = await f.db.select().from(inventoryMovements);
    const dry = await importOwnerData(f.db, f.storage, f.payload, f.admin.id);
    expect(dry).toMatchObject({
      dryRun: true,
      created: 54,
      updated: 0,
      skipped: 0,
      incomplete: 6,
    });
    expect(dry.archive).toHaveLength(3);
    expect(await f.db.select().from(ownerImports)).toHaveLength(0);
    const result = await importOwnerData(
      f.db,
      f.storage,
      f.payload,
      f.admin.id,
      true,
    );
    expect(result.created).toBe(54);
    expect(await reconcileInitialOwnerImport(f.db, f.payload)).toMatchObject({
      productsMatched: 34,
      fixedAssetsMatched: 20,
      unknownStock: 6,
      activeDemos: 0,
    });
    expect(await history()).toBe(before);
    const catalog = await f.db.select().from(products);
    expect(catalog.filter((p) => p.status === 'archived')).toHaveLength(3);
    expect(catalog.filter((p) => p.status === 'draft')).toHaveLength(34);
    const variants = await f.db
      .select()
      .from(productVariants)
      .where(sql`${productVariants.sku} LIKE 'LOKKA-SYS-OWNER-%'`);
    expect(variants).toHaveLength(34);
    expect(variants.filter((v) => !v.stockKnown)).toHaveLength(6);
    expect(
      variants.every(
        (v) =>
          v.unit === 'pcs' &&
          v.name === 'Default' &&
          v.weightGrams === 0 &&
          v.status === 'inactive' &&
          v.price === 500n,
      ),
    ).toBe(true);
    for (const variant of variants) {
      expect(variant.stockQuantity).toBe(variant.stockKnown ? 2 : 0);
      const costs = await f.db
        .select()
        .from(directCosts)
        .where(eq(directCosts.productId, variant.productId));
      expect(costs).toHaveLength(2);
      expect(costs.reduce((sum, c) => sum + c.amountRupiah, 0n)).toBe(150n);
      expect(costs.map((c) => c.category).sort()).toEqual([
        'DIRECT_LABOR',
        'DIRECT_MATERIAL',
      ]);
    }
    expect(await f.db.select().from(fixedAssets)).toHaveLength(20);
    const afterMoves = await f.db.select().from(inventoryMovements);
    expect(afterMoves).toHaveLength(beforeMoves.length + 28);
    for (const old of beforeMoves) expect(afterMoves).toContainEqual(old);
    expect(
      afterMoves.filter((m) => m.notes?.startsWith('Owner workbook import')),
    ).toHaveLength(28);
  }, 60000);
  it('recomputes complete and incomplete cohorts without fabricating zero valuations', async () => {
    const report = await createInvestorReports(f.db).report(new Date(), true);
    expect(report.asset).toMatchObject({
      knownUnits: 56n,
      hppValue: 8400n,
      retailValue: 28000n,
      grossSpread: 19600n,
      fixedValue: 40000n,
      combinedValue: 48400n,
      incompleteCount: 6,
      unknownStockCount: 6,
      unknownCostCount: 0,
    });
    expect(
      report.asset.inventory
        .filter((row) => !row.variant.stockKnown)
        .every(
          (row) => row.inventoryValue === null && row.retailValue === null,
        ),
    ).toBe(true);
    expect(report.plan!.accounting).toMatchObject({
      saleCount: 1n,
      revenue: 495000n,
      cogs: null,
      grossProfit: null,
      netProfit: null,
    });
    expect(report.plan!.legacySales).toBe(1n);
    expect(report.plan!.projection).toBeNull();
    expect(report.plan!.cash.endingBalance).toBe(495000n);
  });
  it('skips exact reruns after live edits and refuses changed source without resetting stock', async () => {
    const [variant] = await f.db
      .select()
      .from(productVariants)
      .where(eq(productVariants.sku, 'LOKKA-SYS-OWNER-001'));
    await f.db
      .update(productVariants)
      .set({ stockQuantity: 1, updatedAt: new Date() })
      .where(eq(productVariants.id, variant!.id));
    const before = serialize(await f.db.select().from(inventoryMovements));
    expect(
      await importOwnerData(f.db, f.storage, f.payload, f.admin.id, true),
    ).toMatchObject({ created: 0, updated: 0, skipped: 54 });
    expect(
      (
        await f.db
          .select()
          .from(productVariants)
          .where(eq(productVariants.id, variant!.id))
      )[0]!.stockQuantity,
    ).toBe(1);
    expect(serialize(await f.db.select().from(inventoryMovements))).toBe(
      before,
    );
    const changed = syntheticOwnerPayload();
    changed.products[0]!.price = '501';
    await expect(
      importOwnerData(f.db, f.storage, changed, f.admin.id, true),
    ).rejects.toThrow('reviewed update');
    await f.db
      .update(productVariants)
      .set({ stockQuantity: 2, updatedAt: new Date() })
      .where(eq(productVariants.id, variant!.id));
  });
  it('preserves unknown in legacy edits and permits explicit confirmed zero through catalog stock writes', async () => {
    const catalog = createCatalog(f.db, f.storage);
    const [variant] = await f.db
      .select()
      .from(productVariants)
      .where(eq(productVariants.sku, 'LOKKA-SYS-OWNER-034'));
    await catalog.saveVariant(
      variant!.productId,
      {
        name: 'Default',
        sku: variant!.sku,
        price: '500',
        weightGrams: '0',
        stockQuantity: '0',
        status: 'inactive',
      },
      variant!.id,
    );
    expect(
      (
        await f.db
          .select()
          .from(productVariants)
          .where(eq(productVariants.id, variant!.id))
      )[0]!.stockKnown,
    ).toBe(false);
    await expect(
      catalog.stock(variant!.productId, variant!.id, { stockQuantity: '3' }),
    ).rejects.toThrow('Unspecified');
    await catalog.stock(variant!.productId, variant!.id, {
      stockKnown: 'true',
      stockQuantity: '0',
    });
    expect(
      (
        await f.db
          .select()
          .from(productVariants)
          .where(eq(productVariants.id, variant!.id))
      )[0],
    ).toMatchObject({ stockKnown: true, stockQuantity: 0 });
    await catalog.stock(variant!.productId, variant!.id, {
      stockKnown: 'false',
      stockQuantity: '',
    });
    await expect(
      f.db
        .update(productVariants)
        .set({ stockKnown: false, stockQuantity: 1 })
        .where(eq(productVariants.id, variant!.id)),
    ).rejects.toThrow();
  });
  it('excludes unknown costs from comparable spread, and disposed assets from active totals, with bigint precision', async () => {
    const [variant] = await f.db
      .select()
      .from(productVariants)
      .where(eq(productVariants.sku, 'LOKKA-SYS-OWNER-001'));
    const costs = await f.db
      .select()
      .from(directCosts)
      .where(eq(directCosts.productId, variant!.productId));
    await f.db
      .delete(directCosts)
      .where(eq(directCosts.productId, variant!.productId));
    const report = await createInvestorReports(f.db).report();
    expect(report.asset.hppValue).toBe(8100n);
    expect(report.asset.retailValue).toBe(28000n);
    expect(report.asset.comparativeRetail).toBe(27000n);
    expect(report.asset.grossSpread).toBe(18900n);
    expect(report.asset.unknownCostCount).toBe(1);
    await f.db.insert(directCosts).values(costs);
    const fixed = createFixedAssets(f.db);
    const row = await fixed.save(
      {
        assetName: 'Precision asset',
        quantity: '3',
        unit: 'pcs',
        acquisitionCostPerUnit: '9007199254740993',
        status: 'ACTIVE',
      },
      f.admin.id,
    );
    expect((await createInvestorReports(f.db).report()).asset.fixedValue).toBe(
      40000n + 27021597764222979n,
    );
    await fixed.save(
      {
        assetName: row.assetName,
        quantity: '3',
        unit: 'pcs',
        acquisitionCostPerUnit: '9007199254740993',
        status: 'DISPOSED',
      },
      f.admin.id,
      row.id,
    );
    const disposed = await createInvestorReports(f.db).report();
    expect(disposed.asset.fixedValue).toBe(40000n);
    expect(disposed.asset.fixed.find((r) => r.id === row.id)!.total).toBe(
      27021597764222979n,
    );
  });
  it('refuses archive when a seed identity has been changed, even on a dry run', async () => {
    const [demo] = await f.db
      .select()
      .from(products)
      .where(eq(products.slug, 'lokka-demo-shirt'));
    await f.db
      .update(products)
      .set({
        description: 'Owner replaced this description',
        updatedAt: new Date(),
      })
      .where(eq(products.id, demo!.id));
    await expect(
      importOwnerData(f.db, f.storage, f.payload, f.admin.id),
    ).rejects.toThrow('Seed identity changed');
    await f.db
      .update(products)
      .set({ description: demo!.description, updatedAt: new Date() })
      .where(eq(products.id, demo!.id));
  });
  it('renders protected view-only reports and validates fixed asset mutations under existing session/CSRF protections', async () => {
    for (const path of [
      '/admin/reports/assets',
      '/admin/reports/12-month-plan',
      '/admin/finance/fixed-assets',
    ]) {
      expect((await app.inject(path)).statusCode).toBe(303);
      const page = await app.inject({ url: path, headers: { cookie } });
      expect(page.statusCode).toBe(200);
      expect(page.headers['cache-control']).toContain('no-store');
      expect(page.headers['x-robots-tag']).toContain('noindex');
      if (path.includes('/reports/')) {
        expect(page.body).toContain('data-print-report');
        expect(page.body).toContain('/images/brand/lokka-logo.webp');
        expect(
          page.body.match(/<article[\s\S]*?<\/article>/)?.[0],
        ).not.toContain('<form');
      }
    }
    const inventory = await app.inject({
      url: '/admin/inventory',
      headers: { cookie },
    });
    expect(inventory.body).toContain('Unspecified quantity');
    expect(inventory.body).toContain('Belum diisi');
    const post = (payload: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: '/admin/finance/fixed-assets',
        headers: { cookie, origin: 'http://127.0.0.1:3000' },
        payload,
      });
    expect((await post({ assetName: 'Unauthorized' })).statusCode).toBe(403);
    expect(
      (
        await post({
          csrf,
          assetName: 'Bad input',
          quantity: '1',
          unit: 'pcs',
          acquisitionCostPerUnit: '1.5',
          status: 'ACTIVE',
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await post({
          csrf,
          assetName: 'Controlled route asset',
          quantity: '2',
          unit: 'pcs',
          acquisitionCostPerUnit: '100',
          status: 'ACTIVE',
        })
      ).statusCode,
    ).toBe(303);
    const [otherVendor] = await f.db
      .insert(vendors)
      .values({
        name: 'Synthetic ownership boundary',
        slug: 'boundary',
        status: 'active',
      })
      .returning();
    const [foreign] = await f.db
      .insert(fixedAssets)
      .values({
        vendorId: otherVendor!.id,
        assetName: 'Foreign',
        quantity: 1,
        unit: 'pcs',
        acquisitionCostPerUnit: 1n,
        createdBy: f.admin.id,
      })
      .returning();
    await expect(createFixedAssets(f.db).get(foreign!.id)).rejects.toThrow(
      'not found',
    );
  });
});
it('blocks unknown stock in POS, cart, checkout and fulfillment, while preserving existing cart removal', async () => {
  const a = await accountingFixture();
  try {
    const [customer] = await a.db
      .insert(customers)
      .values({
        email: 'stock@example.test',
        emailNormalized: 'stock@example.test',
        name: 'Stock fixture',
        passwordHash: 'unused',
      })
      .returning();
    const cart = createCartService(a.db);
    await cart.mutate(customer!.id, 'add', a.variant.id, 1);
    const prior = await cart.get(customer!.id);
    await a.db
      .update(productVariants)
      .set({ stockKnown: false, stockQuantity: 0, updatedAt: new Date() })
      .where(eq(productVariants.id, a.variant.id));
    const before = serialize(await a.db.select().from(sales));
    await expect(a.sell()).rejects.toThrow('unspecified');
    await expect(
      cart.mutate(customer!.id, 'add', a.variant.id, 1),
    ).rejects.toThrow();
    await expect(
      createOrderService(a.db).create(customer!.id, prior.cart!.revision),
    ).rejects.toThrow();
    expect((await cart.get(customer!.id)).canOrder).toBe(false);
    await expect(
      createFulfillment(a.db, createCatalog(a.db, f.storage)).resolve(
        a.product.id,
        a.variant.id,
        1,
      ),
    ).rejects.toThrow('not ready');
    expect(serialize(await a.db.select().from(sales))).toBe(before);
    const pos = await createSalesService(a.db).searchProducts();
    expect(pos[0]!.variants[0]!.stockKnown).toBe(false);
    await cart.mutate(customer!.id, 'remove', prior.items[0]!.item.id);
    expect((await cart.get(customer!.id)).items).toHaveLength(0);
  } finally {
    await a.cleanup();
  }
}, 60000);
it('requires documented complete months, 30 days and full HPP before any financial run rate', async () => {
  const a = await accountingFixture();
  try {
    const sale = await a.sell();
    const asOf = new Date('2026-04-10T12:00:00Z');
    await a.db
      .update(sales)
      .set({
        createdAt: new Date('2026-03-10T12:00:00Z'),
        updatedAt: new Date(),
      })
      .where(eq(sales.id, sale.saleId));
    const reports = createInvestorReports(a.db);
    expect((await reports.report(asOf, true)).plan!.projection).toBeNull();
    const [vendor] = await a.db
      .select()
      .from(vendors)
      .where(eq(vendors.slug, 'lokka'));
    const [coverage] = await a.db
      .insert(reportingCoverage)
      .values({
        vendorId: vendor!.id,
        month: '2026-03-01',
        salesComplete: true,
        expensesComplete: false,
        evidence: 'Synthetic full month reconciliation',
        confirmedBy: a.admin.id,
      })
      .returning();
    const run = (await reports.report(asOf, true)).plan!.projection!;
    expect(run).toMatchObject({
      months: 1,
      days: 31,
      revenue: 9540000n,
      cogs: 3600000n,
      grossProfit: 5940000n,
      expenses: null,
      netProfit: null,
    });
    await a.db
      .update(reportingCoverage)
      .set({ expensesComplete: true, updatedAt: new Date() })
      .where(eq(reportingCoverage.id, coverage!.id));
    expect((await reports.report(asOf, true)).plan!.projection!.netProfit).toBe(
      5940000n,
    );
    await a.db
      .update(saleItems)
      .set({ costSnapshot: null })
      .where(eq(saleItems.saleId, sale.saleId));
    expect((await reports.report(asOf, true)).plan!.projection).toBeNull();
    await a.db
      .update(saleItems)
      .set({ costSnapshot: 300000n })
      .where(eq(saleItems.saleId, sale.saleId));
    await a.db
      .update(reportingCoverage)
      .set({ month: '2026-02-01', updatedAt: new Date() })
      .where(eq(reportingCoverage.id, coverage!.id));
    expect(
      (await reports.report(new Date('2026-03-10T00:00:00Z'), true)).plan!
        .projection,
    ).toBeNull();
    await a.db.delete(saleItems).where(eq(saleItems.saleId, sale.saleId));
    await a.db
      .update(reportingCoverage)
      .set({ month: '2026-03-01', updatedAt: new Date() })
      .where(eq(reportingCoverage.id, coverage!.id));
    expect((await reports.report(asOf, true)).plan!.projection).toBeNull();
  } finally {
    await a.cleanup();
  }
}, 60000);
it('migrates pre-existing stock without rewriting quantities or timestamps', async () => {
  const fixture = await commercialDatabase();
  try {
    // Replay only the additive stock part against an existing legacy-shaped variant.
    await fixture.database.db.execute(
      sql`ALTER TABLE product_variants DROP CONSTRAINT variants_unknown_stock_placeholder; ALTER TABLE product_variants DROP COLUMN stock_known`,
    );
    const [vendor] = await fixture.database.db
      .insert(vendors)
      .values({ slug: 'lokka', name: 'LOKKA' })
      .returning();
    const [product] = await fixture.database.db
      .insert(products)
      .values({ vendorId: vendor!.id, slug: 'legacy', name: 'Legacy' })
      .returning();
    await fixture.database.db.execute(
      sql`INSERT INTO product_variants (product_id,sku,name,price,weight_grams,stock_quantity,created_at,updated_at) VALUES (${product!.id},'OLD','Default',100,0,7,'2025-01-01T00:00:00Z','2025-01-02T00:00:00Z')`,
    );
    const migration = await import('node:fs/promises').then((fs) =>
      fs.readFile('drizzle/0011_investor_reporting.sql', 'utf8'),
    );
    // Unit metadata already exists in this fixture; exercise the actual stock DDL statements.
    const steps = migration.split('--> statement-breakpoint');
    await fixture.database.db.execute(sql.raw(steps[0]!));
    await fixture.database.db.execute(sql.raw(steps[2]!));
    const [variant] = await fixture.database.db.select().from(productVariants);
    expect(variant).toMatchObject({
      stockKnown: true,
      stockQuantity: 7,
      updatedAt: new Date('2025-01-02T00:00:00Z'),
    });
  } finally {
    await fixture.cleanup();
  }
}, 60000);
