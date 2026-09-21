import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { buildApp } from '../../src/app.js';
import { createDatabase } from '../../src/db/client.js';
import {
  adminUsers,
  products,
  productVariants,
} from '../../src/db/schema/index.js';
import { readEnv } from '../../src/config/env.js';
import { hashPassword, token } from '../../src/modules/auth/service.js';

test('POS sale submission - single item completes successfully', async ({
  page,
}) => {
  test.setTimeout(120000);
  const run = randomUUID();
  const password = token();
  const env = readEnv({
    ...process.env,
    NODE_ENV: 'test',
    PORT: '3014',
    APP_URL: 'http://127.0.0.1:3014',
    CATALOG_STORAGE_ROOT: `storage/browser/${run}`,
  });
  const database = createDatabase(env.databaseUrl);
  const [user] = await database.db
    .insert(adminUsers)
    .values({
      email: `${run}@example.test`,
      name: 'POS Sale Verification',
      passwordHash: await hashPassword(password),
    })
    .returning();

  const [productDress] = await database.db
    .select()
    .from(products)
    .where(eq(products.slug, 'lokka-demo-dress'));
  if (!productDress) throw new Error('Demo Dress not found');

  const [dressVariant] = await database.db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, productDress.id));
  if (!dressVariant) throw new Error('Demo Dress variant not found');

  const initialStock = dressVariant.stockQuantity;

  const app = await buildApp(env, { database, logger: false });
  await app.listen({ host: env.host, port: env.port });

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    await page.goto(`${env.appUrl}/pos/login`);
    await page.getByLabel('Email', { exact: true }).fill(`${run}@example.test`);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page
      .getByRole('button', { name: 'Sign in to POS', exact: true })
      .click();
    await expect(page).toHaveURL(`${env.appUrl}/pos`);

    await page.waitForTimeout(2000);
    const productGrid = page.locator('[data-pos-product-grid]');
    const content = await productGrid.innerHTML();
    expect(content).toContain('LOKKA Demo Dress');

    const dressCard = page
      .locator('[data-pos-product-grid] article')
      .filter({ hasText: 'LOKKA Demo Dress' });
    await dressCard.click();
    await page.waitForTimeout(500);

    const cartLines = page.locator('[data-pos-cart-lines]');
    const cartContent = await cartLines.innerHTML();
    expect(cartContent).toContain('LOKKA Demo Dress');
    expect(cartContent).toContain('Rp795.000');

    const payBtn = page.locator('[data-pos-pay]');
    await expect(payBtn).toBeEnabled();
    await payBtn.click();
    await page.waitForTimeout(500);

    const paymentModal = page.locator('[data-pos-payment-modal]');
    await expect(paymentModal).toBeVisible();

    const paymentDue = page.locator('[data-pos-payment-due]');
    const dueText = await paymentDue.textContent();
    expect(dueText).toContain('795.000');

    const cashInput = page.locator('[data-pos-cash-input]');
    await cashInput.fill('795000');
    await page.waitForTimeout(300);

    const changeEl = page.locator('[data-pos-change]');
    const changeText = await changeEl.textContent();
    expect(changeText).toContain('Rp0');

    const completeBtn = page.locator('[data-pos-complete-sale]');
    await expect(completeBtn).toBeEnabled();

    const salesResponsePromise = page.waitForResponse(
      (r) =>
        r.url().includes('/pos/api/sales') && r.request().method() === 'POST',
    );

    await completeBtn.click();

    const salesResponse = await salesResponsePromise;
    const salesApiStatus = salesResponse.status();
    const salesApiBody = (await salesResponse
      .json()
      .catch(() => null)) as Record<string, unknown> | null;

    if (salesApiStatus !== 200) {
      console.error('Sales API failed:', salesApiStatus, salesApiBody);
    }

    expect(salesApiStatus).toBe(200);
    expect(salesApiBody).toBeTruthy();
    if (salesApiBody) {
      expect(salesApiBody.transactionNumber).toMatch(/^POS-/);
      expect((salesApiBody.items as unknown[]).length).toBe(1);
      expect(salesApiBody.total).toBe('795000');
      expect(salesApiBody.cashReceived).toBe('795000');
      expect(salesApiBody.changeAmount).toBe('0');
    }

    await page.waitForTimeout(1000);
    const receiptModal = page.locator('[data-pos-receipt-modal]');
    await expect(receiptModal).toBeVisible();
    const receiptContent = await receiptModal.textContent();
    expect(receiptContent).toContain('LOKKA Demo Dress');
    expect(receiptContent).toContain('795.000');

    const afterVariant = await database.db
      .select({ stockQuantity: productVariants.stockQuantity })
      .from(productVariants)
      .where(eq(productVariants.id, dressVariant.id))
      .limit(1);
    expect(afterVariant[0]!.stockQuantity).toBe(initialStock - 1);

    await receiptModal.locator('[data-pos-new-sale]').click();
    await page.waitForTimeout(500);

    const cartAfter = await cartLines.innerHTML();
    expect(cartAfter).toContain('No items in sale');
    await expect(receiptModal).toBeHidden();

    expect(pageErrors).toEqual([]);
  } finally {
    await database.db.delete(adminUsers).where(eq(adminUsers.id, user!.id));
    await app.close();
  }
});

