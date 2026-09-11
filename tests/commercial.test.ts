import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { commercialDatabase } from './helpers/commercial-database.js';
import { createCatalog } from '../src/modules/catalog/service.js';
import { LocalCatalogImageStorage } from '../src/modules/catalog/storage.js';
import { createFinance } from '../src/modules/finance/service.js';
import { createFulfillment } from '../src/modules/shipping/service.js';
import {
  vendors,
  overheadPeriods,
  overheadItems,
  recoveryEntries,
  productVariants,
  adminUsers,
} from '../src/db/schema/index.js';
import { buildApp } from '../src/app.js';
import { readEnv } from '../src/config/env.js';
import { hashPassword } from '../src/modules/auth/service.js';
import type { FastifyInstance } from 'fastify';
let fixture: Awaited<ReturnType<typeof commercialDatabase>>;
let catalog: ReturnType<typeof createCatalog>;
let finance: ReturnType<typeof createFinance>;
let fulfillment: ReturnType<typeof createFulfillment>;
let app: FastifyInstance;
let cookie = '',
  csrf = '',
  userId = '';
let productId = '',
  productB = '',
  variantId = '',
  september = '',
  october = '',
  vpsId = '';
const productForm = {
  name: 'Commercial verification',
  slug: 'commercial-verification',
  status: 'draft',
};
const variantForm = {
  name: 'M',
  sku: 'VERIFY-M',
  price: '695000',
  compareAtPrice: '795000',
  stockQuantity: '8',
  weightGrams: '450',
  status: 'active',
  sortOrder: '0',
};
const overheadForm = {
  name: 'VPS',
  category: 'INFRASTRUCTURE',
  amountRupiah: '300000',
  billingFrequency: 'MONTHLY',
  recognitionMethod: 'SPREAD_MONTHLY',
  startDate: '2026-09-01',
  active: 'on',
};
const post = (url: string, payload: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url,
    headers: { cookie, origin: 'http://127.0.0.1:3000' },
    payload: { csrf, ...payload },
  });
