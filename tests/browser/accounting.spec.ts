import { test, expect } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { accountingFixture } from '../helpers/accounting-fixture.js';
import { directCosts } from '../../src/db/schema/index.js';
import { buildApp } from '../../src/app.js';
import { readEnv } from '../../src/config/env.js';

test('Accounting Lite totals, period, historical cost and traceability in an isolated DB', async ({
  page,
}) => {
  test.setTimeout(120000);
  const f = await accountingFixture();
  // A separate migrated lokka_verify_* DB, itself created from the disposable
  // browser DB's connection template. Never the owner development database.
  expect(new URL(f.url).pathname).toMatch(/^\/lokka_verify_/);
  expect(f.url).not.toBe(process.env.LOKKA_BROWSER_DATABASE_SOURCE);
  const env = readEnv({
    ...process.env,
    APP_RUNTIME: 'fastify',
    DATABASE_URL: f.url,
    NODE_ENV: 'test',
    PORT: '3018',
    APP_URL: 'http://127.0.0.1:3018',
  });
  const app = await buildApp(env, {
    database: { ...f.database, close: async () => {} },
    logger: false,
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    const sale = await f.sell();
    // Changing the current cost cannot alter the sold-line snapshot.
    await f.db
      .update(directCosts)
      .set({ amountRupiah: 600000n, updatedAt: new Date() })
      .where(eq(directCosts.id, f.cost.id));
    await app.listen({ host: '127.0.0.1', port: 3018 });
    await page.goto(`${env.appUrl}/admin/login`);
    await page.getByLabel('Email', { exact: true }).fill(f.admin.email);
    await page
      .getByLabel('Password', { exact: true })
      .fill('temporary-accounting-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(`${env.appUrl}/admin`);
    const nav = page.getByRole('navigation', { name: 'Admin', exact: true });
    await nav
      .getByRole('link', { name: 'Income & Expense', exact: true })
      .click();
    await page.locator('select[name="direction"]').selectOption('EXPENSE');
    await page.locator('select[name="category"]').selectOption('PACKAGING');
    await page
      .getByLabel('Amount (whole Rupiah)', { exact: true })
      .fill('50000');
    await page
      .getByLabel('Date & time', { exact: true })
      .fill(new Date().toISOString().slice(0, 16));
    await page
      .getByLabel('Description / notes', { exact: true })
      .fill('Accounting browser packaging');
    await page.getByRole('button', { name: 'Save transaction' }).click();
    await expect(
      page
        .locator('tr[data-manual-status="POSTED"]')
        .filter({ hasText: 'Accounting browser packaging' }),
    ).toHaveCount(1);
    await nav
      .getByRole('link', { name: 'Accounting Lite', exact: true })
      .click();
    await expect(page.locator('main h1')).toHaveText('Accounting Lite');
    const check = async () => {
      for (const [key, amount] of [
        ['revenue', 'Rp795.000'],
        ['cogs', 'Rp300.000'],
        ['gross', 'Rp495.000'],
        ['expenses', 'Rp50.000'],
        ['net', 'Rp445.000'],
      ]) {
        await expect(page.locator(`[data-accounting-${key}]`)).toHaveText(
          amount!,
        );
      }
    };
    await check();
    await expect(page.locator('[data-source="POS"]')).toContainText(
      'Rp795.000',
    );
    await expect(page.locator('[data-category="PACKAGING"]')).toContainText(
      'Rp50.000',
    );
    await expect(
      page.getByRole('region', { name: 'Contributing sales', exact: true }),
    ).toContainText(sale.transactionNumber);
    const items = page.getByRole('region', {
      name: 'Historical sold-item cost',
    });
    await expect(items).toContainText(sale.transactionNumber);
    await expect(items).toContainText('ACC-M');
    await expect(items).toContainText('Rp300.000');
    await expect(
      page.getByRole('region', { name: 'Contributing operating expenses' }),
    ).toContainText('Accounting browser packaging');
    await page.getByRole('link', { name: 'This month', exact: true }).click();
    await check();
    await page.getByRole('link', { name: 'Custom range', exact: true }).click();
    await page.getByLabel('From', { exact: true }).fill('2099-01-01');
    await page.getByLabel('To', { exact: true }).fill('2099-01-31');
    await page.getByRole('button', { name: 'Apply range' }).click();
    for (const key of ['revenue', 'cogs', 'gross', 'expenses', 'net']) {
      await expect(page.locator(`[data-accounting-${key}]`)).toHaveText('Rp0');
    }
    await page.getByRole('link', { name: 'Today', exact: true }).click();
    await check();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await f.cleanup();
  }
});
