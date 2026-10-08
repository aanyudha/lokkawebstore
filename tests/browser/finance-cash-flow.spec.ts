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
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});
