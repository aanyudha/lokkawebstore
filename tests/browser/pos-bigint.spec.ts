import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { buildApp } from '../../src/app.js';
import { createDatabase } from '../../src/db/client.js';
import { adminUsers, products, categories } from '../../src/db/schema/index.js';
import { readEnv } from '../../src/config/env.js';
import { hashPassword, token } from '../../src/modules/auth/service.js';

test('POS BigInt arithmetic - cart and payment calculations', async ({
  page,
}) => {
  test.setTimeout(120000);
  const run = randomUUID();
  const password = token();
  const env = readEnv({
    ...process.env,
    NODE_ENV: 'test',
    PORT: '3013',
    APP_URL: 'http://127.0.0.1:3013',
    CATALOG_STORAGE_ROOT: `storage/browser/${run}`,
  });
  const database = createDatabase(env.databaseUrl);
  const [user] = await database.db
    .insert(adminUsers)
    .values({
      email: `${run}@example.test`,
      name: 'POS BigInt verification',
      passwordHash: await hashPassword(password),
    })
    .returning();
  // Find existing category and products from dev seed
  const [category] = await database.db
    .select()
    .from(categories)
    .where(eq(categories.slug, 'ready-to-wear'));
  if (!category) throw new Error('Ready to Wear category not found');
  const [productShirt] = await database.db
    .select()
    .from(products)
    .where(eq(products.slug, 'lokka-demo-shirt'));
  const [productOuter] = await database.db
    .select()
    .from(products)
    .where(eq(products.slug, 'lokka-demo-outer'));
  const [productDress] = await database.db
    .select()
    .from(products)
    .where(eq(products.slug, 'lokka-demo-dress'));
  if (!productShirt || !productOuter || !productDress)
    throw new Error('Demo products not found');
  const app = await buildApp(env, { database, logger: false });
  await app.listen({ host: env.host, port: env.port });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('404 (Not Found)')) errors.push(text);
    }
  });
  try {
    // 1. Login to POS
    await page.goto(`${env.appUrl}/pos/login`);
    await page.getByLabel('Email', { exact: true }).fill(`${run}@example.test`);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page
      .getByRole('button', { name: 'Sign in to POS', exact: true })
      .click();
    await expect(page).toHaveURL(`${env.appUrl}/pos`);

    // Capture API responses for debugging
    const responses: Array<{ url: string; status: number; body: unknown }> = [];
    page.on('response', async (response) => {
      if (response.url().includes('/pos/api/')) {
        const body = await response.json().catch(() => ({}));
        responses.push({
          url: response.url(),
          status: response.status(),
          body,
        });
      }
    });

    // 2. Wait for products to load
    await page.waitForTimeout(3000);
    const productGrid = page.locator('[data-pos-product-grid]');
    const initialContent = await productGrid.innerHTML();
    console.log('Initial products loaded');
    expect(initialContent).toContain('LOKKA Demo Shirt');
    expect(initialContent).toContain('LOKKA Demo Outer');
    expect(initialContent).toContain('LOKKA Demo Dress');

    // 3. Add Demo Dress to cart
    const dressCard = page
      .locator('[data-pos-product-grid] article')
      .filter({ hasText: 'LOKKA Demo Dress' });
    await dressCard.click();
    await page.waitForTimeout(500);

    // 4. Verify cart has 1 item
    const cartLines = page.locator('[data-pos-cart-lines]');
    const cartContent = await cartLines.innerHTML();
    console.log('Cart after adding Dress:', cartContent);
    expect(cartContent).toContain('LOKKA Demo Dress');
    expect(cartContent).toContain('Rp795.000');

    // 5. Add Demo Outer to cart
    const outerCard = page
      .locator('[data-pos-product-grid] article')
      .filter({ hasText: 'LOKKA Demo Outer' });
    await outerCard.click();
    await page.waitForTimeout(500);

    // 6. Add Demo Shirt to cart
    const shirtCard = page
      .locator('[data-pos-product-grid] article')
      .filter({ hasText: 'LOKKA Demo Shirt' });
    await shirtCard.click();
    await page.waitForTimeout(500);

    // 7. Increase Shirt qty to 2
    const shirtQtyBtn = page
      .locator(
        '[data-pos-cart-lines] .pos-qty-btn[data-action="increase"][data-variant]',
      )
      .first();
    await shirtQtyBtn.click();
    await page.waitForTimeout(500);

    // 8. Verify cart subtotal - BigInt arithmetic working
    const subtotalEl = page.locator('[data-pos-subtotal]');
    const totalEl = page.locator('[data-pos-total]');
    const subtotalText = await subtotalEl.textContent();
    const totalText = await totalEl.textContent();
    console.log('Subtotal:', subtotalText);
    console.log('Total:', totalText);
    expect(subtotalText).toMatch(/Rp[\d.]+/);
    expect(totalText).toMatch(/Rp[\d.]+/);

    // 9. Click Pay
    const payBtn = page.locator('[data-pos-pay]');
    await payBtn.click();
    await page.waitForTimeout(500);

    // 10. Verify payment modal opened
    const paymentModal = page.locator('[data-pos-payment-modal]');
    await expect(paymentModal).toBeVisible();
    const paymentDue = page.locator('[data-pos-payment-due]');
    const dueText = await paymentDue.textContent();
    console.log('Payment due:', dueText);
    expect(dueText).toMatch(/Rp[\d.]+/);

    // 11. Enter cash: 3000000 (enough to cover subtotal)
    const cashInput = page.locator('[data-pos-cash-input]');
    await cashInput.fill('3000000');
    await page.waitForTimeout(500);

    // 12. Verify change is calculated using BigInt
    const changeEl = page.locator('[data-pos-change]');
    const changeText = await changeEl.textContent();
    console.log('Change:', changeText);
    expect(changeText).toMatch(/Rp[\d.]+/);

    // 13. Verify no BigInt mixing errors occurred
    const bigIntErrors = errors.filter(
      (e) =>
        e.includes('BigInt') || e.includes('mix') || e.includes('cannot mix'),
    );
    expect(bigIntErrors).toEqual([]);

    // 14. Verify no uncaught runtime errors
    expect(errors).toEqual([]);

    // 15. Verify API responses show successful product search
    const productSearchResponse = responses.find((r) =>
      r.url.includes('/pos/api/products?q='),
    );
    expect(productSearchResponse).toBeDefined();
    if (productSearchResponse) {
      expect(productSearchResponse.status).toBe(200);
      const body = productSearchResponse.body as { products: unknown[] };
      expect(body.products.length).toBe(3);
    }

    console.log('All console errors:', errors);
    console.log('All API responses captured');
  } finally {
    await database.db.delete(adminUsers).where(eq(adminUsers.id, user!.id));
    await app.close();
  }
});