test('POS sale submission - multi-item completes with correct totals', async ({
  page,
}) => {
  test.setTimeout(120000);
  const run = randomUUID();
  const password = token();
  const env = readEnv({
    ...process.env,
    NODE_ENV: 'test',
    PORT: '3015',
    APP_URL: 'http://127.0.0.1:3015',
    CATALOG_STORAGE_ROOT: `storage/browser/${run}`,
  });
  const database = createDatabase(env.databaseUrl);
  const [user] = await database.db
    .insert(adminUsers)
    .values({
      email: `${run}@example.test`,
      name: 'POS Multi-Sale Verification',
      passwordHash: await hashPassword(password),
    })
    .returning();

  const [productShirt] = await database.db
    .select()
    .from(products)
    .where(eq(products.slug, 'lokka-demo-shirt'));
  const [productOuter] = await database.db
    .select()
    .from(products)
    .where(eq(products.slug, 'lokka-demo-outer'));
  if (!productShirt || !productOuter)
    throw new Error('Demo products not found');

  const [shirtVariant] = await database.db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, productShirt.id));
  const [outerVariant] = await database.db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, productOuter.id));
  if (!shirtVariant || !outerVariant)
    throw new Error('Demo variants not found');

  const initialShirtStock = shirtVariant.stockQuantity;
  const initialOuterStock = outerVariant.stockQuantity;

  const app = await buildApp(env, { database, logger: false });
  await app.listen({ host: env.host, port: env.port });

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    await page.goto(`${env.appUrl}/pos/login`);
    await page.getByLabel('Email', { exact: true }).fill(`${run}@example.test`);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page
      .getByRole('button', { name: 'Sign in to POS', exact: true })
      .click();
    await expect(page).toHaveURL(`${env.appUrl}/pos`);

    await page.waitForTimeout(2000);
    const productGrid = page.locator('[data-pos-product-grid]');
    const content = await productGrid.innerHTML();
    expect(content).toContain('LOKKA Demo Shirt');
    expect(content).toContain('LOKKA Demo Outer');

    const shirtCard = page
      .locator('[data-pos-product-grid] article')
      .filter({ hasText: 'LOKKA Demo Shirt' });
    await shirtCard.click();
    await page.waitForTimeout(500);

    const shirtIncBtn = page
      .locator('[data-pos-cart-lines] .pos-qty-btn[data-action="increase"]')
      .first();
    await shirtIncBtn.click();
    await page.waitForTimeout(300);

    const outerCard = page
      .locator('[data-pos-product-grid] article')
      .filter({ hasText: 'LOKKA Demo Outer' });
    await outerCard.click();
    await page.waitForTimeout(500);

    const subtotalEl = page.locator('[data-pos-subtotal]');
    const subtotalText = await subtotalEl.textContent();
    expect(subtotalText).toContain('1.685.000');

    const payBtn = page.locator('[data-pos-pay]');
    await payBtn.click();
    await page.waitForTimeout(500);

    const paymentModal = page.locator('[data-pos-payment-modal]');
    await expect(paymentModal).toBeVisible();

    const paymentDue = page.locator('[data-pos-payment-due]');
    const dueText = await paymentDue.textContent();
    expect(dueText).toContain('1.685.000');

    const cashInput = page.locator('[data-pos-cash-input]');
    await cashInput.fill('1700000');
    await page.waitForTimeout(300);

    const changeEl = page.locator('[data-pos-change]');
    const changeText = await changeEl.textContent();
    expect(changeText).toContain('Rp15.000');

    const completeBtn = page.locator('[data-pos-complete-sale]');
    await expect(completeBtn).toBeEnabled();

    const salesResponsePromise = page.waitForResponse(
      (r) =>
        r.url().includes('/pos/api/sales') && r.request().method() === 'POST',
    );

    await completeBtn.click();

    const salesResponse = await salesResponsePromise;
    expect(salesResponse.status()).toBe(200);
    const body = await salesResponse.json();
    expect(body.items.length).toBe(2);
    expect(body.total).toBe('1685000');
    expect(body.cashReceived).toBe('1700000');
    expect(body.changeAmount).toBe('15000');

    await page.waitForTimeout(1000);
    const receiptModal = page.locator('[data-pos-receipt-modal]');
    await expect(receiptModal).toBeVisible();

    const afterShirt = await database.db
      .select({ stockQuantity: productVariants.stockQuantity })
      .from(productVariants)
      .where(eq(productVariants.id, shirtVariant.id))
      .limit(1);
    expect(afterShirt[0]!.stockQuantity).toBe(initialShirtStock - 2);

    const afterOuter = await database.db
      .select({ stockQuantity: productVariants.stockQuantity })
      .from(productVariants)
      .where(eq(productVariants.id, outerVariant.id))
      .limit(1);
    expect(afterOuter[0]!.stockQuantity).toBe(initialOuterStock - 1);

    expect(pageErrors).toEqual([]);
  } finally {
    await database.db.delete(adminUsers).where(eq(adminUsers.id, user!.id));
    await app.close();
  }
});

