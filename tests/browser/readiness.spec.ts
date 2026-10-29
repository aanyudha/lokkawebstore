import { test, expect } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { unlink } from 'node:fs/promises';
import sharp from 'sharp';
import { accountingFixture } from '../helpers/accounting-fixture.js';
import { buildApp } from '../../src/app.js';
import { readEnv } from '../../src/config/env.js';
import { seedDevelopmentData } from '../../src/db/seed-dev-data.js';
import { createCatalog } from '../../src/modules/catalog/service.js';
import { LocalCatalogImageStorage } from '../../src/modules/catalog/storage.js';
import {
  productVariants,
  saleItems,
  salePayments,
  inventoryMovements,
  financialTransactions,
} from '../../src/db/schema/index.js';

test('owner workflows keep media, catalog, stock, receipts and sessions consistent', async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  const f = await accountingFixture();
  await seedDevelopmentData(f.database);
  const storage = new LocalCatalogImageStorage('storage/browser/readiness');
  const catalog = createCatalog(f.db, storage);
  for (const locale of ['en', 'id'])
    await catalog.saveProductTranslation(f.product.id, locale, {
      name: f.product.name,
      slug: f.product.slug,
    });
  const base = 'http://127.0.0.1:3019';
  const app = await buildApp(
    readEnv({
      ...process.env,
      APP_RUNTIME: 'fastify',
      DATABASE_URL: f.url,
      CATALOG_STORAGE_ROOT: storage.root,
      NODE_ENV: 'test',
      PORT: '3019',
      APP_URL: base,
    }),
    { database: { ...f.database, close: async () => {} }, logger: false },
  );
  const exceptions: string[] = [],
    consoleErrors: string[] = [],
    badResponses: string[] = [];
  page.on('pageerror', (error) => exceptions.push(error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico'))
      badResponses.push(`${response.status()} ${response.url()}`);
  });
  try {
    await app.listen({ host: '127.0.0.1', port: 3019 });
    for (const path of [
      '/',
      '/id',
      '/collections',
      '/id/collections',
      '/category/ready-to-wear',
      '/id/kategori/siap-pakai',
      '/product/lokka-demo-shirt',
      '/product/lokka-demo-outer',
      '/product/lokka-demo-dress',
      '/id/produk/kemeja-demo-lokka',
      '/id/produk/outer-demo-lokka',
      '/id/produk/dress-demo-lokka',
    ]) {
      expect((await page.goto(base + path))!.status()).toBe(200);
      await expect(page.locator('main h1')).toBeVisible();
    }
    await page.goto(base + '/category/ready-to-wear');
    await page.locator('.lang-switcher a[lang="id-ID"]').click();
    await expect(page).toHaveURL(base + '/id/kategori/siap-pakai');
    await page.goto(base + '/id/produk/kemeja-demo-lokka');
    await page.locator('.lang-switcher a[lang="en"]').click();
    await expect(page).toHaveURL(base + '/product/lokka-demo-shirt');
    await page.goto(base + '/admin/login');
    await page.getByLabel('Email', { exact: true }).fill(f.admin.email);
    await page
      .getByLabel('Password', { exact: true })
      .fill('temporary-accounting-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(base + '/admin');
    await page.goto(base + `/admin/products/${f.product.id}/edit`);
    for (const format of ['png', 'jpeg'] as const) {
      const input = sharp({
        create: { width: 40, height: 60, channels: 3, background: '#d6cfc5' },
      });
      const buffer = await (
        format === 'png' ? input.png() : input.jpeg()
      ).toBuffer();
      await page.locator('input[type="file"]').setInputFiles({
        name: `qa.${format}`,
        mimeType: `image/${format}`,
        buffer,
      });
      await page
        .getByRole('button', { name: 'Upload images', exact: true })
        .click();
      await expect(page.locator('.media-grid article')).toHaveCount(
        format === 'png' ? 1 : 2,
      );
    }
    const images = (await catalog.relations([f.product.id])).images;
    for (const image of images) {
      expect(await storage.readSource(image.sourceStorageKey!)).not.toBeNull();
      for (const size of ['thumb', 'card', 'detail'] as const)
        await unlink(storage.path(image.storageKey, size));
    }
    await page.goto(base + '/admin/media');
    const download = page.waitForEvent('download');
    await page
      .getByRole('link', { name: 'Download original', exact: true })
      .first()
      .click();
    expect((await download).suggestedFilename()).toMatch(/\.(jpg|png)$/);
    await page.goto(base + `/product/${f.product.slug}`);
    for (const image of images) {
      expect(await page.content()).not.toContain(image.sourceStorageKey!);
      expect(
        (
          await page.request.get(base + storage.url(image.storageKey, 'detail'))
        ).status(),
      ).toBe(200);
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
    // Navigation must remain legible on the dark POS bar. The general anchor
    // rule previously overrode the lighter navigation color by specificity.
    const navContrast = await page
      .getByRole('link', { name: 'Back Office', exact: true })
      .evaluate((link) => {
        const luminance = (color: string) => {
          const rgb = color
            .match(/\d+/g)!
            .slice(0, 3)
            .map((raw) => {
              const value = Number(raw) / 255;
              return value <= 0.04045
                ? value / 12.92
                : ((value + 0.055) / 1.055) ** 2.4;
            });
          return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
        };
        const foreground = luminance(getComputedStyle(link).color);
        const background = luminance(
          getComputedStyle(link.closest('.pos-topbar')!).backgroundColor,
        );
        return (
          (Math.max(foreground, background) + 0.05) /
          (Math.min(foreground, background) + 0.05)
        );
      });
    expect(navContrast).toBeGreaterThanOrEqual(4.5);
    const card = page
      .locator('[data-pos-product-grid] article')
      .filter({ hasText: f.product.name });
    await expect(card).toBeVisible();
    await card.click();
    await page.setViewportSize({ width: 390, height: 900 });
    await page.locator('[data-pos-pay]').click();
    await page.locator('[data-pos-cash-input]').fill('1');
    await expect(page.locator('[data-pos-complete-sale]')).toBeDisabled();
    await page.locator('[data-pos-exact-cash]').click();
    const completed = page.waitForResponse(
      (r) =>
        r.url().endsWith('/pos/api/sales') && r.request().method() === 'POST',
    );
    await page.locator('[data-pos-complete-sale]').click();
    const response = await completed;
    expect(response.status()).toBe(200);
    const sale = (await response.json()) as {
      saleId: string;
      transactionNumber: string;
    };
    await expect(page.locator('[data-pos-receipt-content]')).toContainText(
      f.admin.name,
    );
    await expect(page.locator('[data-pos-total]')).toHaveText('Rp0');
    await page.evaluate(() => {
      window.print = () => {
        document.documentElement.dataset.qaPrinted = 'yes';
      };
    });
    await page.locator('[data-pos-print-receipt]').click();
    expect(await page.locator('html').getAttribute('data-qa-printed')).toBe(
      'yes',
    );
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('[data-pos-payment-modal]')).toBeHidden();
    await expect(page.locator('[data-pos-variant-modal]')).toBeHidden();
    await expect(page.locator('.pos-topbar')).toBeHidden();
    await expect(page.locator('[data-pos-receipt-modal]')).toBeVisible();
    await page.emulateMedia({ media: 'screen' });
    const item = await f.db
      .select()
      .from(saleItems)
      .where(eq(saleItems.saleId, sale.saleId));
    expect(item).toMatchObject([
      { quantity: 1, costSnapshot: 300000n, lineTotal: 795000n },
    ]);
    expect(
      await f.db
        .select()
        .from(salePayments)
        .where(eq(salePayments.saleId, sale.saleId)),
    ).toMatchObject([
      { amountDue: 795000n, amountTendered: 795000n, changeAmount: 0n },
    ]);
    expect(
      await f.db
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.referenceId, sale.saleId)),
    ).toMatchObject([{ quantityChange: -1 }]);
    expect(
      await f.db
        .select()
        .from(financialTransactions)
        .where(eq(financialTransactions.saleId, sale.saleId)),
    ).toMatchObject([{ amountRupiah: 795000n, status: 'POSTED' }]);
    expect(
      (
        await f.db
          .select()
          .from(productVariants)
          .where(eq(productVariants.id, f.variant.id))
      )[0]!.stockQuantity,
    ).toBe(99);
    await page.goto(base + '/pos/history');
    await expect(
      page.locator('tbody tr').filter({ hasText: sale.transactionNumber }),
    ).toContainText(f.admin.name);
    await page.getByRole('link', { name: 'Receipt', exact: true }).click();
    await page.evaluate(() => {
      window.print = () => {
        document.documentElement.dataset.qaPrinted = 'yes';
      };
    });
    await page
      .getByRole('button', { name: 'Print receipt', exact: true })
      .click();
    expect(await page.locator('html').getAttribute('data-qa-printed')).toBe(
      'yes',
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(base + `/admin/products/${f.product.id}/edit`);
    await page
      .getByRole('button', { name: 'Archive product', exact: true })
      .click();
    await page.goto(base + '/pos');
    await page.locator('[data-pos-search]').fill(f.variant.sku);
    await expect(page.locator('[data-pos-product-grid]')).not.toContainText(
      f.product.name,
    );
    await page.goto(base + `/pos/sales/${sale.saleId}`);
    await expect(page.locator('.pos-receipt-printable')).toContainText(
      f.product.name,
    );
    // A fresh POS-only browser identity never receives Back Office access.
    const posOnly = await browser.newContext();
    await posOnly.addCookies(
      (await page.context().cookies()).filter((c) =>
        c.name.startsWith('lokka_pos'),
      ),
    );
    const isolated = await posOnly.newPage();
    await isolated.goto(base + '/admin/finance/accounting');
    await expect(isolated).toHaveURL(base + '/admin/login');
    await isolated.goto(base + `/admin/media/${images[0]!.id}/source`);
    await expect(isolated).toHaveURL(base + '/admin/login');
    await posOnly.close();
    expect(exceptions).toEqual([]);
    expect(badResponses).toEqual([]);
    expect(
      consoleErrors.filter((message) => !message.includes('404 (Not Found)')),
    ).toEqual([]);
  } finally {
    await app.close();
    const images = (await catalog.relations([f.product.id])).images;
    for (const image of images)
      await storage.removeWithSource(
        image.storageKey,
        image.sourceStorageKey,
        image.sourceFormat,
      );
    await f.cleanup();
  }
});
