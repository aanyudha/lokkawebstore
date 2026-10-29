import { test, expect, chromium } from '@playwright/test';
import { createServer, request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { accountingFixture } from '../helpers/accounting-fixture.js';
import { buildApp } from '../../src/app.js';
import { readEnv } from '../../src/config/env.js';
import { createCatalog } from '../../src/modules/catalog/service.js';
import { LocalCatalogImageStorage } from '../../src/modules/catalog/storage.js';
import { createHomepageHero } from '../../src/modules/storefront/hero.js';

test('homepage hero upload, replacement, fallback and product media at the owner LAN address', async () => {
  test.setTimeout(180000);
  const f = await accountingFixture();
  const marker = randomUUID();
  const storage = new LocalCatalogImageStorage(
    `storage/browser/hero-${marker}`,
  );
  const catalog = createCatalog(f.db, storage);
  const hero = createHomepageHero(f.db, storage);
  const base = 'http://192.168.1.122:3000';
  const app = await buildApp(
    readEnv({
      ...process.env,
      APP_RUNTIME: 'fastify',
      NODE_ENV: 'test',
      DATABASE_URL: f.url,
      APP_URL: base,
      HOST: '127.0.0.1',
      PORT: '3026',
      CATALOG_STORAGE_ROOT: storage.root,
    }),
    { database: { ...f.database, close: async () => {} }, logger: false },
  );
  const proxy = createServer((request, response) => {
    const url = new URL(request.url!);
    if (url.origin !== base) {
      response.writeHead(403);
      response.end();
      return;
    }
    const upstream = httpRequest(
      {
        hostname: '127.0.0.1',
        port: 3026,
        path: url.pathname + url.search,
        method: request.method,
        headers: request.headers,
        agent: false,
      },
      (reply) => {
        response.writeHead(reply.statusCode!, {
          ...reply.headers,
          'x-hero-qa': marker,
        });
        reply.pipe(response);
      },
    );
    upstream.on('error', () => {
      response.writeHead(502);
      response.end();
    });
    request.pipe(upstream);
  });
  await app.listen({ host: '127.0.0.1', port: 3026 });
  await new Promise<void>((resolve) =>
    proxy.listen(3027, '127.0.0.1', resolve),
  );
  const browser = await chromium.launch({
    channel: process.platform === 'win32' ? 'chrome' : 'chromium',
    headless: true,
    proxy: { server: 'http://127.0.0.1:3027', bypass: '<-loopback>' },
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: 'block',
  });
  const errors: string[] = [],
    bad: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('404 (Not Found)'))
      errors.push(m.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().endsWith('/favicon.ico'))
      bad.push(`${r.status()} ${r.url()}`);
  });
  const go = async (path: string) => {
    const r = await page.goto(base + path);
    expect(r!.headers()['x-hero-qa']).toBe(marker);
    expect(r!.status()).toBe(200);
  };
  const png = await sharp({
    create: { width: 1800, height: 1200, channels: 3, background: '#ab7755' },
  })
    .png()
    .toBuffer();
  const jpg = await sharp({
    create: { width: 1200, height: 1800, channels: 3, background: '#5577ab' },
  })
    .jpeg()
    .toBuffer();
  try {
    for (const locale of ['en', 'id'])
      await catalog.saveProductTranslation(f.product.id, locale, {
        name: f.product.name,
        slug: f.product.slug,
      });
    await catalog.addImages(f.product.id, [jpg], 'Product fabric');
    const productImage = (await catalog.relations([f.product.id])).images[0]!;
    await go('/');
    expect(await page.locator('.hero-visual img').count()).toBe(0);
    await expect(page.locator('.hero-placeholder')).toBeVisible();
    await go('/admin/login');
    await page.getByLabel('Email', { exact: true }).fill(f.admin.email);
    await page
      .getByLabel('Password', { exact: true })
      .fill('temporary-accounting-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('link', { name: 'Homepage', exact: true }).click();
    await page
      .locator('input[name=image]')
      .setInputFiles({ name: 'hero.png', mimeType: 'image/png', buffer: png });
    await page
      .getByLabel('Hero alt text', { exact: true })
      .fill('LOKKA heritage fabric');
    await page
      .getByRole('button', { name: 'Save homepage hero', exact: true })
      .click();
    const first = (await hero.publicImage())!;
    for (const path of ['/', '/id']) {
      await go(path);
      const image = page.locator('.hero-image');
      await expect(image).toBeVisible();
      expect(
        await image.evaluate(
          (i: HTMLImageElement) => i.complete && i.naturalWidth > 0,
        ),
      ).toBe(true);
      await expect(image).toHaveAttribute('alt', 'LOKKA heritage fabric');
      expect(
        await page.evaluate(
          async (url) => (await fetch(url)).status,
          first.src,
        ),
      ).toBe(200);
      for (const width of [1440, 820, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        if (width >= 700) {
          await expect(image).toBeVisible();
          expect(
            await image.evaluate((i) => getComputedStyle(i).objectFit),
          ).toBe('cover');
        } else await expect(image).toBeHidden(); // Existing mobile layout intentionally hides the hero visual.
        await page.screenshot({
          path: `test-results/hero-${path === '/id' ? 'id' : 'en'}-${width}.png`,
          fullPage: true,
        });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await go('/admin/settings/homepage');
    await page.locator('input[name=image]').setInputFiles({
      name: 'replacement.jpg',
      mimeType: 'image/jpeg',
      buffer: jpg,
    });
    await page
      .getByLabel('Hero alt text', { exact: true })
      .fill('Replacement heritage image');
    await page
      .getByRole('button', { name: 'Save homepage hero', exact: true })
      .click();
    const replacement = (await hero.publicImage())!;
    expect(replacement.src).not.toBe(first.src);
    await go('/');
    await page.reload();
    await expect(page.locator('.hero-image')).toHaveAttribute(
      'src',
      replacement.src,
    );
    expect(
      await page
        .locator('.hero-image')
        .evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0),
    ).toBe(true);
    for (const path of ['/collections', `/product/${f.product.slug}`]) {
      await go(path);
      const image = page.locator(
        `img[src="${storage.url(productImage.storageKey, 'card')}"]`,
      );
      if (path === '/collections') await expect(image).toBeVisible();
      expect(
        await page.evaluate(
          async (url) => (await fetch(url)).status,
          storage.url(productImage.storageKey, 'detail'),
        ),
      ).toBe(200);
    }
    await go('/admin/media');
    await expect(page.locator('main img').first()).toBeVisible();
    await go('/pos/login');
    await page.getByLabel('Email', { exact: true }).fill(f.admin.email);
    await page
      .getByLabel('Password', { exact: true })
      .fill('temporary-accounting-password');
    await page
      .getByRole('button', { name: 'Sign in to POS', exact: true })
      .click();
    await expect(
      page.locator('[data-pos-product-grid] img').first(),
    ).toBeVisible();
    expect(
      await page
        .locator('[data-pos-product-grid] img')
        .first()
        .evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0),
    ).toBe(true);
    await go('/admin/settings/homepage');
    await page
      .getByRole('button', { name: 'Remove homepage hero', exact: true })
      .click();
    for (const path of ['/', '/id']) {
      await go(path);
      await expect(page.locator('.hero-placeholder')).toBeVisible();
      expect(await page.locator('.hero-image').count()).toBe(0);
    }
    expect(errors).toEqual([]);
    expect(bad).toEqual([]);
  } finally {
    await browser.close();
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    await app.close();
    await hero.clear();
    for (const image of (await catalog.relations([f.product.id])).images)
      await storage.removeWithSource(
        image.storageKey,
        image.sourceStorageKey,
        image.sourceFormat,
      );
    await f.cleanup();
  }
});