test('POS sale failure preserves cart for retry', async ({ page }) => {
  test.setTimeout(120000);
  const run = randomUUID();
  const password = token();
  const env = readEnv({
    ...process.env,
    NODE_ENV: 'test',
    PORT: '3016',
    APP_URL: 'http://127.0.0.1:3016',
    CATALOG_STORAGE_ROOT: `storage/browser/${run}`,
  });
  const database = createDatabase(env.databaseUrl);
  const [user] = await database.db
    .insert(adminUsers)
    .values({
      email: `${run}@example.test`,
      name: 'POS Failure Retry Verification',
      passwordHash: await hashPassword(password),
    })
    .returning();

  const [productDress] = await database.db
    .select()
    .from(products)
    .where(eq(products.slug, 'lokka-demo-dress'));
  if (!productDress) throw new Error('Demo Dress not found');

  const [dressVariant] = await database.db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, productDress.id));
  if (!dressVariant) throw new Error('Demo Dress variant not found');

  const app = await buildApp(env, { database, logger: false });
  await app.listen({ host: env.host, port: env.port });

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    await page.goto(`${env.appUrl}/pos/login`);
    await page.getByLabel('Email', { exact: true }).fill(`${run}@example.test`);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page
      .getByRole('button', { name: 'Sign in to POS', exact: true })
      .click();
    await expect(page).toHaveURL(`${env.appUrl}/pos`);

    await page.waitForTimeout(2000);
    const dressCard = page
      .locator('[data-pos-product-grid] article')
      .filter({ hasText: 'LOKKA Demo Dress' });
    await dressCard.click();
    await page.waitForTimeout(500);

    const cartLines = page.locator('[data-pos-cart-lines]');
    const cartContent = await cartLines.innerHTML();
    expect(cartContent).toContain('LOKKA Demo Dress');

    const payBtn = page.locator('[data-pos-pay]');
    await payBtn.click();
    await page.waitForTimeout(500);

    const cashInput = page.locator('[data-pos-cash-input]');
    await cashInput.fill('795000');
    await page.waitForTimeout(300);

    const completeBtn = page.locator('[data-pos-complete-sale]');
    await expect(completeBtn).toBeEnabled();

    await page.route('**/pos/api/sales', async (route) => {
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Simulated failure' }),
      });
    });

    await completeBtn.click();
    await page.waitForTimeout(1000);

    const paymentError = page.locator('[data-pos-payment-error]');
    await expect(paymentError).toBeVisible();
    const errorText = await paymentError.textContent();
    expect(errorText).toContain('Simulated failure');

    const paymentModal = page.locator('[data-pos-payment-modal]');
    await expect(paymentModal).toBeVisible();

    await expect(completeBtn).toBeEnabled();
    expect(await completeBtn.textContent()).toBe('Complete sale');

    await paymentModal.locator('[data-pos-payment-close-btn]').click();
    await page.waitForTimeout(500);

    const cartAfter = await cartLines.innerHTML();
    expect(cartAfter).toContain('LOKKA Demo Dress');

    await page.unroute('**/pos/api/sales');

    await payBtn.click();
    await page.waitForTimeout(500);
    await cashInput.fill('795000');
    await page.waitForTimeout(300);

    const salesResponsePromise = page.waitForResponse(
      (r) =>
        r.url().includes('/pos/api/sales') && r.request().method() === 'POST',
    );
    await completeBtn.click();
    const salesResponse = await salesResponsePromise;
    expect(salesResponse.status()).toBe(200);

    expect(pageErrors).toEqual([]);
  } finally {
    await database.db.delete(adminUsers).where(eq(adminUsers.id, user!.id));
    await app.close();
  }
});
