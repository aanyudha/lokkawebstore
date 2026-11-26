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
import { createCustomerAddresses } from '../../src/modules/customer/addresses.js';
import { createShippingMethods } from '../../src/modules/shipping/methods.js';
import {
  configureCheckoutShipping,
  sampleAddress,
} from '../helpers/checkout-fixture.js';
import { resolvePeriod } from '../../src/modules/finance/ledger.js';

test('cart, delivery selection and review create an immutable unpaid order in EN and ID', async ({
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
    const method = await configureCheckoutShipping(f.db, f.catalog);
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
      page.getByRole('link', { name: 'Checkout', exact: true }),
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
    await page.getByRole('link', { name: 'Checkout', exact: true }).click();
    await expect(page).toHaveURL(base + '/cart/review');
    await f.db
      .update(productVariants)
      .set({ weightGrams: 0, updatedAt: new Date() })
      .where(eq(productVariants.id, f.variant.id));
    await page.reload();
    await expect(
      page.getByText('A product is missing its shipping weight.', {
        exact: false,
      }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Place order' })).toHaveCount(
      0,
    );
    await f.db
      .update(productVariants)
      .set({ price: 810000n, weightGrams: 300, updatedAt: new Date() })
      .where(eq(productVariants.id, f.variant.id));
    await page.reload();
    await page
      .getByLabel('Label (optional)', { exact: true })
      .fill(sampleAddress.label);
    await page
      .getByLabel('Recipient name', { exact: true })
      .fill(sampleAddress.recipientName);
    await page
      .getByLabel('Phone number', { exact: true })
      .fill(sampleAddress.phone);
    await page
      .getByLabel('Address line 1', { exact: true })
      .fill(sampleAddress.addressLine1);
    await page
      .getByLabel('City or regency', { exact: true })
      .fill(sampleAddress.city);
    await page
      .getByLabel('Province', { exact: true })
      .fill(sampleAddress.province);
    await page
      .getByLabel('Postal code', { exact: true })
      .fill(sampleAddress.postalCode);
    await page.getByLabel('Use as default address', { exact: true }).check();
    await page
      .getByRole('button', { name: 'Save address', exact: true })
      .click();
    const addresses = createCustomerAddresses(f.db);
    const [address] = await addresses.list(f.customer.customer.id);
    await page
      .getByRole('combobox', { name: 'Select shipping address', exact: true })
      .selectOption(address!.id);
    await page
      .getByRole('combobox', { name: 'Shipping method', exact: true })
      .selectOption(method.id);
    await page
      .getByRole('button', { name: 'Review order', exact: true })
      .click();
    await expect(page.locator('[data-shipping-address]')).toContainText(
      sampleAddress.addressLine1,
    );
    await expect(page.locator('[data-subtotal]')).toHaveText('Rp810,000');
    await expect(page.locator('[data-shipment-weight]')).toContainText('300 g');
    await expect(page.locator('[data-shipping-amount]')).toHaveText('Rp22,000');
    await expect(page.locator('[data-grand-total]')).toHaveText('Rp832,000');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole('button', { name: 'Place order' }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const period = resolvePeriod({
      period: 'custom',
      from: '2000-01-01',
      to: '2100-01-01',
    });
    const accountingBefore = await f.accounting.report(period);
    await page
      .getByRole('button', { name: 'Place order', exact: true })
      .click();
    await expect(page).toHaveURL(/\/account\/orders\/WEB-\d{8}-\d{6,}$/);
    const number = await page.locator('main h1').innerText();
    await expect(page.locator('[data-order-status]')).toHaveText(
      'Waiting for payment',
    );
    await expect(page.locator('[data-subtotal]')).toHaveText('Rp810,000');
    await expect(page.locator('[data-grand-total]')).toHaveText('Rp832,000');
    await expect(page.locator('[data-cart-count]')).toHaveText('0');
    const orderService = createOrderService(f.db);
    const snapshot = await orderService.get(f.customer.customer.id, number);
    expect(snapshot!.items[0]!.costSnapshot).toBe(300000n);
    expect(snapshot!.items[0]!.unitWeightGrams).toBe(300);
    expect(await f.accounting.report(period)).toEqual(accountingBefore);
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
        weightGrams: 450,
        updatedAt: new Date(),
      })
      .where(eq(productVariants.id, f.variant.id));
    await f.db
      .update(directCosts)
      .set({ amountRupiah: 600000n, updatedAt: new Date() })
      .where(eq(directCosts.id, f.cost.id));
    await addresses.save(
      f.customer.customer.id,
      { ...sampleAddress, addressLine1: 'Changed address' },
      address!.id,
    );
    await createShippingMethods(f.db).save(
      { name: 'Changed delivery', amountRupiah: '45000', status: 'inactive' },
      method.id,
    );
    await page.reload();
    await expect(page.locator('tbody')).toContainText('Demo Shirt');
    await expect(page.locator('tbody')).toContainText('ACC-M');
    await expect(page.locator('tbody')).toContainText('Rp810,000');
    await expect(page.locator('[data-shipping-address]')).toContainText(
      sampleAddress.addressLine1,
    );
    await expect(page.locator('[data-shipping-method]')).toContainText(
      'Standard delivery',
    );
    await expect(page.locator('[data-shipment-weight]')).toContainText('300 g');
    expect(await orderService.get(f.customer.customer.id, number)).toEqual(
      snapshot,
    );
    await page.screenshot({
      path: 'test-results/e1-order-history.png',
      fullPage: true,
    });
    await page.getByRole('link', { name: 'Orders', exact: true }).click();
    await page
      .getByRole('link', { name: `View order ${number}`, exact: true })
      .click();
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
