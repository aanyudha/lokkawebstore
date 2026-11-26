import { test, expect } from '@playwright/test';
import { commercialDatabase } from '../helpers/commercial-database.js';
import { createCatalog } from '../../src/modules/catalog/service.js';
import { createFinance } from '../../src/modules/finance/service.js';
import { LocalCatalogImageStorage } from '../../src/modules/catalog/storage.js';
import { vendors, adminUsers } from '../../src/db/schema/index.js';
import { hashPassword } from '../../src/modules/auth/service.js';
import { buildApp } from '../../src/app.js';
import { readEnv } from '../../src/config/env.js';

test('commercial admin workflows and responsive visual review', async ({
  page,
  browser,
}) => {
  const fixture = await commercialDatabase();
  const db = fixture.database.db;
  const catalog = createCatalog(
    db,
    new LocalCatalogImageStorage('storage/browser/commercial'),
  );
  const finance = createFinance(db, catalog);
  await db
    .insert(vendors)
    .values({ slug: 'lokka', name: 'LOKKA', status: 'active' });
  await db.insert(adminUsers).values({
    email: 'browser@example.test',
    name: 'Commercial browser verification',
    passwordHash: await hashPassword('temporary-browser-password'),
  });
  const product = await catalog.saveProduct({
    name: 'Commercial browser product',
    slug: 'commercial-browser',
    status: 'draft',
  });
  await catalog.saveVariant(product.id, {
    name: 'M',
    sku: 'BROWSER-M',
    price: '695000',
    compareAtPrice: '795000',
    weightGrams: '450',
    stockQuantity: '8',
    status: 'active',
  });
  await catalog.saveVariant(product.id, {
    name: 'L',
    sku: 'BROWSER-L',
    price: '725000',
    weightGrams: '450',
    stockQuantity: '0',
    status: 'active',
    sortOrder: '1',
  });
  await catalog.saveProduct(
    { name: product.name, slug: product.slug, status: 'active' },
    product.id,
  );
  for (const locale of ['en', 'id'])
    await catalog.saveProductTranslation(product.id, locale, {
      name: product.name,
      slug: product.slug,
    });
  await finance.saveOverhead({
    name: 'VPS',
    category: 'INFRASTRUCTURE',
    amountRupiah: '300000',
    billingFrequency: 'MONTHLY',
    recognitionMethod: 'SPREAD_MONTHLY',
    startDate: '2026-09-01',
    active: 'on',
  });
  await finance.saveOverhead({
    name: 'Domain',
    category: 'INFRASTRUCTURE',
    amountRupiah: '240000',
    billingFrequency: 'ANNUAL',
    recognitionMethod: 'SPREAD_MONTHLY',
    startDate: '2026-09-01',
    active: 'on',
  });
  const period = await finance.openPeriod({
    periodMonth: '2026-09',
    forecastUnitsRemaining: '100',
  });
  for (const [name, category, amountRupiah] of [
    ['Kain', 'DIRECT_MATERIAL', '120000'],
    ['Jahit', 'DIRECT_LABOR', '70000'],
    ['Packaging', 'PACKAGING', '15000'],
  ])
    await finance.saveProductCost(product.id, { name, category, amountRupiah });
  await finance.saveProfile(product.id, {
    method: 'TARGET_MARGIN',
    profitPercent: '50',
    taxPercent: '0.50',
    roundingRupiah: '1000',
  });
  const env = readEnv({
    ...process.env,
    DATABASE_URL: fixture.url,
    NODE_ENV: 'test',
    PORT: '3011',
    APP_URL: 'http://127.0.0.1:3011',
  });
  const app = await buildApp(env, {
    database: { ...fixture.database, close: async () => {} },
    logger: false,
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await app.listen({ host: '127.0.0.1', port: 3011 });
    // Explicit no-JavaScript SSR check, including initial comparison and stock.
    const noJs = await browser.newContext({ javaScriptEnabled: false });
    const ssr = await noJs.newPage();
    await ssr.goto(`${env.appUrl}/product/${product.slug}`);
    await expect(ssr.locator('[data-variant-price]')).toHaveText('Rp695,000');
    await expect(ssr.locator('[data-variant-compare]')).toHaveText('Rp795,000');
    await expect(ssr.locator('[data-variant-info]')).toContainText('In stock');
    await noJs.close();
    for (const [path, price, stock] of [
      [`/product/${product.slug}`, 'Rp725,000', 'Out of stock'],
      [`/id/produk/${product.slug}`, 'Rp725.000', 'Stok habis'],
    ]) {
      await page.goto(`${env.appUrl}${path}`);
      await page
        .locator('.variant-picker')
        .getByText('L', { exact: true })
        .click();
      await expect(page.locator('[data-variant-price]')).toHaveText(price!);
      await expect(page.locator('[data-variant-compare]')).toBeHidden();
      // Locale resource supplies availability; English assertion verifies changed stock.
      if (path!.startsWith('/product'))
        await expect(page.locator('[data-variant-info]')).toContainText(stock!);
      await page
        .locator('.variant-picker')
        .getByText('M', { exact: true })
        .click();
      await expect(page.locator('[data-variant-compare]')).toBeVisible();
    }
    await page.goto(`${env.appUrl}/admin/login`);
    await page
      .getByLabel('Email', { exact: true })
      .fill('browser@example.test');
    await page
      .getByLabel('Password', { exact: true })
      .fill('temporary-browser-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(`${env.appUrl}/admin`);
    await page.goto(`${env.appUrl}/admin/settings/fulfillment`);
    const availability = page.getByRole('region', {
      name: 'Checkout shipping availability',
    });
    await expect(
      availability.getByText('No active default origin', { exact: true }),
    ).toBeVisible();
    await expect(availability.getByRole('status')).toContainText(
      'Checkout has no shipping options',
    );
    for (const [label, value] of [
      ['Origin name', 'Browser test origin'],
      ['Contact name', 'Test contact'],
      ['Phone', '+62000000000'],
      ['Address line 1', 'Test fixture address'],
      ['District', 'Test district'],
      ['City', 'Test city'],
      ['Province', 'Test province'],
      ['Postal code', '00000'],
    ])
      await page.getByLabel(label!, { exact: true }).fill(value!);
    await page.getByRole('button', { name: 'Save fulfillment origin' }).click();
    await expect(
      page.getByText('Browser test origin · Default', { exact: true }),
    ).toBeVisible();
    const shipping = page.getByRole('region', {
      name: 'Checkout shipping methods',
    });
    await shipping.getByLabel('Method code', { exact: true }).fill('LOCAL');
    await shipping
      .getByLabel('Method name', { exact: true })
      .fill('Local delivery');
    await shipping.getByLabel('Flat rate (Rp)', { exact: true }).fill('25000');
    await shipping
      .getByRole('button', { name: 'Save shipping method', exact: true })
      .click();
    await expect(
      shipping.getByText('Local delivery · LOCAL', { exact: true }),
    ).toBeVisible();
    await page.goto(`${env.appUrl}/admin/finance/overhead`);
    const recovery = page.locator(`form[action$="/${period.id}/recovery"]`);
    await recovery.getByLabel('Amount (whole Rupiah; signed)').fill('100000');
    await recovery
      .getByLabel('Required note / reason')
      .fill('Verified offline sales recovery for browser fixture');
    await recovery.getByRole('button').click();
    expect((await finance.dashboard()).current!.recovered).toBe(100000n);
    for (const width of [1440, 1024, 768, 430, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const [name, path] of [
        ['commercial-overhead', '/admin/finance/overhead'],
        ['commercial-pricing', `/admin/products/${product.id}/pricing`],
        ['commercial-fulfillment', '/admin/settings/fulfillment'],
        ['commercial-variants', `/admin/products/${product.id}/edit`],
      ]) {
        const response = await page.goto(`${env.appUrl}${path}`);
        expect(response?.status()).toBe(200);
        await expect(page.locator('main h1')).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: `test-results/${name}-${width}.png`,
          fullPage: true,
        });
      }
    }
    await page.goto(`${env.appUrl}/admin/finance/overhead`);
    const closing = page.locator(`form[action$="/${period.id}/close"]`);
    await closing.getByRole('checkbox').check();
    await closing
      .getByRole('button', { name: 'Close period', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'September 2026 · CLOSED' }),
    ).toBeVisible();
    await page.getByLabel('Period month', { exact: true }).fill('2026-10');
    await page
      .getByLabel('Forecast units remaining', { exact: true })
      .fill('100');
    await page
      .getByRole('button', { name: 'Open period and snapshot costs' })
      .click();
    await expect(
      page.getByRole('heading', { name: 'October 2026 · OPEN' }),
    ).toBeVisible();
    expect((await finance.dashboard()).current!.opening).toBe(220000n);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});
