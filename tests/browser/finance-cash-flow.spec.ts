import { test, expect } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { commercialDatabase } from '../helpers/commercial-database.js';
import { createCatalog } from '../../src/modules/catalog/service.js';
import { LocalCatalogImageStorage } from '../../src/modules/catalog/storage.js';
import { createLedger } from '../../src/modules/finance/ledger.js';
import { createSalesService } from '../../src/modules/sales/service.js';
import {
  productVariants,
  vendors,
  adminUsers,
  financialTransactions,
} from '../../src/db/schema/index.js';
import { hashPassword } from '../../src/modules/auth/service.js';
import { buildApp } from '../../src/app.js';
import { readEnv } from '../../src/config/env.js';

test('admin cash flow and income & expense flow', async ({ page }) => {
  test.setTimeout(120000);
  const fixture = await commercialDatabase();
  const db = fixture.database.db;
  const catalog = createCatalog(
    db,
    new LocalCatalogImageStorage('storage/browser/finance-cash-flow'),
  );
  const ledger = createLedger(db);
  const salesService = createSalesService(db);
  await db
    .insert(vendors)
    .values({ slug: 'lokka', name: 'LOKKA', status: 'active' });
  const [admin] = await db
    .insert(adminUsers)
    .values({
      email: 'finance@example.test',
      name: 'Finance browser verification',
      passwordHash: await hashPassword('temporary-finance-password'),
      status: 'active',
    })
    .returning({ id: adminUsers.id });
  const product = await catalog.saveProduct({
    name: 'Finance browser product',
    slug: 'finance-browser',
    status: 'draft',
  });
  await catalog.saveVariant(product.id, {
    name: 'M',
    sku: 'FIN-BR-M',
    price: '795000',
    weightGrams: '450',
    stockQuantity: '10',
    status: 'active',
  });
  await catalog.saveProduct(
    { name: product.name, slug: product.slug, status: 'active' },
    product.id,
  );
  const [variant] = await db
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(eq(productVariants.productId, product.id))
    .limit(1);
  // An existing completed POS sale — posted by the POS completion path.
  const sale = await salesService.completeSale({
    source: 'POS',
    cashierId: admin!.id,
    items: [{ variantId: variant!.id, quantity: 1 }],
    cashTendered: 795000n,
  });
  expect(sale.total).toBe(795000n);
  // Auditable opening balance, dated before today.
  await ledger.setOpeningBalance(
    {
      amountRupiah: '1000000',
      occurredAt: `${new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)}T00:00`,
      notes: 'Initial cash',
    },
    admin!.id,
  );
  const env = readEnv({
    ...process.env,
    DATABASE_URL: fixture.url,
    NODE_ENV: 'test',
    PORT: '3017',
    APP_URL: 'http://127.0.0.1:3017',
  });
  const app = await buildApp(env, {
    database: { ...fixture.database, close: async () => {} },
    logger: false,
  });
  const pageErrors: string[] = [];
  const unexpectedResponses: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 400)
      unexpectedResponses.push(`${response.status()} ${response.url()}`);
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await app.listen({ host: '127.0.0.1', port: 3017 });

    // 1. Login admin
    await page.goto(`${env.appUrl}/admin/login`);
    await page
      .getByLabel('Email', { exact: true })
      .fill('finance@example.test');
    await page
      .getByLabel('Password', { exact: true })
      .fill('temporary-finance-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(`${env.appUrl}/admin`);
    const sidebar = page.getByRole('navigation', {
      name: 'Admin',
      exact: true,
    });

    // 2. Open Cash Flow from the Finance sidebar group
    await sidebar.getByRole('link', { name: 'Cash Flow', exact: true }).click();
    await expect(page).toHaveURL(`${env.appUrl}/admin/finance/cash-flow`);
    await expect(page.locator('main h1')).toHaveText('Cash Flow');

    // 3. The existing POS sale appears automatically, counted exactly once
    await expect(page.locator('[data-cash-opening]')).toHaveText('Rp1.000.000');
    await expect(page.locator('[data-cash-income]')).toHaveText('Rp795.000');
    await expect(page.locator('[data-cash-expenses]')).toHaveText('Rp0');
    await expect(page.locator('[data-cash-net]')).toHaveText('Rp795.000');
    await expect(page.locator('[data-cash-ending]')).toHaveText('Rp1.795.000');
    await expect(page.locator('[data-source="POS"]')).toContainText(
      'Rp795.000',
    );
    await expect(page.locator('table tbody tr')).toHaveCount(1);

    // 4. Add a manual Expense on Income & Expense
    await sidebar
      .getByRole('link', { name: 'Income & Expense', exact: true })
      .click();
    await expect(page).toHaveURL(`${env.appUrl}/admin/finance/income-expense`);
    const direction = page.getByRole('combobox', { name: /^Type/ });
    const category = page.getByRole('combobox', { name: /^Category/ });
    const optionValues = () =>
      category
        .locator('option')
        .evaluateAll((options) =>
          options
            .map((option) => (option as HTMLOptionElement).value)
            .filter(Boolean),
        );
    await expect(direction).toHaveValue('INCOME');
    expect(await optionValues()).toEqual(['PRODUCT_SALES', 'OTHER_INCOME']);
    await category.selectOption('OTHER_INCOME');
    // Native selects remain keyboard operable; change events refresh the category immediately.
    await direction.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Tab');
    await expect(direction).toHaveValue('EXPENSE');
    await expect(category).toHaveValue('');
    expect(await optionValues()).toEqual([
      'PACKAGING',
      'SUPPLIES',
      'UTILITIES',
      'RENT',
      'SALARIES',
      'MARKETING',
      'TRANSPORT',
      'MAINTENANCE',
      'OTHER_EXPENSE',
    ]);
    await category.selectOption('SALARIES');
    await direction.selectOption('INCOME');
    await expect(category).toHaveValue('');
    expect(await optionValues()).toEqual(['PRODUCT_SALES', 'OTHER_INCOME']);
    await direction.selectOption('EXPENSE');
    await category.selectOption('PACKAGING');
    await page
      .getByLabel('Amount (whole Rupiah)', { exact: true })
      .fill('50000');
    await page
      .getByLabel('Date & time', { exact: true })
      .fill(new Date().toISOString().slice(0, 16));
    await page
      .getByLabel('Description / notes', { exact: true })
      .fill('Packaging');
    await page.getByRole('button', { name: 'Save transaction' }).click();

    // 10. The manual entry is in the history, POS income stays read-only
    await expect(
      page
        .locator('tr[data-manual-status="POSTED"]')
        .filter({ hasText: 'Packaging' }),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-pos-income]').filter({ hasText: 'Rp795.000' }),
    ).toHaveCount(1);
    await expect(page.locator('[data-pos-income] form')).toHaveCount(0);
    await expect(
      page.getByText('system generated, read-only', { exact: false }),
    ).toBeVisible();

    // 5–7. Cash Flow now shows Income, Expense and the Ending Balance
    await sidebar.getByRole('link', { name: 'Cash Flow', exact: true }).click();
    await expect(page.locator('[data-cash-opening]')).toHaveText('Rp1.000.000');
    await expect(page.locator('[data-cash-income]')).toHaveText('Rp795.000');
    await expect(page.locator('[data-cash-expenses]')).toHaveText('Rp50.000');
    await expect(page.locator('[data-cash-net]')).toHaveText('Rp745.000');
    await expect(page.locator('[data-cash-ending]')).toHaveText('Rp1.745.000');
    await expect(page.locator('[data-category="PACKAGING"]')).toContainText(
      'Rp50.000',
    );
    // Transaction list matches the totals.
    await expect(page.locator('table tbody tr')).toHaveCount(2);

    // 8. Period filter
    await page.getByRole('link', { name: 'This month', exact: true }).click();
    await expect(page.locator('[data-cash-ending]')).toHaveText('Rp1.745.000');
    await page.getByLabel('From', { exact: true }).fill('2030-01-01');
    await page.getByLabel('To', { exact: true }).fill('2030-01-31');
    await page.getByRole('button', { name: 'Apply range' }).click();
    await expect(page.locator('[data-cash-opening]')).toHaveText('Rp1.745.000');
    await expect(page.locator('[data-cash-income]')).toHaveText('Rp0');
    await expect(page.locator('[data-cash-expenses]')).toHaveText('Rp0');
    await expect(page.locator('[data-cash-ending]')).toHaveText('Rp1.745.000');

    // 9. Income & Expense still shows the manual entry
    await sidebar
      .getByRole('link', { name: 'Income & Expense', exact: true })
      .click();
    await expect(
      page
        .locator('tr[data-manual-status="POSTED"]')
        .filter({ hasText: 'Packaging' }),
    ).toHaveCount(1);
    // Valid income saves too, while neither manual income category creates accounting revenue.
    await direction.selectOption('INCOME');
    await category.selectOption('OTHER_INCOME');
    await page
      .getByLabel('Amount (whole Rupiah)', { exact: true })
      .fill('25000');
    await page
      .getByLabel('Description / notes', { exact: true })
      .fill('Manual income regression');
    await page.getByRole('button', { name: 'Save transaction' }).click();
    await expect(
      page
        .locator('tr[data-manual-status="POSTED"]')
        .filter({ hasText: 'Manual income regression' }),
    ).toHaveCount(1);
    const before = await db
      .select({ id: financialTransactions.id })
      .from(financialTransactions);
    const csrf = await page
      .locator('[data-finance-transaction] input[name="csrf"]')
      .inputValue();
    for (const [invalidDirection, invalidCategory] of [
      ['INCOME', 'SALARIES'],
      ['INCOME', 'PACKAGING'],
      ['EXPENSE', 'PRODUCT_SALES'],
      ['EXPENSE', 'OTHER_INCOME'],
    ]) {
      const response = await page.request.post(
        `${env.appUrl}/admin/finance/income-expense`,
        {
          headers: { origin: env.appUrl },
          form: {
            csrf,
            direction: invalidDirection!,
            category: invalidCategory!,
            amountRupiah: '1000',
            occurredAt: new Date().toISOString().slice(0, 16),
          },
        },
      );
      expect(response.status()).toBe(422);
      expect(await response.text()).toContain('role="alert"');
    }
    expect(
      await db
        .select({ id: financialTransactions.id })
        .from(financialTransactions),
    ).toHaveLength(before.length);
    await sidebar.getByRole('link', { name: 'Cash Flow', exact: true }).click();
    await expect(page.locator('[data-cash-income]')).toHaveText('Rp820.000');
    await expect(page.locator('[data-cash-expenses]')).toHaveText('Rp50.000');
    await expect(page.locator('[data-cash-ending]')).toHaveText('Rp1.770.000');
    expect(unexpectedResponses).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});
