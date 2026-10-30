import { test, expect } from '@playwright/test';
import { unlink } from 'node:fs/promises';
import { productMediaFixture } from '../helpers/product-media-fixture.js';
import { buildApp } from '../../src/app.js';
import { readEnv } from '../../src/config/env.js';

test('canonical product images and safe placeholders across storefront locales and POS', async ({
  page,
}) => {
  const f = await productMediaFixture();
  const base = 'http://127.0.0.1:3034';
  const app = await buildApp(
    readEnv({
      ...process.env,
      APP_RUNTIME: 'fastify',
      NODE_ENV: 'test',
      DATABASE_URL: f.url,
      APP_URL: base,
      PORT: '3034',
      CATALOG_STORAGE_ROOT: f.storage.root,
    }),
    { database: { ...f.database, close: async () => {} }, logger: false },
  );
  const errors: string[] = [],
    bad: string[] = [];
  // Route through the server on every navigation, including after removing files.
  await page.route('**/media/catalog/**', (route) => route.continue());
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`);
  });
  await app.listen({ host: '127.0.0.1', port: 3034 });
  const loaded = async (selector: string) => {
    const image = page.locator(selector).first();
    await expect(image).toBeVisible();
    await expect
      .poll(() =>
        image.evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
        ),
      )
      .toBe(true);
  };
  try {
    for (const path of [
      '/',
      '/id',
      '/collections',
      '/id/collections',
      '/id/koleksi',
    ]) {
      expect((await page.goto(base + path))?.status()).toBe(200);
      const shirt = page
        .locator('.product-card')
        .filter({ hasText: f.product.name });
      await expect(shirt.locator('img')).toHaveAttribute(
        'src',
        f.storage.url(f.primary.storageKey, 'card'),
      );
      await loaded(
        `.product-card img[src="${f.storage.url(f.primary.storageKey, 'card')}"]`,
      );
      const empty = page
        .locator('.product-card')
        .filter({ hasText: f.empty.name });
      await expect(empty.locator('.product-placeholder')).toBeVisible();
      await expect(empty.locator('img')).toHaveCount(0);
    }
    for (const prefix of ['/product/', '/id/produk/']) {
      await page.goto(base + prefix + f.product.slug);
      await expect(page.locator('.gallery img').first()).toHaveAttribute(
        'src',
        f.storage.url(f.primary.storageKey, 'detail'),
      );
      await loaded('.gallery img');
      await expect(page.locator('.gallery img').first()).toHaveAttribute(
        'alt',
        'Primary fabric',
      );
      await page.goto(base + prefix + f.empty.slug);
      await expect(page.locator('.gallery .product-placeholder')).toBeVisible();
      await expect(page.locator('.gallery img')).toHaveCount(0);
    }
    await page.goto(base + '/pos/login');
    await page.getByLabel('Email', { exact: true }).fill(f.admin.email);
    await page
      .getByLabel('Password', { exact: true })
      .fill('temporary-accounting-password');
    await page
      .getByRole('button', { name: 'Sign in to POS', exact: true })
      .click();
    await expect(page).toHaveURL(base + '/pos');
    const card = page
      .locator('.pos-product-card')
      .filter({ hasText: f.product.name });
    await expect(card.locator('img')).toHaveAttribute(
      'src',
      f.storage.url(f.primary.storageKey, 'thumb'),
    );
    await loaded('.pos-product-card img');
    await expect(
      page
        .locator('.pos-product-card')
        .filter({ hasText: f.empty.name })
        .locator('.pos-product-placeholder'),
    ).toHaveText('No image');
    await page.locator('[data-pos-search]').fill(f.variant.sku);
    await expect(page.locator('.pos-product-card')).toHaveCount(1);
    await card.click();
    await expect(page.locator('[data-pos-cart-lines]')).toContainText(
      f.product.name,
    );
    // Missing card derivative uses another derivative on a normal navigation.
    await unlink(f.storage.path(f.primary.storageKey, 'card'));
    await page.goto(base + '/');
    await loaded('.product-card img');
    await f.storage.remove(f.primary.storageKey);
    await page.goto(base + '/collections');
    await loaded('.product-card img');
    expect(errors).toEqual([]);
    expect(bad).toEqual([]);
  } finally {
    await app.close();
    await f.cleanup();
  }
});
