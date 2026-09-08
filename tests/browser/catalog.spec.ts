import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { buildApp } from '../../src/app.js';
import { createDatabase } from '../../src/db/client.js';
import { adminUsers, products, categories } from '../../src/db/schema/index.js';
import { readEnv } from '../../src/config/env.js';
import { hashPassword, token } from '../../src/modules/auth/service.js';
import { createCatalog } from '../../src/modules/catalog/service.js';
import { LocalCatalogImageStorage } from '../../src/modules/catalog/storage.js';
import { supportedLocaleCodes } from '../../src/i18n/locales.js';
test('desktop and mobile catalog, logo, login and admin forms', async ({
  page,
}) => {
  const run = randomUUID();
  const password = token();
  const env = readEnv({
    ...process.env,
    NODE_ENV: 'test',
    PORT: '3011',
    APP_URL: 'http://127.0.0.1:3011',
    CATALOG_STORAGE_ROOT: `storage/browser/${run}`,
  });
  const database = createDatabase(env.databaseUrl);
  const storage = new LocalCatalogImageStorage(env.catalogStorageRoot);
  const catalog = createCatalog(database.db, storage);
  const [user] = await database.db
    .insert(adminUsers)
    .values({
      email: `${run}@example.test`,
      name: 'Browser verification',
      passwordHash: await hashPassword(password),
    })
    .returning();
  const category = await catalog.saveCategory({
    name: 'Batik',
    slug: `batik-${run}`,
    status: 'active',
    sortOrder: '0',
  });
  const product = await catalog.saveProduct({
    name: 'Kemeja Batik — Verifikasi',
    slug: `batik-${run}`,
    categoryId: category.id,
    status: 'active',
    shortDescription: 'Motif Indonesia dalam siluet yang tenang.',
    description:
      'Produk sementara untuk verifikasi antarmuka. Data ini dihapus setelah pengujian.',
  });
  // Public locale routes require translation rows, just like the real catalog.
  for (const locale of supportedLocaleCodes) {
    await catalog.saveCategoryTranslation(category.id, locale, {
      name: category.name,
      slug: category.slug,
    });
    await catalog.saveProductTranslation(product.id, locale, {
      name: product.name,
      slug: product.slug,
      shortDescription: product.shortDescription ?? '',
      description: product.description ?? '',
    });
  }
  await catalog.saveVariant(product.id, {
    name: 'M',
    sku: `M-${run}`,
    price: '695000',
    compareAtPrice: '795000',
    weightGrams: '300',
    stockQuantity: '8',
    status: 'active',
    sortOrder: '0',
  });
  await catalog.saveVariant(product.id, {
    name: 'L',
    sku: `L-${run}`,
    price: '725000',
    weightGrams: '320',
    stockQuantity: '0',
    status: 'active',
    sortOrder: '1',
  });
  const picture = await sharp({
    create: { width: 800, height: 1000, channels: 3, background: '#c9c1b6' },
  })
    .png()
    .toBuffer();
  await catalog.addImages(
    product.id,
    [picture],
    'Gambar uji netral; bukan fotografi produk',
  );
  const images = (await catalog.relations([product.id])).images;
  const app = await buildApp(env, { database, logger: false });
  await app.listen({ host: env.host, port: env.port });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const [name, path] of [
        ['home', '/'],
        ['collection', '/koleksi'],
        ['product', `/produk/${product.slug}`],
        ['login', '/admin/login'],
      ]) {
        const response = await page.goto(`${env.appUrl}${path}`, {
          waitUntil: 'networkidle',
        });
        expect(response?.status()).toBe(200);
        const logo = page.locator('img[alt="LOKKA"]').first();
        await expect(logo).toBeVisible();
        await expect(logo).toHaveAttribute(
          'src',
          '/images/brand/lokka-logo.webp',
        );
        const dimensions = await logo.evaluate((img: HTMLImageElement) => ({
          w: img.clientWidth,
          h: img.clientHeight,
          natural: img.naturalWidth,
        }));
        expect(dimensions.natural).toBe(800);
        expect(dimensions.w / dimensions.h).toBeCloseTo(2);
        expect(dimensions.w).toBeLessThanOrEqual(180);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: `test-results/${name}-${width}.png`,
          fullPage: true,
        });
        if (name === 'product') {
          // The design routes pointer input through the visible radio label.
          await page
            .locator('.variant-picker')
            .getByText('L', { exact: true })
            .click();
          await expect(
            page.getByRole('radio', { name: 'L', exact: true }),
          ).toBeChecked();
          await expect(page.locator('[data-variant-price]')).toHaveText(
            'Rp725.000',
          );
        }
      }
    }
    await page.getByLabel('Email', { exact: true }).fill(`${run}@example.test`);
    await page.getByLabel('Kata sandi', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();
    await expect(page).toHaveURL(`${env.appUrl}/admin`);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const [name, path] of [
        ['admin-product', `/admin/products/${product.id}/edit`],
        ['admin-category', `/admin/categories/${category.id}/edit`],
        ['inventory', '/admin/inventory'],
      ]) {
        await page.goto(`${env.appUrl}${path}`);
        await expect(page.locator('main h1')).toBeVisible();
        await expect(page.locator('img[alt="LOKKA"]').first()).toHaveAttribute(
          'src',
          '/images/brand/lokka-logo.webp',
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: `test-results/${name}-${width}.png`,
          fullPage: true,
        });
      }
    }
    expect(errors).toEqual([]);
    await page.getByRole('button', { name: 'Keluar', exact: true }).click();
    await expect(page).toHaveURL(`${env.appUrl}/admin/login`);
  } finally {
    await database.db.delete(products).where(eq(products.id, product.id));
    await database.db.delete(categories).where(eq(categories.id, category.id));
    await database.db.delete(adminUsers).where(eq(adminUsers.id, user!.id));
    await Promise.all(images.map((image) => storage.remove(image.storageKey)));
    await app.close();
  }
});
