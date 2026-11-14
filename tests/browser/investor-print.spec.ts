import { test, expect, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { investorFixture } from '../helpers/investor-fixture.js';
import { importOwnerData } from '../../src/modules/finance/owner-import.js';
import { createSalesService } from '../../src/modules/sales/service.js';
import { productVariants } from '../../src/db/schema/index.js';
import { buildApp } from '../../src/app.js';
import { readEnv } from '../../src/config/env.js';
async function verifySameRenderedReport(
  page: Page,
  primaryCount: number,
  appendixCount: number,
) {
  const report = page.locator('[data-investor-report]');
  const before = await report.innerHTML();
  const tableText = await report.locator('table').allTextContents();
  const date = await report.locator('time').getAttribute('datetime');
  await page.evaluate(() => {
    window.print = () => {
      document.documentElement.dataset.printCount = String(
        Number(document.documentElement.dataset.printCount ?? '0') + 1,
      );
    };
  });
  const previousCount = Number(
    (await page.locator('html').getAttribute('data-print-count')) ?? '0',
  );
  await page.getByRole('button', { name: 'Print Report', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute(
    'data-print-count',
    String(previousCount + 1),
  );
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#admin-sidebar')).toBeHidden();
  await expect(page.locator('.admin-topbar')).toBeHidden();
  await expect(page.locator('[data-print-report]')).toBeHidden();
  await expect(report.locator('.report-heading img')).toBeVisible();
  await expect(report.locator('time')).toBeVisible();
  await expect(report.locator('[data-report-primary]')).toHaveCount(
    primaryCount,
  );
  await expect(report.locator('[data-report-appendix]')).toHaveCount(
    appendixCount,
  );
  for (const section of await report
    .locator('[data-report-primary],[data-report-appendix]')
    .all())
    await expect(section).toBeVisible();
  expect(await report.innerHTML()).toBe(before);
  expect(await report.locator('table').allTextContents()).toEqual(tableText);
  expect(await report.locator('time').getAttribute('datetime')).toBe(date);
  expect(await report.evaluate((node) => getComputedStyle(node).page)).toBe(
    'lokka-investor',
  );
  expect(
    await report
      .locator('.report-kpi')
      .first()
      .evaluate((node) => getComputedStyle(node).breakInside),
  ).toBe('avoid');
  expect(
    await report
      .locator('[data-report-primary]')
      .nth(1)
      .evaluate((node) => getComputedStyle(node).breakBefore),
  ).toBe('page');
  expect(
    await report
      .locator('thead')
      .first()
      .evaluate((node) => getComputedStyle(node).display),
  ).toBe('table-header-group');
  await page.emulateMedia({ media: 'screen' });
  expect(await report.innerHTML()).toBe(before);
}
test('executive reports retain identical canonical figures, appendices and dates in screen and print media', async ({
  page,
}) => {
  test.setTimeout(120000);
  const f = await investorFixture();
  expect(new URL(f.url).pathname).toMatch(/^\/lokka_verify_/);
  expect(f.url).not.toBe(process.env.LOKKA_BROWSER_DATABASE_SOURCE);
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
  await importOwnerData(f.db, f.storage, f.payload, f.admin.id, true);
  const env = readEnv({
    ...process.env,
    DATABASE_URL: f.url,
    APP_RUNTIME: 'fastify',
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3049',
    APP_URL: 'http://127.0.0.1:3049',
  });
  const app = await buildApp(env, {
    database: { ...f.database, close: async () => {} },
    logger: false,
  });
  const errors: string[] = [];
  const unexpected: string[] = [];
  const reportRequests: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 400) unexpected.push(`${r.status()} ${r.url()}`);
  });
  page.on('request', (r) => {
    if (r.url().includes('/admin/reports/')) reportRequests.push(r.url());
  });
  try {
    await app.listen({ host: '127.0.0.1', port: 3049 });
    await page.goto(env.appUrl + '/admin/login');
    await page.getByLabel('Email', { exact: true }).fill(f.admin.email);
    await page
      .getByLabel('Password', { exact: true })
      .fill('temporary-investor-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(env.appUrl + '/admin');
    const nav = page.getByRole('navigation', { name: 'Admin', exact: true });
    await nav
      .getByRole('link', { name: 'Asset Register + Valuation', exact: true })
      .click();
    await expect(page.locator('[data-report-combined]')).toHaveText('Rp48.400');
    await expect(page.locator('[data-report-hpp]')).toHaveText('Rp8.400');
    await expect(page.locator('[data-report-fixed]')).toHaveText('Rp40.000');
    await expect(page.locator('[data-report-retail]')).toHaveText('Rp28.000');
    await expect(page.locator('[data-report-spread]')).toHaveText('Rp19.600');
    await expect(page.locator('[data-report-units]')).toHaveText('56');
    await expect(page.locator('[data-product-count]')).toHaveText('34');
    await expect(page.locator('[data-asset-mix]')).toBeVisible();
    await expect(
      page.locator('[data-report-appendix="A"] tbody tr'),
    ).toHaveCount(34);
    await expect(
      page.locator('[data-report-appendix="B"] tbody tr'),
    ).toHaveCount(20);
    await expect(
      page.locator('[data-report-primary] .table-scroll'),
    ).toHaveCount(0);
    await expect(page.locator('[data-investor-report] form')).toHaveCount(0);
    const assetRequestCount = reportRequests.length;
    await verifySameRenderedReport(page, 2, 3);
    expect(reportRequests).toHaveLength(assetRequestCount);
    await page.setViewportSize({ width: 1100, height: 1000 });
    await page.locator('[data-report-primary]').first().screenshot({
      path: 'test-results/investor-executive-assets.png',
    });
    await nav
      .getByRole('link', { name: '12-month Plan + Prospective', exact: true })
      .click();
    await expect(page.locator('[data-plan-assets]')).toHaveText('Rp48.400');
    await expect(page.locator('[data-plan-revenue]')).toHaveText('Rp495.000');
    await expect(page.locator('[data-plan-cash]')).toHaveText('Rp495.000');
    await expect(page.locator('[data-plan-units]')).toHaveText('56');
    await expect(page.locator('[data-hpp-limitation]')).toHaveCount(1);
    await expect(page.locator('[data-projection-unavailable]')).toBeVisible();
    await expect(page.locator('.report-roadmap > li')).toHaveCount(4);
    await expect(
      page.locator('[data-report-primary] .table-scroll'),
    ).toHaveCount(0);
    await expect(page.locator('[data-legacy-disclosure]')).toContainText(
      '1 completed sales',
    );
    const planRequestCount = reportRequests.length;
    await verifySameRenderedReport(page, 3, 5);
    expect(reportRequests).toHaveLength(planRequestCount);
    await page.locator('[data-report-primary]').first().screenshot({
      path: 'test-results/investor-executive-plan.png',
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