async function close(periodId: string) {
  const { current } = await finance.dashboard(periodId);
  return finance.changePeriod(periodId, 'close', {
    confirm: 'close',
    expectedTarget: current!.target.toString(),
    expectedRecovered: current!.recovered.toString(),
  });
}
beforeAll(async () => {
  fixture = await commercialDatabase();
  await fixture.database.db
    .insert(vendors)
    .values({ slug: 'lokka', name: 'LOKKA', status: 'active' });
  catalog = createCatalog(
    fixture.database.db,
    new LocalCatalogImageStorage('storage/tests/commercial'),
  );
  finance = createFinance(fixture.database.db, catalog);
  fulfillment = createFulfillment(fixture.database.db, catalog);
  app = await buildApp(
    readEnv({
      ...process.env,
      DATABASE_URL: fixture.url,
      NODE_ENV: 'test',
      APP_URL: 'http://127.0.0.1:3000',
    }),
    { database: { ...fixture.database, close: async () => {} }, logger: false },
  );
  const [user] = await fixture.database.db
    .insert(adminUsers)
    .values({
      email: 'commercial@example.test',
      name: 'Verification admin',
      passwordHash: await hashPassword('temporary-verification-password'),
    })
    .returning();
  userId = user!.id;
  const login = await app.inject('/admin/login');
  const loginCsrf = login.cookies[0]!.value;
  const response = await app.inject({
    method: 'POST',
    url: '/admin/login',
    cookies: { lokka_login_csrf: loginCsrf },
    payload: {
      csrf: loginCsrf,
      email: 'commercial@example.test',
      password: 'temporary-verification-password',
    },
  });
  expect(response.statusCode).toBe(303);
  cookie = response.cookies
    .filter((c) => c.value)
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  csrf = response.cookies.find((c) => c.name === 'lokka_admin_csrf')!.value;
}, 30000);
afterAll(async () => {
  await app?.close();
  await fixture?.cleanup();
}, 30000);
describe('commercial workflows on migrated PostgreSQL', () => {
  it('requires a usable active variant before publication; inactive drafts may omit money and weight', async () => {
    await expect(
      catalog.saveProduct({ ...productForm, status: 'active' }),
    ).rejects.toThrow('usable active variant');
    productId = (await catalog.saveProduct(productForm)).id;
    productB = (
      await catalog.saveProduct({
        ...productForm,
        name: 'Product B',
        slug: 'product-b',
      })
    ).id;
    const draft = await catalog.saveVariant(productId, {
      ...variantForm,
      status: 'inactive',
      price: '',
      weightGrams: '',
    });
    variantId = draft.id;
    expect(draft.weightGrams).toBe(0);
    await expect(
      catalog.saveProduct({ ...productForm, status: 'active' }, productId),
    ).rejects.toThrow();
    await catalog.saveVariant(productId, variantForm, variantId);
    await catalog.saveProduct({ ...productForm, status: 'active' }, productId);
    await expect(
      catalog.saveVariant(
        productId,
        { ...variantForm, status: 'inactive' },
        variantId,
      ),
    ).rejects.toThrow('retain');
    for (const locale of ['en', 'id'])
      await catalog.saveProductTranslation(productId, locale, {
        name: productForm.name,
        slug: productForm.slug,
      });
  });
  it('creates monthly/annual masters and snapshots September exactly once', async () => {
    vpsId = (await finance.saveOverhead(overheadForm)).id;
    await finance.saveOverhead({
      ...overheadForm,
      name: 'Domain',
      amountRupiah: '240000',
      billingFrequency: 'ANNUAL',
    });
    await finance.saveOverhead({
      ...overheadForm,
      name: 'Software',
      amountRupiah: '150000',
      category: 'SOFTWARE',
    });
    september = (
      await finance.openPeriod({
        periodMonth: '2026-09',
        forecastUnitsRemaining: '100',
      })
    ).id;
    const { current } = await finance.dashboard();
    expect(current).toMatchObject({
      current: 470000n,
      target: 470000n,
      perUnit: 4700n,
      recovered: 0n,
    });
    expect(current!.items).toHaveLength(3);
    await expect(
      finance.openPeriod({
        periodMonth: '2026-10',
        forecastUnitsRemaining: '100',
      }),
    ).rejects.toThrow();
  });
  it('applies target additions/credits, validates forecasts and allocates with ceiling', async () => {
    await finance.changePeriod(september, 'adjustment', {
      amountRupiah: '75001',
      notes: 'Documented opening transition adjustment',
    });
    expect((await finance.dashboard()).current!.perUnit).toBe(5451n);
    await finance.changePeriod(september, 'adjustment', {
      amountRupiah: '-1',
      notes: 'Correction',
    });
    await expect(
      finance.changePeriod(september, 'forecast', {
        forecastUnitsRemaining: '0',
      }),
    ).rejects.toThrow();
    await finance.changePeriod(september, 'forecast', {
      forecastUnitsRemaining: '200',
    });
    expect((await finance.dashboard()).current).toMatchObject({
      target: 545000n,
      perUnit: 2725n,
      recovered: 0n,
    });
    await finance.changePeriod(september, 'forecast', {
      forecastUnitsRemaining: '100',
    });
  });
  it('uses global burden once for both products without copying VPS rows or recovering money', async () => {
    for (const [name, category, amountRupiah] of [
      ['Kain', 'DIRECT_MATERIAL', '120000'],
      ['Jahit', 'DIRECT_LABOR', '70000'],
      ['Packaging', 'PACKAGING', '15000'],
    ])
      await finance.saveProductCost(productId, {
        name,
        category,
        amountRupiah,
      });
    await finance.saveProductCost(productB, {
      name: 'Materials B',
      category: 'DIRECT_MATERIAL',
      amountRupiah: '350000',
    });
    await finance.saveProfile(productId, {
      method: 'TARGET_MARGIN',
      profitPercent: '50',
      taxPercent: '0.50',
      roundingRupiah: '1000',
    });
    const a = await finance.analysis(productId),
      b = await finance.analysis(productB);
    expect(a.direct).toBe(205000n);
    expect(a.full).toBe(210450n);
    expect(b.full).toBe(355450n);
    expect(a.costs.map((c) => c.name)).not.toContain('VPS');
    expect(b.costs).toHaveLength(1);
    expect(a.recommended).toBe(426000n);
    expect(a.variants[0]).toMatchObject({
      price: 695000n,
      reserve: 3475n,
      profit: 481075n,
    });
    expect((await finance.dashboard()).current!.recovered).toBe(0n);
    await expect(
      finance.saveProfile(productId, {
        method: 'TARGET_MARGIN',
        profitPercent: '99.5',
        taxPercent: '0.50',
        roundingRupiah: '1000',
      }),
    ).rejects.toThrow();
    expect((await finance.analysis(productId)).profile.profitBps).toBe(5000);
    const c = a.costs[0]!;
    await expect(
      finance.saveProductCost(
        productB,
        { name: 'Wrong owner', category: 'OTHER', amountRupiah: '1' },
        c.id,
      ),
    ).rejects.toThrow();
    await expect(finance.deleteProductCost(productB, c.id)).rejects.toThrow();
  });
  it('keeps public prices/JSON-LD localized and internal economics private', async () => {
    for (const [path, amount] of [
      ['/product/commercial-verification', 'Rp695,000'],
      ['/id/produk/commercial-verification', 'Rp695.000'],
    ]) {
      const r = await app.inject(path!);
      expect(r.statusCode).toBe(200);
      expect(r.body).toContain(amount);
      expect(r.body).toContain('"price":"695000"');
      for (const secret of [
        'Kain',
        'Jahit',
        'VPS',
        '210450',
        '481075',
        'taxBps',
        'profitBps',
        'Recommended selling price',
      ])
        expect(r.body).not.toContain(secret);
    }
    expect((await app.inject('/collections')).body).not.toContain(
      'From Rp695,000',
    );
    await catalog.saveVariant(productId, {
      ...variantForm,
      name: 'L',
      sku: 'VERIFY-L',
      price: '725000',
      compareAtPrice: '',
      stockQuantity: '0',
      sortOrder: '1',
    });
    expect((await app.inject('/collections')).body).toContain('From Rp695,000');
    expect((await app.inject('/id/koleksi')).body).toContain('Mulai Rp695.000');
    await expect(
      fixture.database.db
        .update(productVariants)
        .set({ compareAtPrice: 695000n })
        .where(eq(productVariants.id, variantId)),
    ).rejects.toThrow();
  });
  it('renders new admin pages with session and CSRF protections and retains failed input', async () => {
    for (const path of [
      '/admin/finance/overhead',
      `/admin/products/${productId}/pricing`,
      '/admin/settings/fulfillment',
    ]) {
      expect((await app.inject(path)).statusCode).toBe(303);
      const r = await app.inject({ url: path, headers: { cookie } });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.headers['x-robots-tag']).toContain('noindex');
      expect(r.headers['cache-control']).toContain('no-store');
    }
    for (const url of [
      '/admin/finance/overhead/costs',
      `/admin/products/${productId}/pricing`,
      '/admin/settings/fulfillment',
    ])
      expect((await post(url, { csrf: 'bad' })).statusCode).toBe(403);
    const failed = await post('/admin/finance/overhead/costs', {
      ...overheadForm,
      name: 'Keep failed input',
      amountRupiah: '1.2',
    });
    expect(failed.statusCode, failed.body).toBe(422);
    expect(failed.body).toContain('Keep failed input');
    expect(
      (
        await post(`/admin/finance/overhead/periods/${september}/recovery`, {
          amountRupiah: '1',
          notes: '',
        })
      ).statusCode,
    ).toBe(422);
    await fixture.database.db
      .update(adminUsers)
      .set({ status: 'disabled', updatedAt: new Date() })
      .where(eq(adminUsers.id, userId));
    expect(
      (
        await post(`/admin/finance/overhead/periods/${september}/forecast`, {
          forecastUnitsRemaining: '99',
        })
      ).statusCode,
    ).toBe(303);
    expect(
      (await finance.dashboard()).current!.period.forecastUnitsRemaining,
    ).toBe(100);
    await fixture.database.db
      .update(adminUsers)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(adminUsers.id, userId));
  });
  it('appends recovery and reversal entries and rejects over-recovery', async () => {
    await finance.changePeriod(september, 'recovery', {
      amountRupiah: '400001',
      notes: 'Verified offline commercial activity',
      reference: 'manual-001',
    });
    await finance.changePeriod(september, 'recovery', {
      amountRupiah: '-1',
      notes: 'Correct previous entry',
    });
    expect((await finance.dashboard()).current).toMatchObject({
      recovered: 400000n,
      remaining: 145000n,
      perUnit: 1450n,
    });
    await expect(
      finance.changePeriod(september, 'recovery', {
        amountRupiah: '145001',
        notes: 'Over target',
      }),
    ).rejects.toThrow();
    await expect(
      finance.changePeriod(september, 'recovery', {
        amountRupiah: '-400001',
        notes: 'Below zero',
      }),
    ).rejects.toThrow();
    await expect(
      finance.changePeriod(september, 'adjustment', {
        amountRupiah: '-145001',
        notes: 'Below recovered',
      }),
    ).rejects.toThrow();
    expect((await finance.dashboard()).current!.entries).toHaveLength(2);
  });
  it('master edit affects future periods, never existing snapshots', async () => {
    await finance.saveOverhead(
      { ...overheadForm, amountRupiah: '350000' },
      vpsId,
    );
    expect((await finance.dashboard()).current!.current).toBe(470000n);
  });
  it('requires explicit current totals before close and prevents concurrent duplicate close', async () => {
    await expect(
      finance.changePeriod(september, 'close', {
        confirm: 'close',
        expectedTarget: '1',
        expectedRecovered: '400000',
      }),
    ).rejects.toThrow();
    const results = await Promise.allSettled([
      close(september),
      close(september),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await finance.dashboard()).current!.period).toMatchObject({
      status: 'CLOSED',
      closingUnrecoveredRupiah: 145000n,
    });
    for (const action of ['forecast', 'recovery', 'adjustment'] as const)
      await expect(finance.changePeriod(september, action, {})).rejects.toThrow(
        'not open',
      );
  });
  it('opens next month with remainder once under concurrency', async () => {
    const results = await Promise.allSettled([
      finance.openPeriod({
        periodMonth: '2026-10',
        forecastUnitsRemaining: '100',
      }),
      finance.openPeriod({
        periodMonth: '2026-10',
        forecastUnitsRemaining: '100',
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const { current } = await finance.dashboard();
    october = current!.period.id;
    expect(current).toMatchObject({
      opening: 145000n,
      current: 520000n,
      target: 665000n,
      recovered: 0n,
    });
    expect((await finance.dashboard(september)).current!.target).toBe(545000n);
  });
  it('caps concurrent recovery at outstanding target and carries zero after full recovery', async () => {
    const results = await Promise.allSettled([
      finance.changePeriod(october, 'recovery', {
        amountRupiah: '665000',
        notes: 'Full recovery',
      }),
      finance.changePeriod(october, 'recovery', {
        amountRupiah: '665000',
        notes: 'Duplicate amount',
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await close(october);
    const p = await finance.openPeriod({
      periodMonth: '2026-11',
      forecastUnitsRemaining: '100',
    });
    expect(p.openingCarryForwardRupiah).toBe(0n);
    await close(p.id);
  });
  it('skips months without duplicating deficits or recognizing missed costs', async () => {
    const p = await finance.openPeriod({
      periodMonth: '2027-02',
      forecastUnitsRemaining: '100',
    });
    expect(p.openingCarryForwardRupiah).toBe(520000n);
    expect((await finance.dashboard()).current).toMatchObject({
      current: 520000n,
      target: 1040000n,
    });
    expect(
      await fixture.database.db.select().from(overheadPeriods),
    ).toHaveLength(4);
    expect(await fixture.database.db.select().from(overheadItems)).toHaveLength(
      14,
    );
    expect(
      await fixture.database.db.select().from(recoveryEntries),
    ).toHaveLength(3);
  });
  it('creates/updates default origins and resolves shipping-ready data with real prices', async () => {
    await expect(fulfillment.resolve(productId, variantId, 1)).rejects.toThrow(
      'not configured',
    );
    const form = {
      name: 'Temporary test origin',
      contactName: 'Test contact',
      phone: '+62000000000',
      addressLine1: 'Test fixture only',
      district: 'Test district',
      city: 'Test city',
      province: 'Test province',
      postalCode: '00000',
      countryCode: 'ID',
      status: 'active',
      isDefault: 'on',
    };
    const first = await fulfillment.save(form);
    const second = await fulfillment.save({
      ...form,
      name: 'Second test origin',
    });
    expect(
      (await fulfillment.list()).filter((o) => o.isDefault).map((o) => o.id),
    ).toEqual([second.id]);
    await fulfillment.save({ ...form, name: 'Updated test origin' }, first.id);
    const resolved = await fulfillment.resolve(productId, variantId, 2);
    expect(resolved).toMatchObject({
      productId,
      variantId,
      sku: 'VERIFY-M',
      quantity: 2,
      priceRupiah: '695000',
      weightGrams: 450,
      availableStock: 8,
      fulfillmentOrigin: { id: first.id, name: 'Updated test origin' },
    });
    await expect(
      fulfillment.resolve(productId, variantId, 9),
    ).rejects.toThrow();
    await expect(
      fulfillment.resolve(productId, variantId, 1.5),
    ).rejects.toThrow();
    await expect(fulfillment.resolve(productB, variantId, 1)).rejects.toThrow();
    await expect(
      fulfillment.save({ ...form, latitude: '91', longitude: '0' }),
    ).rejects.toThrow();
    await expect(
      fulfillment.save({ ...form, status: 'inactive' }),
    ).rejects.toThrow();
  });
});
