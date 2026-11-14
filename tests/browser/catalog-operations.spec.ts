import { test, expect } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { investorFixture } from '../helpers/investor-fixture.js';
import { importOwnerData } from '../../src/modules/finance/owner-import.js';
import { createLedger } from '../../src/modules/finance/ledger.js';
import { products, productVariants } from '../../src/db/schema/index.js';
import { buildApp } from '../../src/app.js';
import { readEnv } from '../../src/config/env.js';

test('catalog bulk operations keep no-weight POS selling separate from Webstore readiness', async ({
  page,
}) => {
  test.setTimeout(120000);
  const f = await investorFixture();
  expect(new URL(f.url).pathname).toMatch(/^\/lokka_verify_/);
  expect(f.url).not.toBe(process.env.LOKKA_BROWSER_DATABASE_SOURCE);
  await importOwnerData(f.db, f.storage, f.payload, f.admin.id, true);
  await createLedger(f.db).recordManual(
    {
      direction: 'INCOME',
      category: 'OTHER_INCOME',
      amountRupiah: '25',
      occurredAt: new Date().toISOString().slice(0, 16),
      notes: 'Operations search fixture',
    },
    f.admin.id,
  );
  const [product] = await f.db
    .select()
    .from(products)
    .where(eq(products.slug, 'synthetic-inventory-1-owner-1'));
  const [variant] = await f.db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, product!.id));
  const env = readEnv({
    ...process.env,
    DATABASE_URL: f.url,
    APP_RUNTIME: 'fastify',
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3048',
    APP_URL: 'http://127.0.0.1:3048',
  });
  const app = await buildApp(env, {
    database: { ...f.database, close: async () => {} },
    logger: false,
  });
  const errors: string[] = [];
  const unexpected: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 400) unexpected.push(`${r.status()} ${r.url()}`);
  });
  try {
    await app.listen({ host: '127.0.0.1', port: 3048 });
    await page.goto(env.appUrl + '/admin/login');
    await page.getByLabel('Email', { exact: true }).fill(f.admin.email);
    await page
      .getByLabel('Password', { exact: true })
      .fill('temporary-investor-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(env.appUrl + '/admin');
    const nav = page.getByRole('navigation', { name: 'Admin', exact: true });
    await nav.getByRole('link', { name: 'Products', exact: true }).click();
    await page
      .getByRole('searchbox', { name: 'Search products', exact: true })
      .fill(' Accessories ');
    await page
      .getByRole('search', { name: 'Search products', exact: true })
      .getByRole('button', { name: 'Search', exact: true })
      .click();
    await expect(page.locator('tbody tr')).toHaveCount(2);
    await page
      .getByRole('checkbox', {
        name: 'Select all products on this page',
        exact: true,
      })
      .check();
    await page
      .getByRole('button', { name: 'Apply to selected products', exact: true })
      .click();
    await expect(page.getByRole('status')).toContainText('2 updated');
    await expect(page.locator('tbody tr').first()).toContainText('POS Ready');
    await expect(page.locator('tbody tr').first()).toContainText(
      'Webstore Incomplete',
    );
    await page
      .getByRole('link', { name: 'Synthetic inventory 1', exact: true })
      .click();
    const variantForm = page.locator(
      `form[action="/admin/products/${product!.id}/variants/${variant!.id}"]`,
    );
    await variantForm.getByLabel('Weight (gram)', { exact: true }).fill('');
    await variantForm
      .getByRole('button', { name: 'Save variant', exact: true })
      .click();
    await expect(page.locator('.form-error')).toHaveCount(0);
    await expect(
      page.locator('.readiness-badge').filter({ hasText: 'POS Ready' }),
    ).toBeVisible();
    await expect(
      page
        .locator('.readiness-badge')
        .filter({ hasText: 'Webstore Incomplete' }),
    ).toBeVisible();
    await nav.getByRole('link', { name: 'Inventory', exact: true }).click();
    await page
      .getByRole('searchbox', { name: 'Search inventory', exact: true })
      .fill(variant!.sku);
    await page
      .getByRole('search', { name: 'Search inventory', exact: true })
      .getByRole('button', { name: 'Search', exact: true })
      .click();
    const row = page.locator('tr').filter({ hasText: variant!.sku });
    await row.locator('[data-stock-quantity]').fill('5');
    await row
      .getByRole('checkbox', { name: `Select ${variant!.sku}`, exact: true })
      .check();
    await page
      .getByRole('button', { name: 'Save Selected quantities', exact: true })
      .click();
    await expect(page.getByRole('status')).toContainText('1 updated');
    await expect(row.locator('[data-stock-quantity]')).toHaveValue('5');
    await page.goto(env.appUrl + '/pos/login');
    await page.getByLabel('Email', { exact: true }).fill(f.admin.email);
    await page
      .getByLabel('Password', { exact: true })
      .fill('temporary-investor-password');
    await page
      .getByRole('button', { name: 'Sign in to POS', exact: true })
      .click();
    await expect(page).toHaveURL(env.appUrl + '/pos');
    await page.locator('[data-pos-search]').fill(variant!.sku);
    const card = page
      .locator('[data-pos-product-grid] article')
      .filter({ hasText: 'Synthetic inventory 1' });
    await expect(card).toBeVisible();
    await card.click();
    await page.locator('[data-pos-pay]').click();
    await page.locator('[data-pos-exact-cash]').click();
    const completed = page.waitForResponse(
      (r) =>
        r.url().endsWith('/pos/api/sales') && r.request().method() === 'POST',
    );
    await page.locator('[data-pos-complete-sale]').click();
    const response = await completed;
    expect(response.status()).toBe(200);
    const sale = (await response.json()) as {
      transactionNumber: string;
      total: string;
    };
    expect(sale.total).toBe('500');
    await page.goto(env.appUrl + '/product/' + product!.slug);
    await expect(page.locator('[data-add-to-cart]')).toBeDisabled();
    await expect(page.getByRole('status')).toContainText(
      'Unavailable for online purchase',
    );
    await page.goto(env.appUrl + `/admin/products/${product!.id}/edit`);
    await variantForm.getByLabel('Weight (gram)', { exact: true }).fill('300');
    await variantForm
      .getByRole('button', { name: 'Save variant', exact: true })
      .click();
    await expect(
      page.locator('.readiness-badge').filter({ hasText: 'Webstore Ready' }),
    ).toBeVisible();
    await page.goto(env.appUrl + '/product/' + product!.slug);
    await expect(page.locator('[data-add-to-cart]')).toBeEnabled();
    await page.goto(env.appUrl + '/admin/finance/fixed-assets');
    await page
      .getByRole('searchbox', { name: 'Search assets', exact: true })
      .fill('Synthetic asset 20');
    await page
      .getByRole('search', { name: 'Search assets', exact: true })
      .getByRole('button', { name: 'Search', exact: true })
      .click();
    await expect(
      page
        .getByRole('region', { name: 'Fixed asset register' })
        .locator('tbody tr'),
    ).toHaveCount(1);
    await expect(page.locator('[data-fixed-total]')).toHaveText('Rp40.000');
    await nav
      .getByRole('link', { name: 'Income & Expense', exact: true })
      .click();
    await page
      .getByRole('searchbox', { name: 'Search transactions', exact: true })
      .fill('Operations search');
    await page
      .getByRole('search', { name: 'Search transactions', exact: true })
      .getByRole('button', { name: 'Search', exact: true })
      .click();
    await expect(page.locator('tr[data-manual-status]')).toHaveCount(1);
    await expect(page.locator('tr[data-manual-status]')).toContainText(
      'Operations search fixture',
    );
    await page.goto(env.appUrl + '/pos/history');
    await page
      .getByRole('searchbox', { name: 'Search transactions', exact: true })
      .fill(sale.transactionNumber.toLowerCase());
    await page
      .getByRole('search', { name: 'Search transactions', exact: true })
      .getByRole('button', { name: 'Search', exact: true })
      .click();
    await expect(page.locator('.pos-history-table tbody tr')).toHaveCount(1);
    await expect(page.locator('.pos-history-table')).toContainText(
      sale.transactionNumber,
    );
    await page.goto(env.appUrl + '/admin/products?q=Accessories');
    await page.screenshot({
      path: 'test-results/catalog-readiness.png',
      fullPage: true,
    });
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
  } finally {
    await app.close();
    await f.cleanup();
  }
});
