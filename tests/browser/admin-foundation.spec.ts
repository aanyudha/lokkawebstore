import { test, expect } from '@playwright/test';
import { commercialDatabase } from '../helpers/commercial-database.js';
import { buildApp } from '../../src/app.js';
import { readEnv } from '../../src/config/env.js';
import { adminUsers, vendors } from '../../src/db/schema/index.js';
import { hashPassword } from '../../src/modules/auth/service.js';
import { createCatalog } from '../../src/modules/catalog/service.js';
import { LocalCatalogImageStorage } from '../../src/modules/catalog/storage.js';

test('office shell, responsive drawer, keyboard access and public isolation', async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  const fixture = await commercialDatabase();
  const db = fixture.database.db;
  const catalog = createCatalog(
    db,
    new LocalCatalogImageStorage('storage/browser/admin-foundation'),
  );
  await db
    .insert(vendors)
    .values({ slug: 'lokka', name: 'LOKKA', status: 'active' });
  await db.insert(adminUsers).values({
    email: 'office@example.test',
    name: 'LOKKA verification',
    passwordHash: await hashPassword('office-browser-password'),
  });
  const product = await catalog.saveProduct({
    name: 'Office verification product',
    status: 'draft',
  });
  const category = await catalog.saveCategory({
    name: 'Office verification category',
    status: 'hidden',
  });
  const env = readEnv({
    ...process.env,
    APP_RUNTIME: 'fastify',
    DATABASE_URL: fixture.url,
    NODE_ENV: 'test',
    PORT: '3013',
    APP_URL: 'http://127.0.0.1:3013',
  });
  const app = await buildApp(env, {
    database: { ...fixture.database, close: async () => {} },
    logger: false,
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const widths = [1440, 1280, 1024, 768, 430, 390, 375];
  const check = async (name: string, path: string, width: number) => {
    const response = await page.goto(env.appUrl + path);
    expect(response?.status(), path).toBe(200);
    await expect(page.locator('main h1')).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `${path} at ${width}`,
    ).toBe(true);
    await page.screenshot({
      path: `test-results/office-${name}-${width}.png`,
      fullPage: true,
    });
  };
  try {
    await app.listen({ host: '127.0.0.1', port: 3013 });
    for (const endpoint of ['/health', '/ready', '/api/v1/version'])
      expect((await page.request.get(env.appUrl + endpoint)).status()).toBe(
        200,
      );
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      await check('login', '/admin/login', width);
    }
    await expect(page.locator('.site-header,.site-footer')).toHaveCount(0);
    await page.getByLabel('Email', { exact: true }).fill('office@example.test');
    await page
      .getByLabel('Password', { exact: true })
      .fill('office-browser-password');
    await page.getByRole('button', { name: 'Show', exact: true }).click();
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
      'type',
      'text',
    );
    await page.getByRole('button', { name: 'Hide', exact: true }).click();
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(env.appUrl + '/admin');
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      for (const [name, path] of [
        ['dashboard', '/admin'],
        ['products', '/admin/products'],
        ['categories', '/admin/categories'],
        ['inventory', '/admin/inventory'],
        ['media', '/admin/media'],
        ['product', `/admin/products/${product.id}/edit`],
        ['category', `/admin/categories/${category.id}/edit`],
        ['pricing', `/admin/products/${product.id}/pricing`],
        ['overhead', '/admin/finance/overhead'],
        ['accounting', '/admin/finance/accounting'],
        ['fulfillment', '/admin/settings/fulfillment'],
      ])
        await check(name!, path!, width);
      if (width < 1024) {
        const trigger = page.getByRole('button', { name: 'Menu', exact: true });
        const drawer = page.locator('#admin-sidebar');
        await expect(drawer).toBeHidden();
        await trigger.focus();
        await page.keyboard.press('Enter');
        await expect(trigger).toHaveAttribute('aria-expanded', 'true');
        await expect(drawer).toHaveAttribute('role', 'dialog');
        await expect(
          drawer.getByRole('button', { name: 'Close navigation' }),
        ).toBeFocused();
        expect(
          await page
            .locator('body')
            .evaluate((el) => getComputedStyle(el).overflow),
        ).toBe('hidden');
        const first = drawer.locator('a').first(),
          last = drawer.locator('a').last();
        await first.focus();
        await page.keyboard.press('Shift+Tab');
        await expect(last).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(first).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(trigger).toBeFocused();
        await expect(drawer).toBeHidden();
        await trigger.click();
        await page
          .locator('[data-drawer-backdrop]')
          .click({ position: { x: width - 8, y: 250 } });
        await expect(drawer).toBeHidden();
        await trigger.click();
        await drawer.getByRole('button', { name: 'Close navigation' }).click();
        await expect(trigger).toBeFocused();
      } else
        await expect(
          page.getByRole('navigation', { name: 'Admin', exact: true }),
        ).toBeVisible();
    }
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(env.appUrl + `/admin/products/${product.id}/pricing`);
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await expect(page.locator('.sidebar-link[aria-current="page"]')).toHaveText(
      'Products',
    );
    await page.keyboard.press('Escape');
    await expect(
      page
        .getByRole('navigation', { name: 'Breadcrumb' })
        .getByRole('link', { name: 'Edit product' }),
    ).toHaveAttribute('href', `/admin/products/${product.id}/edit`);
    await page.goto(env.appUrl + '/admin/products/new');
    await page.getByLabel('Name', { exact: true }).focus();
    expect(
      await page
        .getByLabel('Name', { exact: true })
        .evaluate((el) => getComputedStyle(el).outlineStyle),
    ).not.toBe('none');
    await page.goto(env.appUrl + '/admin');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(env.appUrl + '/admin/login');
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of [
        '/',
        '/id',
        '/collections',
        '/id/koleksi',
        '/account/login',
        '/account/register',
        '/id/akun/masuk',
        '/id/akun/daftar',
      ]) {
        expect((await page.goto(env.appUrl + path))?.status()).toBe(200);
        await expect(page.locator('.site-header')).toBeVisible();
        expect(
          await page.locator('link[rel="stylesheet"]').getAttribute('href'),
        ).toContain('/build/main.');
        await expect(page.locator('[data-admin-layout]')).toHaveCount(0);
      }
    }
    const noJs = await browser.newContext({ javaScriptEnabled: false });
    const ssr = await noJs.newPage();
    await ssr.goto(env.appUrl + '/admin/login');
    await expect(ssr.getByLabel('Email', { exact: true })).toBeVisible();
    await ssr.getByLabel('Email', { exact: true }).fill('office@example.test');
    await ssr
      .getByLabel('Password', { exact: true })
      .fill('office-browser-password');
    await ssr.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(ssr).toHaveURL(env.appUrl + '/admin');
    await expect(
      ssr.getByRole('navigation', { name: 'Admin', exact: true }),
    ).toBeVisible();
    await noJs.close();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});
