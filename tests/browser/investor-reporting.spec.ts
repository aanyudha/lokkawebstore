import { createCatalog } from '../../src/modules/catalog/service.js';
import { test, expect } from '@playwright/test';
import { investorFixture } from '../helpers/investor-fixture.js';
import { importOwnerData } from '../../src/modules/finance/owner-import.js';
import { buildApp } from '../../src/app.js';
import { readEnv } from '../../src/config/env.js';

test('Fixed Assets operations and formal investor reports use canonical values in a disposable database', async ({
  page,
}) => {
  test.setTimeout(120000);
  const f = await investorFixture();
  expect(new URL(f.url).pathname).toMatch(/^\/lokka_verify_/);
  expect(f.url).not.toBe(process.env.LOKKA_BROWSER_DATABASE_SOURCE);
  await importOwnerData(f.db, f.storage, f.payload, f.admin.id, true);
  const env = readEnv({
    ...process.env,
    DATABASE_URL: f.url,
    APP_RUNTIME: 'fastify',
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3024',
    APP_URL: 'http://127.0.0.1:3024',
  });
  const app = await buildApp(env, {
    database: { ...f.database, close: async () => {} },
    logger: false,
  });
  const errors: string[] = [];
  const responses: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400)
      responses.push(`${response.status()} ${response.url()}`);
  });
  try {
    await app.listen({ host: '127.0.0.1', port: 3024 });
    await page.goto(`${env.appUrl}/admin/login`);
    await page.getByLabel('Email', { exact: true }).fill(f.admin.email);
    await page
      .getByLabel('Password', { exact: true })
      .fill('temporary-investor-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(`${env.appUrl}/admin`);
    const nav = page.getByRole('navigation', { name: 'Admin', exact: true });
    await nav.getByRole('link', { name: 'Fixed Assets', exact: true }).click();
    await expect(
      page
        .getByRole('region', { name: 'Fixed asset register' })
        .locator('tbody tr'),
    ).toHaveCount(20);
    const form = page.locator('[data-fixed-asset-form]');
    await form
      .getByLabel('Asset name', { exact: true })
      .fill('Browser controlled asset');
    await form.getByLabel('Quantity', { exact: true }).fill('2');
    await form.getByLabel('Unit', { exact: true }).fill('pcs');
    await form
      .getByLabel('Acquisition cost per unit (whole Rupiah)', { exact: true })
      .fill('3000');
    await form.getByRole('button', { name: 'Save fixed asset' }).click();
    await expect(page.locator('[data-fixed-total]')).toHaveText('Rp46.000');
    await page
      .getByRole('link', { name: 'Edit Browser controlled asset', exact: true })
      .click();
    await form.getByLabel('Quantity', { exact: true }).fill('3');
    await form.getByRole('button', { name: 'Save fixed asset' }).click();
    await expect(page.locator('[data-fixed-total]')).toHaveText('Rp49.000');
    await page
      .getByRole('link', { name: 'Edit Browser controlled asset', exact: true })
      .click();
    await form.getByLabel('Status', { exact: true }).selectOption('DISPOSED');
    await form.getByRole('button', { name: 'Save fixed asset' }).click();
    await expect(page.locator('[data-fixed-total]')).toHaveText('Rp40.000');
    await nav.getByRole('link', { name: 'Inventory', exact: true }).click();
    await page
      .getByRole('searchbox', { name: 'Search inventory', exact: true })
      .fill('LOKKA-SYS-OWNER-034');
    await page
      .getByRole('search', { name: 'Search inventory', exact: true })
      .getByRole('button', { name: 'Search', exact: true })
      .click();
    const row = page.locator('tr').filter({ hasText: 'LOKKA-SYS-OWNER-034' });
    await expect(row).toContainText('Belum diisi');
    await expect(row.locator('[data-stock-quantity]')).toHaveValue('');
    await row.locator('[data-stock-quantity]').fill('0');
    await expect(row.locator('[data-stock-state]')).toHaveValue('true');
    await row.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(row.locator('[data-stock-quantity]')).toHaveValue('0');
    await row.locator('[data-stock-state]').selectOption('false');
    await expect(row.locator('[data-stock-quantity]')).toHaveValue('');
    await row.getByRole('button', { name: 'Save', exact: true }).click();
    await nav
      .getByRole('link', { name: 'Asset Register + Valuation', exact: true })
      .click();
    const report = page.locator('[data-investor-report]');
    await expect(report.locator('form')).toHaveCount(0);
    await expect(
      report.getByRole('img', { name: 'LOKKA', exact: true }),
    ).toHaveAttribute('src', '/images/brand/lokka-logo.webp');
    await expect
      .poll(() =>
        report
          .getByRole('img', { name: 'LOKKA', exact: true })
          .evaluate(
            (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
          ),
      )
      .toBe(true);
    await expect(page.locator('[data-report-units]')).toHaveText('56');
    await expect(page.locator('[data-report-hpp]')).toHaveText('Rp8.400');
    await expect(page.locator('[data-report-retail]')).toHaveText('Rp28.000');
    await expect(page.locator('[data-report-spread]')).toHaveText('Rp19.600');
    await expect(page.locator('[data-report-fixed]')).toHaveText('Rp40.000');
    await expect(page.locator('[data-report-combined]')).toHaveText('Rp48.400');
    await expect(page.locator('[data-report-incomplete]')).toContainText(
      '6 incomplete',
    );
    await expect(report).toContainText('DISPOSED');
    await page.evaluate(() => {
      window.print = () => {
        document.documentElement.dataset.printRequested = 'true';
      };
    });
    await page
      .getByRole('button', { name: 'Print Report', exact: true })
      .click();
    await expect(page.locator('html')).toHaveAttribute(
      'data-print-requested',
      'true',
    );
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('#admin-sidebar')).toBeHidden();
    await expect(page.locator('.admin-topbar')).toBeHidden();
    await expect(page.locator('[data-print-report]')).toBeHidden();
    await expect(report.locator('.report-heading')).toBeVisible();
    await page.screenshot({
      path: 'test-results/investor-assets-print.png',
      fullPage: true,
    });
    await page.emulateMedia({ media: 'screen' });
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await nav
      .getByRole('link', { name: '12-month Plan + Prospective', exact: true })
      .click();
    await expect(page.locator('[data-plan-sales]')).toHaveText('0');
    await expect(page.locator('[data-plan-revenue]')).toHaveText('Rp0');
    await expect(page.locator('[data-projection-unavailable]')).toBeVisible();
    await expect(page.locator('[data-investor-report] form')).toHaveCount(0);
    await expect(page.locator('[data-report-primary]')).toHaveCount(3);
    await expect(page.locator('[data-report-appendix]')).toHaveCount(5);
    await page.screenshot({
      path: 'test-results/investor-plan.png',
      fullPage: true,
    });
    // A known selection followed by unknown must disable the storefront action immediately.
    const catalog = createCatalog(f.db, f.storage);
    const stockProduct = await catalog.saveProduct({
      name: 'Synthetic stock picker',
      slug: 'synthetic-stock-picker',
      status: 'draft',
    });
    await catalog.saveVariant(stockProduct.id, {
      name: 'Known variant',
      sku: 'PICKER-KNOWN',
      price: '500',
      weightGrams: '10',
      stockQuantity: '1',
      status: 'active',
    });
    const unknown = await catalog.saveVariant(stockProduct.id, {
      name: 'Unspecified variant',
      sku: 'PICKER-UNKNOWN',
      price: '500',
      weightGrams: '10',
      stockQuantity: '',
      stockKnown: 'false',
      status: 'active',
    });
    await catalog.saveProduct(
      { name: stockProduct.name, slug: stockProduct.slug, status: 'active' },
      stockProduct.id,
    );
    await page.goto(`${env.appUrl}/product/${stockProduct.slug}`);
    await expect(page.locator('[data-add-to-cart]')).toBeEnabled();
    await page
      .getByRole('radio', { name: 'Known variant', exact: true })
      .focus();
    await page.keyboard.press('ArrowRight');
    await expect(
      page.locator(`input[name="variantId"][value="${unknown.id}"]`),
    ).toBeChecked();
    await expect(page.locator('[data-add-to-cart]')).toBeDisabled();
    await expect(page.locator('[data-variant-info]')).toContainText(
      'Unavailable',
    );
    expect(errors).toEqual([]);
    expect(responses).toEqual([]);
  } finally {
    await app.close();
    await f.cleanup();
  }
});
