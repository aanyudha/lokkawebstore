import { test, expect } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { storefrontNavigationFixture } from '../helpers/storefront-navigation-fixture.js';
import { buildApp } from '../../src/app.js';
import { readEnv } from '../../src/config/env.js';
import {
  directCosts,
  products,
  productVariants,
  financialTransactions,
  inventoryMovements,
  sales,
} from '../../src/db/schema/index.js';
import { createOrderService } from '../../src/modules/orders/service.js';

test('Demo Shirt cart to pending order, immutable history, cancellation and EN/ID in a disposable DB', async ({
  page,
}) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(15000);
  const f = await storefrontNavigationFixture();
  expect(new URL(f.url).pathname).toMatch(/^\/lokka_verify_/);
  expect(f.url).not.toBe(process.env.LOKKA_BROWSER_DATABASE_SOURCE);
  const base = 'http://127.0.0.1:3052';
  const app = await buildApp(
    readEnv({
      ...process.env,
      DATABASE_URL: f.url,
      APP_URL: base,
      NODE_ENV: 'test',
      APP_RUNTIME: 'fastify',
    }),
    { database: { ...f.database, close: async () => {} }, logger: false },
  );
  const errors: string[] = [],
    bad: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico'))
      bad.push(`${response.status()} ${response.url()}`);
  });
  try {
    await f.catalog.saveProduct(
      {
        name: 'Demo Shirt',
        slug: 'demo-shirt',
        status: 'active',
        categoryId: f.ready.id,
      },
      f.product.id,
    );
    for (const locale of ['en', 'id'])
      await f.catalog.saveProductTranslation(f.product.id, locale, {
        name: 'Demo Shirt',
        slug: 'demo-shirt',
      });
    const [large] = await f.db
      .insert(productVariants)
      .values({
        productId: f.product.id,
        name: 'L',
        sku: 'SHIRT-L',
        price: 800000n,
        stockQuantity: 5,
        weightGrams: 200,
        status: 'active',
        sortOrder: 1,
      })
      .returning();
    await app.listen({ host: '127.0.0.1', port: 3052 });
    await page.goto(base);
    await page.locator('.header-actions > .header-account').click();
    await page
      .getByLabel('Email address', { exact: true })
      .fill(f.customer.customer.email);
    await page
      .getByLabel('Password', { exact: true })
      .fill('temporary-customer-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.locator('.header-actions > .header-account')).toHaveText(
      'Diego',
    );
    await page.goto(`${base}/product/demo-shirt`);
    await expect(page.locator('.gallery .product-placeholder')).toBeVisible();
    await page
      .locator('.variant-picker')
      .getByText('L', { exact: true })
      .click();
    await expect(page.locator('[data-variant-price]')).toHaveText('Rp800,000');
    await expect(page.getByLabel('Quantity', { exact: true })).toHaveAttribute(
      'max',
      '5',
    );
    await page
      .locator('.variant-picker')
      .getByText('M', { exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Add to cart', exact: true })
      .click();
    await expect(page).toHaveURL(base + '/cart');
    await expect(page.locator('[data-cart-count]')).toHaveText('1');
    await expect(page.locator('.main-nav a')).toHaveText([
      'First category',
      'Ready to Wear',
    ]);
    await page.getByRole('spinbutton').fill('3');
    await page.getByRole('button', { name: 'Update', exact: true }).click();
    await expect(page.locator('[data-subtotal]')).toHaveText(
      'Subtotal: Rp2,385,000',
    );
    await expect(page.locator('[data-cart-count]')).toHaveText('3');
    await page.getByRole('spinbutton').fill('2');
    await page.getByRole('button', { name: 'Update', exact: true }).click();
    await expect(page.locator('[data-subtotal]')).toHaveText(
      'Subtotal: Rp1,590,000',
    );
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(
      page.getByRole('link', { name: 'Review order', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText('Your cart is empty.')).toBeVisible();
    await page.goto(`${base}/product/demo-shirt`);
    await page
      .getByRole('button', { name: 'Add to cart', exact: true })
      .click();
    await page.screenshot({
      path: 'test-results/e1-cart-desktop.png',
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: 'test-results/e1-cart-mobile.png',
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('link', { name: 'Review order', exact: true }).click();
    await expect(page.getByText('Shipping', { exact: true })).toHaveCount(0);
    // A catalog price change after review must be recomputed by the server.
    await f.db
      .update(productVariants)
      .set({ price: 810000n, updatedAt: new Date() })
      .where(eq(productVariants.id, f.variant.id));
    await page
      .getByRole('button', { name: 'Create pending order', exact: true })
      .click();
    await expect(page).toHaveURL(/\/account\/orders\/WEB-\d{8}-\d{6,}$/);
    const number = await page.locator('main h1').innerText();
    await expect(page.locator('[data-order-status]')).toHaveText(
      'Pending payment',
    );
    await expect(
      page.getByText('Subtotal: Rp810,000', { exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-cart-count]')).toHaveText('0');
    const orderService = createOrderService(f.db);
    const snapshot = await orderService.get(f.customer.customer.id, number);
    expect(snapshot!.items[0]!.costSnapshot).toBe(300000n);
    expect(
      (
        await f.db
          .select()
          .from(productVariants)
          .where(eq(productVariants.id, f.variant.id))
      )[0]!.stockQuantity,
    ).toBe(100);
    await f.db
      .update(products)
      .set({ name: 'Edited Shirt', updatedAt: new Date() })
      .where(eq(products.id, f.product.id));
    await f.db
      .update(productVariants)
      .set({
        name: 'Edited M',
        sku: 'EDITED-M',
        price: 999000n,
        updatedAt: new Date(),
      })
      .where(eq(productVariants.id, f.variant.id));
    await f.db
      .update(directCosts)
      .set({ amountRupiah: 600000n, updatedAt: new Date() })
      .where(eq(directCosts.id, f.cost.id));
    await page.reload();
    await expect(page.locator('tbody')).toContainText('Demo Shirt');
    await expect(page.locator('tbody')).toContainText('ACC-M');
    await expect(page.locator('tbody')).toContainText('Rp810,000');
    expect(await orderService.get(f.customer.customer.id, number)).toEqual(
      snapshot,
    );
    await page.screenshot({
      path: 'test-results/e1-order-history.png',
      fullPage: true,
    });
    await page.getByRole('link', { name: 'Orders', exact: true }).click();
    await page.getByRole('link', { name: number, exact: true }).click();
    await page
      .getByRole('button', { name: 'Cancel order', exact: true })
      .click();
    await expect(page.locator('[data-order-status]')).toHaveText('Cancelled');
    await page
      .locator('.lang-switcher')
      .getByText('ID', { exact: true })
      .click();
    await expect(page).toHaveURL(`${base}/id/akun/pesanan/${number}`);
    await expect(page.locator('[data-order-status]')).toHaveText('Dibatalkan');
    await page.locator('.header-cart').click();
    await expect(page.locator('main h1')).toHaveText('Keranjang');
    await page.goto(`${base}/id/produk/demo-shirt`);
    await expect(
      page.getByRole('button', { name: 'Tambah ke keranjang' }),
    ).toBeEnabled();
    await f.db
      .update(productVariants)
      .set({ stockQuantity: 0, updatedAt: new Date() })
      .where(eq(productVariants.productId, f.product.id));
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Tambah ke keranjang' }),
    ).toBeDisabled();
    expect(await f.db.select().from(sales)).toHaveLength(0);
    expect(await f.db.select().from(financialTransactions)).toHaveLength(0);
    expect(await f.db.select().from(inventoryMovements)).toHaveLength(0);
    expect(snapshot!.subtotal).toBe(810000n);
    expect(large).toBeDefined();
    expect(errors).toEqual([]);
    expect(bad).toEqual([]);
  } finally {
    await app.close();
    await f.cleanup();
  }
});
