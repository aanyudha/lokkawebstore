import { test, expect, chromium } from '@playwright/test';
import { createServer, request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { accountingFixture } from '../helpers/accounting-fixture.js';
import { buildApp } from '../../src/app.js';
import { readEnv } from '../../src/config/env.js';
import { createCatalog } from '../../src/modules/catalog/service.js';
import { LocalCatalogImageStorage } from '../../src/modules/catalog/storage.js';
import {
  categories,
  financialTransactions,
  overheadPeriods,
  productVariants,
  products,
} from '../../src/db/schema/index.js';

const ownerOrigin = 'http://192.168.1.122:3000';
const origins = [ownerOrigin, 'http://127.0.0.1:3000', 'http://localhost:3000'];

for (const publicOrigin of origins) {
  test(`all existing mutation surfaces work from ${publicOrigin}`, async () => {
    test.setTimeout(240000);
    const f = await accountingFixture();
    const run = randomUUID();
    const storage = new LocalCatalogImageStorage(
      `storage/browser/origin-${run}`,
    );
    const catalog = createCatalog(f.db, storage);
    const app = await buildApp(
      readEnv({
        ...process.env,
        APP_RUNTIME: 'fastify',
        DATABASE_URL: f.url,
        NODE_ENV: 'test',
        APP_URL: ownerOrigin,
        PORT: '3031',
        DEV_ALLOWED_ORIGINS: origins.slice(1).join(','),
        CATALOG_STORAGE_ROOT: storage.root,
        TRUST_PROXY: 'false',
      }),
      { database: { ...f.database, close: async () => {} }, logger: false },
    );
    const mutations: {
      path: string;
      origin?: string;
      host?: string;
      status: number;
    }[] = [];
    // A private QA proxy preserves the exact owner-visible browser address,
    // including :3000, and forwards ONLY to this disposable app/database.
    // The marker is asserted before the first POST, preventing accidental use
    // of an owner listener if Chromium's loopback proxy bypass were to change.
    const proxy = createServer((request, response) => {
      const url = new URL(request.url!);
      if (url.origin !== publicOrigin) {
        response.writeHead(403);
        response.end();
        return;
      }
      const upstream = httpRequest(
        {
          hostname: '127.0.0.1',
          port: 3031,
          path: url.pathname + url.search,
          method: request.method,
          headers: request.headers,
          agent: false,
        },
        (reply) => {
          if (request.method === 'POST')
            mutations.push({
              path: url.pathname,
              origin: request.headers.origin,
              host: request.headers.host,
              status: reply.statusCode!,
            });
          response.writeHead(reply.statusCode!, {
            ...reply.headers,
            'x-origin-qa': run,
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
    await app.listen({ host: '127.0.0.1', port: 3031 });
    await new Promise<void>((resolve) =>
      proxy.listen(3032, '127.0.0.1', resolve),
    );
    const browser = await chromium.launch({
      channel: process.platform === 'win32' ? 'chrome' : 'chromium',
      headless: true,
      proxy: { server: 'http://127.0.0.1:3032', bypass: '<-loopback>' },
    });
    const page = await browser.newPage({ serviceWorkers: 'block' });
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(15000);
    const exceptions: string[] = [],
      errors: string[] = [],
      badResponses: string[] = [];
    page.on('pageerror', (error) => exceptions.push(error.message));
    page.on('console', (message) => {
      if (
        message.type() === 'error' &&
        !message.text().includes('404 (Not Found)')
      )
        errors.push(message.text());
    });
    page.on('response', (response) => {
      if (response.status() >= 400 && !response.url().endsWith('/favicon.ico'))
        badResponses.push(`${response.status()} ${response.url()}`);
    });
    let productId: string | undefined;
    const go = async (path: string) => {
      const response = await page.goto(publicOrigin + path);
      expect(response!.headers()['x-origin-qa']).toBe(run);
      expect(response!.status(), path).toBe(200);
    };
    try {
      await go('/admin/login');
      await page.getByLabel('Email', { exact: true }).fill(f.admin.email);
      await page
        .getByLabel('Password', { exact: true })
        .fill('temporary-accounting-password');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page).toHaveURL(publicOrigin + '/admin');
      // Every visible menu resolves; Dashboard and Accounting have GET actions.
      const menu = await page
        .locator('nav[aria-label="Admin"] a')
        .evaluateAll((links) => links.map((a) => a.getAttribute('href')!));
      for (const href of menu) await go(href);

      await go('/admin/categories/new');
      await page.locator('input[name="name"]').fill('Origin QA category');
      await page
        .getByRole('button', { name: 'Save category', exact: true })
        .click();
      const [category] = await f.db
        .select()
        .from(categories)
        .where(eq(categories.name, 'Origin QA category'));
      await go(`/admin/categories/${category!.id}/edit`);
      await page
        .locator('input[name="name"]')
        .fill('Origin QA category updated');
      await page.locator('select[name="status"]').selectOption('active');
      await page
        .getByRole('button', { name: 'Save category', exact: true })
        .click();
      await page.reload();
      await expect(page.locator('main')).toContainText(
        'Origin QA category updated',
      );

      await go('/admin/products/new');
      await page.locator('input[name="name"]').fill('Origin QA item');
      await page
        .locator('select[name="categoryId"]')
        .selectOption(category!.id);
      await page
        .getByRole('button', { name: 'Save product', exact: true })
        .click();
      await expect(page).toHaveURL(/\/products\/[^/]+\/edit$/);
      productId = new URL(page.url()).pathname.split('/')[3]!;
      const variant = page.locator('form.variant-form').last();
      for (const [field, value] of [
        ['name', 'M'],
        ['sku', 'ORIGIN-QA-M'],
        ['price', '795000'],
        ['weightGrams', '300'],
        ['stockQuantity', '5'],
      ])
        await variant.locator(`[name="${field}"]`).fill(value!);
      await variant.locator('[name="status"]').selectOption('active');
      await variant
        .getByRole('button', { name: 'Add variant', exact: true })
        .click();
      const productForm = page.locator(
        `form[action="/admin/products/${productId}"]`,
      );
      await productForm.locator('[name="name"]').fill('Origin QA item updated');
      await productForm.locator('[name="status"]').selectOption('active');
      await productForm
        .getByRole('button', { name: 'Save product', exact: true })
        .click();
      await page.reload();
      await expect(page.locator('input[name="name"]').first()).toHaveValue(
        'Origin QA item updated',
      );
      await productForm.locator('[name="status"]').selectOption('draft');
      await productForm
        .getByRole('button', { name: 'Save product', exact: true })
        .click();
      await page.reload();
      await expect(productForm.locator('[name="status"]')).toHaveValue('draft');
      await productForm.locator('[name="status"]').selectOption('active');
      await productForm
        .getByRole('button', { name: 'Save product', exact: true })
        .click();
      const [savedVariant] = await f.db
        .select()
        .from(productVariants)
        .where(eq(productVariants.productId, productId));
      await go('/admin/inventory');
      const stock = page.locator('tr').filter({ hasText: 'ORIGIN-QA-M' });
      await stock.locator('[name="stockQuantity"]').fill('6');
      await stock.getByRole('button', { name: 'Save', exact: true }).click();
      await page.reload();
      await expect(
        page
          .locator('tr')
          .filter({ hasText: 'ORIGIN-QA-M' })
          .locator('[name="stockQuantity"]'),
      ).toHaveValue('6');

      await go(`/admin/products/${productId}/edit`);
      for (const format of ['png', 'jpeg'] as const) {
        const input = sharp({
          create: { width: 40, height: 60, channels: 3, background: '#d8d2c9' },
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
      }
      const images = (await catalog.relations([productId])).images;
      expect(images).toHaveLength(2);
      const imageForm = page.locator(
        `form[action="/admin/products/${productId}/images/${images[1]!.id}"]`,
      );
      await imageForm.locator('[name="altText"]').fill('Origin QA image');
      await imageForm.locator('[name="isPrimary"]').check();
      await imageForm
        .getByRole('button', { name: 'Save image', exact: true })
        .click();
      await page.reload();
      expect(
        (await catalog.relations([productId])).images.find(
          (i) => i.id === images[1]!.id,
        )!.isPrimary,
      ).toBe(true);
      await go('/admin/media');
      const download = page.waitForEvent('download');
      await page
        .getByRole('link', { name: 'Download original', exact: true })
        .first()
        .click();
      expect((await download).suggestedFilename()).toMatch(/\.(png|jpg)$/);
      await go(`/admin/products/${productId}/edit`);
      for (const image of images)
        await page
          .locator(
            `form[action="/admin/products/${productId}/images/${image.id}/delete"]`,
          )
          .getByRole('button', { name: 'Delete image', exact: true })
          .click();
      await page.reload();
      expect((await catalog.relations([productId])).images).toHaveLength(0);

      await go(`/admin/products/${productId}/pricing`);
      const direct = page.locator(
        `form[action="/admin/products/${productId}/costs"]`,
      );
      await direct.locator('[name="name"]').fill('Origin unit material');
      await direct.locator('[name="amountRupiah"]').fill('300000');
      await direct
        .getByRole('button', { name: 'Save direct cost', exact: true })
        .click();
      const pricing = page.locator(
        `form[action="/admin/products/${productId}/pricing"]`,
      );
      await pricing.locator('[name="profitPercent"]').fill('20');
      await pricing
        .getByRole('button', { name: 'Save pricing profile', exact: true })
        .click();
      await page.reload();
      await expect(page.locator('main')).toContainText('Rp300.000');

      await go('/admin/finance/overhead');
      const globalCost = page.locator(
        'form[action="/admin/finance/overhead/costs"]',
      );
      await globalCost.locator('[name="name"]').fill('Origin planned rent');
      await globalCost.locator('[name="amountRupiah"]').fill('100000');
      await globalCost
        .locator('[name="startDate"]')
        .fill(new Date().toISOString().slice(0, 10));
      await globalCost
        .getByRole('button', { name: 'Add global cost', exact: true })
        .click();
      await page
        .locator('details')
        .filter({ hasText: 'Origin planned rent' })
        .first()
        .locator('summary')
        .click();
      const savedCost = page.locator('form[action*="/overhead/costs/"]');
      await savedCost.locator('[name="amountRupiah"]').fill('150000');
      await savedCost
        .getByRole('button', { name: 'Save for future periods', exact: true })
        .click();
      const open = page.locator(
        'form[action="/admin/finance/overhead/periods"]',
      );
      await open
        .locator('[name="periodMonth"]')
        .fill(new Date().toISOString().slice(0, 7));
      await open.locator('[name="forecastUnitsRemaining"]').fill('10');
      await open
        .getByRole('button', {
          name: 'Open period and snapshot costs',
          exact: true,
        })
        .click();
      const [period] = await f.db.select().from(overheadPeriods);
      const forecast = page.locator(`form[action$="/${period!.id}/forecast"]`);
      await forecast.locator('[name="forecastUnitsRemaining"]').fill('20');
      await forecast
        .getByRole('button', { name: 'Update forecast', exact: true })
        .click();
      for (const action of ['adjustment', 'recovery']) {
        const form = page.locator(`form[action$="/${period!.id}/${action}"]`);
        await form.locator('[name="amountRupiah"]').fill('1000');
        await form.locator('[name="notes"]').fill(`QA ${action}`);
        await form.getByRole('button').click();
      }
      const close = page.locator(`form[action$="/${period!.id}/close"]`);
      await close.getByRole('checkbox').check();
      await close
        .getByRole('button', { name: 'Close period', exact: true })
        .click();
      await page.reload();
      await expect(page.locator('main')).toContainText('CLOSED');
      expect(await f.db.select().from(financialTransactions)).toHaveLength(0);

      await go('/admin/settings/fulfillment');
      const originForm = page.locator(
        'form[action="/admin/settings/fulfillment"]',
      );
      for (const [field, value] of [
        ['name', 'Origin QA dispatch'],
        ['contactName', 'QA'],
        ['phone', '+628000000000'],
        ['addressLine1', 'QA address'],
        ['district', 'QA district'],
        ['city', 'QA city'],
        ['province', 'QA province'],
        ['postalCode', '12345'],
      ])
        await originForm.locator(`[name="${field}"]`).fill(value!);
      await originForm
        .getByRole('button', { name: 'Save fulfillment origin', exact: true })
        .click();
      await page.locator('details').first().locator('summary').click();
      const savedOrigin = page.locator(
        'form[action*="/settings/fulfillment/"]',
      );
      await savedOrigin.locator('[name="city"]').fill('Updated QA city');
      await savedOrigin
        .getByRole('button', { name: 'Save fulfillment origin', exact: true })
        .click();
      await page.reload();
      await expect(
        page.locator('form[action*="/settings/fulfillment/"] [name="city"]'),
      ).toHaveValue('Updated QA city');

      await go('/admin/finance/cash-flow');
      const opening = page.locator(
        'form[action="/admin/finance/opening-balance"]',
      );
      await opening.locator('[name="amountRupiah"]').fill('1000000');
      await opening
        .locator('[name="occurredAt"]')
        .fill(new Date(Date.now() - 86400000).toISOString().slice(0, 16));
      await opening
        .getByRole('button', { name: 'Record opening balance', exact: true })
        .click();
      await page.reload();
      await expect(page.locator('[data-cash-opening]')).toHaveText(
        'Rp1.000.000',
      );
      for (const [direction, category, amount, note] of [
        ['INCOME', 'OTHER_INCOME', '25000', 'Origin QA cash-only income'],
        ['EXPENSE', 'PACKAGING', '50000', 'Origin QA expense'],
      ]) {
        await go('/admin/finance/income-expense');
        await page.locator('select[name="direction"]').selectOption(direction!);
        await page.locator('select[name="category"]').selectOption(category!);
        await page.locator('[name="amountRupiah"]').fill(amount!);
        await page
          .locator('[name="occurredAt"]')
          .fill(new Date().toISOString().slice(0, 16));
        await page.locator('[name="notes"]').fill(note!);
        await page
          .getByRole('button', { name: 'Save transaction', exact: true })
          .click();
        await page.reload();
        await expect(page.locator('main')).toContainText(note!);
      }

      await go('/pos/login');
      await page.getByLabel('Email', { exact: true }).fill(f.admin.email);
      await page
        .getByLabel('Password', { exact: true })
        .fill('temporary-accounting-password');
      await page
        .getByRole('button', { name: 'Sign in to POS', exact: true })
        .click();
      await expect(page).toHaveURL(publicOrigin + '/pos');
      await page.locator('[data-pos-search]').fill('ORIGIN-QA-M');
      const card = page
        .locator('[data-pos-product-grid] article')
        .filter({ hasText: 'Origin QA item updated' });
      await expect(card).toBeVisible();
      await card.click();
      page.once('dialog', (dialog) => dialog.accept());
      await page.locator('[data-pos-cancel]').click();
      await expect(page.locator('[data-pos-total]')).toHaveText('Rp0');
      await card.click();
      await page.locator('[data-pos-pay]').click();
      await page.locator('[data-pos-exact-cash]').click();
      const completed = page.waitForResponse(
        (r) =>
          r.url().endsWith('/pos/api/sales') && r.request().method() === 'POST',
      );
      await page.locator('[data-pos-complete-sale]').click();
      const saleResponse = await completed;
      expect(saleResponse.status()).toBe(200);
      const sale = (await saleResponse.json()) as {
        transactionNumber: string;
        saleId: string;
      };
      await expect(page.locator('[data-pos-receipt-content]')).toContainText(
        sale.transactionNumber,
      );
      await page.reload();
      await expect(card).toContainText('Stock: 5');
      expect(
        (
          await f.db
            .select()
            .from(productVariants)
            .where(eq(productVariants.id, savedVariant!.id))
        )[0]!.stockQuantity,
      ).toBe(5);
      expect(
        await f.db
          .select()
          .from(financialTransactions)
          .where(eq(financialTransactions.saleId, sale.saleId)),
      ).toMatchObject([{ amountRupiah: 795000n }]);
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await expect(page).toHaveURL(publicOrigin + '/pos/login');

      await go('/admin/finance/accounting');
      await expect(page.locator('[data-accounting-revenue]')).toHaveText(
        'Rp795.000',
      );
      await expect(page.locator('[data-accounting-cogs]')).toHaveText(
        'Rp300.000',
      );
      await expect(page.locator('[data-accounting-net]')).toHaveText(
        'Rp445.000',
      );
      await expect(
        page.getByRole('region', { name: 'Contributing sales', exact: true }),
      ).toContainText(sale.transactionNumber);
      await page.getByRole('link', { name: 'This month', exact: true }).click();
      await page.getByLabel('From', { exact: true }).fill('2099-01-01');
      await page.getByLabel('To', { exact: true }).fill('2099-01-31');
      await page
        .getByRole('button', { name: 'Apply range', exact: true })
        .click();
      await expect(page.locator('[data-accounting-revenue]')).toHaveText('Rp0');
      await page.getByRole('link', { name: 'Today', exact: true }).click();
      await page
        .getByRole('link', {
          name: 'Review expense history and void audit',
          exact: true,
        })
        .click();
      const expenseRow = page
        .locator('tr[data-manual-status="POSTED"]')
        .filter({ hasText: 'Origin QA expense' });
      await expenseRow.locator('[name="reason"]').fill('Origin QA void');
      await expenseRow
        .getByRole('button', { name: 'Void entry', exact: true })
        .click();
      await page.reload();
      await expect(
        page.locator('tr[data-manual-status="VOIDED"]'),
      ).toContainText('Origin QA void');
      await go('/admin/finance/accounting');
      await expect(page.locator('[data-accounting-net]')).toHaveText(
        'Rp495.000',
      );
      await go('/admin/finance/cash-flow');
      await expect(page.locator('[data-cash-ending]')).toHaveText(
        'Rp1.820.000',
      );

      await go(`/admin/products/${productId}/pricing`);
      await page.locator('details').first().locator('summary').click();
      const savedDirect = page
        .locator('form[action*="/costs/"]')
        .filter({ has: page.locator('input[name="amountRupiah"]') });
      await savedDirect.locator('[name="amountRupiah"]').fill('350000');
      await savedDirect
        .getByRole('button', { name: 'Save direct cost', exact: true })
        .click();
      await go('/admin/finance/accounting');
      await expect(page.locator('[data-accounting-cogs]')).toHaveText(
        'Rp300.000',
      );
      await go(`/admin/products/${productId}/pricing`);
      await page.locator('details').first().locator('summary').click();
      await page
        .getByRole('button', { name: 'Remove direct cost', exact: true })
        .click();
      await page.reload();
      await expect(page.locator('main')).toContainText('Rp0');
      await go(`/admin/products/${productId}/edit`);
      const savedVariantForm = page.locator(
        `form[action="/admin/products/${productId}/variants/${savedVariant!.id}"]`,
      );
      await savedVariantForm.locator('[name="price"]').fill('895000');
      await savedVariantForm
        .getByRole('button', { name: 'Save variant', exact: true })
        .click();
      await page.reload();
      await expect(savedVariantForm.locator('[name="price"]')).toHaveValue(
        '895000',
      );
      await page
        .getByRole('button', { name: 'Archive product', exact: true })
        .click();
      expect(
        (
          await f.db.select().from(products).where(eq(products.id, productId))
        )[0]!.status,
      ).toBe('archived');

      for (const locale of ['en', 'id']) {
        const base = locale === 'en' ? '/account' : '/id/akun';
        const register =
          locale === 'en' ? `${base}/register` : `${base}/daftar`;
        const login = locale === 'en' ? `${base}/login` : `${base}/masuk`;
        const profile = locale === 'en' ? `${base}/profile` : `${base}/profil`;
        const passwordPath =
          locale === 'en' ? `${base}/password` : `${base}/kata-sandi`;
        const email = `origin-${locale}@example.test`;
        await go(register);
        const registration = page.locator(`form[action="${register}"]`);
        for (const [field, value] of [
          ['name', 'Origin QA customer'],
          ['email', email],
          ['password', 'temporary-origin-password'],
          ['confirmPassword', 'temporary-origin-password'],
        ])
          await registration.locator(`[name="${field}"]`).fill(value!);
        await registration.locator('button[type="submit"]').click();
        await expect(page).toHaveURL(publicOrigin + base);
        await go(profile);
        await page
          .locator('form [name="name"]')
          .fill('Origin customer updated');
        await page.locator('main form button[type="submit"]').click();
        await page.reload();
        await expect(page.locator('main input[name="name"]')).toHaveValue(
          'Origin customer updated',
        );
        await go(passwordPath);
        await page
          .locator('[name="currentPassword"]')
          .fill('temporary-origin-password');
        await page
          .locator('[name="newPassword"]')
          .fill('temporary-origin-password-updated');
        await page
          .locator('[name="confirmPassword"]')
          .fill('temporary-origin-password-updated');
        await page.locator('main form button[type="submit"]').click();
        await go(base);
        await page
          .locator(
            `form[action="${locale === 'en' ? '/account/logout' : '/id/akun/keluar'}"] button`,
          )
          .click();
        await go(login);
        await page.locator('main [name="email"]').fill(email);
        await page
          .locator('main [name="password"]')
          .fill('temporary-origin-password-updated');
        await page.locator('main form button[type="submit"]').click();
        await expect(page).toHaveURL(publicOrigin + base);
        await page
          .locator(
            `form[action="${locale === 'en' ? '/account/logout' : '/id/akun/keluar'}"] button`,
          )
          .click();
      }
      await go('/admin');
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await expect(page).toHaveURL(publicOrigin + '/admin/login');
      expect(mutations.length).toBeGreaterThan(30);
      expect(
        mutations.every(
          (m) =>
            m.status < 400 &&
            m.origin === publicOrigin &&
            m.host === new URL(publicOrigin).host,
        ),
      ).toBe(true);
      expect(exceptions).toEqual([]);
      expect(errors).toEqual([]);
      expect(badResponses).toEqual([]);
      await test.info().attach('origin-actions', {
        body: JSON.stringify(mutations, null, 2),
        contentType: 'application/json',
      });
    } finally {
      await browser.close();
      proxy.closeAllConnections();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
      await app.close();
      if (productId)
        for (const image of (await catalog.relations([productId])).images)
          await storage.removeWithSource(
            image.storageKey,
            image.sourceStorageKey,
            image.sourceFormat,
          );
      await f.cleanup();
    }
  });
}
