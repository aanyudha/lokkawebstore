import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { buildApp } from '../../src/app.js';
import { readEnv } from '../../src/config/env.js';
import {
  financialTransactions,
  inventoryMovements,
  orders,
  paymentAttempts,
  sales,
} from '../../src/db/schema/index.js';
import { resolvePeriod } from '../../src/modules/finance/ledger.js';
import { dokuNotificationPath } from '../../src/modules/payments/config.js';
import {
  configureCheckoutShipping,
  sampleAddress,
} from '../helpers/checkout-fixture.js';
import { dokuFixture, signedHeaders } from '../helpers/doku-fixture.js';
import { storefrontNavigationFixture } from '../helpers/storefront-navigation-fixture.js';

test('checkout starts hosted payment and only a verified notification confirms the order', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const f = await storefrontNavigationFixture();
  const base = 'http://127.0.0.1:3052';
  const hostedOrigin = 'https://sandbox.doku.com';
  const hosted = new Map<string, string>();
  const amounts: number[] = [];
  const app = await buildApp(
    readEnv({
      ...process.env,
      DATABASE_URL: f.url,
      APP_URL: base,
      NODE_ENV: 'test',
      APP_RUNTIME: 'fastify',
      PAYMENT_PROVIDER: 'doku',
      DOKU_ENV: 'sandbox',
      DOKU_CLIENT_ID: dokuFixture.clientId,
      DOKU_SECRET_KEY: dokuFixture.secretKey,
      DOKU_NOTIFICATION_URL: dokuFixture.notificationUrl,
    }),
    {
      database: { ...f.database, close: async () => {} },
      logger: false,
      async paymentFetch(url, options) {
        expect(url).toBe('https://api-sandbox.doku.com/checkout/v1/payment');
        const sent = JSON.parse(String(options?.body)).order;
        amounts.push(sent.amount);
        const checkoutUrl =
          hostedOrigin + '/checkout-link-v2/' + amounts.length;
        hosted.set(checkoutUrl, sent.callback_url);
        return Response.json({
          message: ['SUCCESS'],
          response: {
            order: {
              invoice_number: sent.invoice_number,
              amount: sent.amount,
              session_id: randomUUID(),
            },
            payment: {
              url: checkoutUrl,
              expired_date: new Date(Date.now() + 8 * 3_600_000)
                .toISOString()
                .slice(0, 19)
                .replace(/\D/g, ''),
            },
          },
        });
      },
    },
  );
  const pageErrors: string[] = [];
  const failedAssets: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      message.text().includes('Content Security Policy')
    )
      pageErrors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico'))
      failedAssets.push(response.url());
  });
  try {
    await configureCheckoutShipping(f.db, f.catalog);
    await app.listen({ host: '127.0.0.1', port: 3052 });
    await page.route(hostedOrigin + '/**', async (route) => {
      if (new URL(route.request().url()).pathname === '/favicon.ico') {
        await route.fulfill({ status: 204 });
        return;
      }
      const destination = hosted.get(route.request().url());
      expect(destination).toBeDefined();
      await route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><title>Hosted checkout fixture</title><a href="${destination}?status=SUCCESS">Return to LOKKA</a>`,
      });
    });
    await page.goto(base + '/account/login');
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
    await page.goto(base + '/product/' + f.product.slug);
    await page
      .getByRole('button', { name: 'Add to cart', exact: true })
      .click();
    await page.getByRole('link', { name: 'Checkout', exact: true }).click();
    for (const [label, value] of [
      ['Recipient name', sampleAddress.recipientName],
      ['Phone number', sampleAddress.phone],
      ['Address line 1', sampleAddress.addressLine1],
      ['City or regency', sampleAddress.city],
      ['Province', sampleAddress.province],
      ['Postal code', sampleAddress.postalCode],
    ] as const)
      await page.getByLabel(label, { exact: true }).fill(value);
    await page
      .getByRole('button', { name: 'Save address', exact: true })
      .click();
    await page
      .getByRole('combobox', { name: 'Select shipping address' })
      .selectOption({ index: 0 });
    await page
      .getByRole('combobox', { name: 'Shipping method' })
      .selectOption({ index: 0 });
    await page
      .getByRole('button', { name: 'Review order', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Place order', exact: true })
      .click();
    await expect(page.locator('[data-order-status]')).toHaveText(
      'Pending payment',
    );
    await expect(page.locator('[data-grand-total]')).toHaveText('Rp817,000');
    const [order] = await f.db.select().from(orders);
    const currentAttempts = () =>
      f.db
        .select()
        .from(paymentAttempts)
        .where(eq(paymentAttempts.orderId, order!.id))
        .orderBy(paymentAttempts.sequence);
    const period = resolvePeriod({
      period: 'custom',
      from: '2000-01-01',
      to: '2100-01-01',
    });
    const accountingBefore = await f.accounting.report(period);
    async function receipt(
      attempt: typeof paymentAttempts.$inferSelect,
      status: string,
      repeats = 1,
    ) {
      const date = new Date().toISOString();
      const body = JSON.stringify(
        {
          order: { invoice_number: attempt.invoice, amount: 817000 },
          transaction: { original_request_id: attempt.requestId, status, date },
        },
        null,
        2,
      );
      const headers = signedHeaders(body, randomUUID(), date);
      for (let i = 0; i < repeats; i++) {
        const response = await request.post(base + dokuNotificationPath, {
          headers,
          data: body,
        });
        expect(response.status()).toBe(200);
      }
    }
    await page
      .getByRole('button', { name: 'Pay with DOKU', exact: true })
      .click();
    await expect(page).toHaveURL(hostedOrigin + '/checkout-link-v2/1');
    await page.getByRole('link', { name: 'Return to LOKKA' }).click();
    await expect(page.getByRole('status')).toHaveText(
      'Payment confirmation is being processed.',
    );
    await expect(page.locator('[data-order-status]')).toHaveText(
      'Pending payment',
    );
    const [first] = await currentAttempts();
    await receipt(first!, 'FAILED');
    await page.reload();
    await expect(page.locator('[data-payment-status]')).toHaveText(
      'Payment pending',
    );
    expect(await f.accounting.report(period)).toEqual(accountingBefore);
    expect(await f.db.select().from(inventoryMovements)).toHaveLength(0);
    await f.db
      .update(paymentAttempts)
      .set({ expiresAt: new Date(0), updatedAt: new Date() })
      .where(eq(paymentAttempts.id, first!.id));
    await page.reload();
    await expect(page.locator('[data-payment-status]')).toHaveText(
      'Payment expired',
    );
    await page
      .getByRole('button', { name: 'Retry payment', exact: true })
      .click();
    await expect(page).toHaveURL(hostedOrigin + '/checkout-link-v2/2');
    const [, second] = await currentAttempts();
    await receipt(second!, 'SUCCESS', 2);
    await page.getByRole('link', { name: 'Return to LOKKA' }).click();
    await expect(page.locator('[data-payment-status]')).toHaveText(
      'Payment confirmed',
    );
    await expect(page.locator('[data-order-status]')).toHaveText('Paid');
    await page.goto(
      base + '/id/akun/pesanan/' + order!.orderNumber + '/payment/return',
    );
    await expect(page.locator('[data-payment-status]')).toHaveText(
      'Pembayaran berhasil',
    );
    expect(amounts).toEqual([817000, 817000]);
    expect(await f.db.select().from(sales)).toHaveLength(1);
    expect(await f.db.select().from(financialTransactions)).toHaveLength(1);
    expect(await f.db.select().from(inventoryMovements)).toHaveLength(1);
    expect(await f.accounting.report(period)).toMatchObject({
      revenue: 817000n,
      merchandiseRevenue: 795000n,
      shippingCharged: 22000n,
      cogs: 300000n,
    });
    expect(failedAssets).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
    await f.cleanup();
  }
});
