import { test, expect, chromium } from '@playwright/test';
import { createServer, request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { storefrontNavigationFixture } from '../helpers/storefront-navigation-fixture.js';
import { buildApp } from '../../src/app.js';
import { readEnv } from '../../src/config/env.js';

test('storefront categories and authenticated customer identity stay consistent on the LAN origin', async () => {
  test.setTimeout(180000);
  const f = await storefrontNavigationFixture();
  const base = 'http://192.168.1.122:3000',
    marker = randomUUID();
  const app = await buildApp(
    readEnv({
      ...process.env,
      APP_RUNTIME: 'fastify',
      NODE_ENV: 'test',
      DATABASE_URL: f.url,
      APP_URL: base,
      PORT: '3047',
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
        port: 3047,
        path: url.pathname + url.search,
        method: request.method,
        headers: request.headers,
        agent: false,
      },
      (reply) => {
        response.writeHead(reply.statusCode!, {
          ...reply.headers,
          'x-navigation-qa': marker,
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
  await app.listen({ host: '127.0.0.1', port: 3047 });
  await new Promise<void>((resolve) =>
    proxy.listen(3048, '127.0.0.1', resolve),
  );
  const browser = await chromium.launch({
    channel: process.platform === 'win32' ? 'chrome' : 'chromium',
    headless: true,
    proxy: { server: 'http://127.0.0.1:3048', bypass: '<-loopback>' },
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'block',
  });
  const errors: string[] = [],
    bad: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico'))
      errors.push(m.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().endsWith('/favicon.ico'))
      bad.push(`${r.status()} ${r.url()}`);
  });
  const go = async (path: string) => {
    const response = await page.goto(base + path);
    expect(response?.headers()['x-navigation-qa']).toBe(marker);
    expect(response?.status()).toBe(200);
  };
  const account = page.locator('.header-actions > .header-account');
  const categories = page.locator('.main-nav a');
  try {
    await go('/');
    await expect(categories).toHaveText(['First category', 'Ready to Wear']);
    await expect(account).toHaveText('Sign in');
    await expect(account).toHaveAttribute('href', '/account/login');
    await page.screenshot({
      path: 'test-results/navigation-en-logged-out.png',
      fullPage: false,
    });
    await page
      .getByRole('link', { name: 'Explore collections', exact: true })
      .click();
    await expect(page).toHaveURL(base + '/collections');
    await expect(categories).toHaveText(['First category', 'Ready to Wear']);
    await go('/id/collections');
    await expect(page).toHaveURL(base + '/id/koleksi');
    await expect(categories).toHaveText([
      'ID First category',
      'Busana Siap Pakai',
    ]);
    await expect(account).toHaveText('Masuk');
    await go('/account/login');
    await page
      .getByLabel('Email address', { exact: true })
      .fill('diego@example.test');
    await page
      .getByLabel('Password', { exact: true })
      .fill('temporary-customer-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(base + '/account');
    await go('/');
    await expect(account).toHaveText('Diego');
    await expect(account).toHaveAttribute('href', '/account');
    await page.screenshot({
      path: 'test-results/navigation-en-logged-in.png',
      fullPage: false,
    });
    await account.click();
    await expect(page).toHaveURL(base + '/account');
    await page
      .locator('.lang-switcher')
      .getByRole('link', { name: 'ID', exact: true })
      .click();
    await expect(page).toHaveURL(base + '/id/akun');
    await expect(account).toHaveText('Diego');
    await expect(account).toHaveAttribute('href', '/id/akun');
    await page
      .locator('.main-nav')
      .getByRole('link', { name: 'Busana Siap Pakai', exact: true })
      .click();
    await expect(page).toHaveURL(base + '/id/kategori/siap-pakai');
    for (const path of [
      '/collections',
      '/category/ready-to-wear',
      `/product/${f.product.slug}`,
      '/id/koleksi',
      '/id/kategori/siap-pakai',
      `/id/produk/${f.product.slug}`,
      '/account/profile',
      '/id/akun/profil',
    ]) {
      await go(path);
      await expect(account).toHaveText('Diego');
      await expect(categories).toHaveCount(2);
    }
    const longName = 'Diego ' + 'Nusantara '.repeat(14).trim();
    await f.auth.updateName(f.customer.customer.id, longName);
    for (const width of [1440, 1024, 768, 430, 390, 375, 360]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ['/', '/id']) {
        await go(path);
        await expect(account).toHaveText(longName);
        await expect(account).toHaveAttribute('title', longName);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        const nameBox = (await account.boundingBox())!,
          languageBox = (await page.locator('.lang-switcher').boundingBox())!;
        expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(languageBox.x);
        expect(
          await account.evaluate((el) => getComputedStyle(el).textOverflow),
        ).toBe('ellipsis');
        if (width < 768) {
          await page.locator('[data-menu-toggle]').click();
          await expect(page.locator('#mobile-drawer')).toBeVisible();
          await expect(
            page.locator('#mobile-drawer .header-account'),
          ).toHaveText(longName);
          await expect(page.locator('#mobile-drawer > nav > a')).toHaveCount(2);
          await page.locator('[data-menu-toggle]').press('Escape');
          await expect(page.locator('#mobile-drawer')).toBeHidden();
        }
      }
      await page.screenshot({
        path: `test-results/navigation-long-name-${width}.png`,
        fullPage: false,
      });
    }
    expect(errors).toEqual([]);
    expect(bad).toEqual([]);
  } finally {
    await browser.close();
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    await app.close();
    await f.cleanup();
  }
});
