import { expect, test } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../src/app.js';
import { readEnv } from '../../src/config/env.js';
import {
  financialTransactions,
  orderItems,
  orders,
  paymentAttempts,
  sales,
} from '../../src/db/schema/index.js';
import { dokuNotificationPath } from '../../src/modules/payments/config.js';
import { DokuProvider } from '../../src/modules/payments/doku-provider.js';
import { createPaymentService } from '../../src/modules/payments/service.js';
import {
  dokuFixture,
  dokuTime,
  signedHeaders,
} from '../helpers/doku-fixture.js';
import { storefrontNavigationFixture } from '../helpers/storefront-navigation-fixture.js';

test('customer return shows authenticated notification status and expiry', async ({
  page,
  request,
}) => {
  const f = await storefrontNavigationFixture();
  const base = 'http://127.0.0.1:3052';
  const app = await buildApp(
    readEnv({
      ...process.env,
      DATABASE_URL: f.url,
      NODE_ENV: 'test',
      APP_URL: base,
      PAYMENT_PROVIDER: 'doku',
      DOKU_ENV: 'sandbox',
      DOKU_CLIENT_ID: dokuFixture.clientId,
      DOKU_SECRET_KEY: dokuFixture.secretKey,
      DOKU_NOTIFICATION_URL: dokuFixture.notificationUrl,
    }),
    { database: { ...f.database, close: async () => {} }, logger: false },
  );
  const pageErrors: string[] = [];
  const failedAssets: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico'))
      failedAssets.push(response.url());
  });
  try {
    await app.listen({ port: 3052, host: '127.0.0.1' });
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
    // Seed canonical amounts to exercise E3 rendering while the E2 checkout is unavailable.
    const [order] = await f.db
      .insert(orders)
      .values({
        orderNumber: 'WEB-20261123-000001',
        customerId: f.customer.customer.id,
        idempotencyKey: randomUUID(),
        subtotal: 795000n,
        shippingAmount: 20000n,
        grandTotal: 815000n,
      })
      .returning();
    await f.db.insert(orderItems).values({
      orderId: order!.id,
      productId: f.product.id,
      variantId: f.variant.id,
      productNameSnapshot: f.product.name,
      variantNameSnapshot: f.variant.name,
      skuSnapshot: f.variant.sku,
      quantity: 1,
      unitPriceSnapshot: 795000n,
      lineTotalSnapshot: 795000n,
      costSnapshot: 300000n,
    });
    const returnPath =
      '/account/orders/' + order!.orderNumber + '/payment/return';
    const createProvider = (expiredDate: string) =>
      new DokuProvider(dokuFixture, async (_url, options) => {
        const input = JSON.parse(String(options?.body));
        return Response.json({
          message: ['SUCCESS'],
          response: {
            order: {
              invoice_number: input.order.invoice_number,
              amount: input.order.amount,
            },
            payment: {
              url: 'https://sandbox.doku.com/checkout-link-v2/test',
              expired_date: expiredDate,
            },
          },
        });
      });
    const begin = (provider: DokuProvider) =>
      createPaymentService(
        f.db,
        provider,
        (candidate) => candidate.id === order!.id,
      ).createPayment({
        customerId: order!.customerId,
        orderNumber: order!.orderNumber,
        returnUrl: base + returnPath,
        locale: 'en',
      });
    const expired = new Date(Date.now() - 60_000 + 7 * 3_600_000)
      .toISOString()
      .slice(0, 19)
      .replace(/\D/g, '');
    const pending = new Date(Date.now() + 3_600_000 + 7 * 3_600_000)
      .toISOString()
      .slice(0, 19)
      .replace(/\D/g, '');
    await begin(createProvider(expired));
    await page.goto(base + returnPath);
    await expect(page.locator('[data-payment-status]')).toHaveText(
      'Payment expired',
    );
    await expect(page.locator('[data-order-status]')).toHaveText(
      'Pending payment',
    );
    expect(await f.db.select().from(financialTransactions)).toHaveLength(0);
    await begin(createProvider(pending));
    await page.goto(base + returnPath + '?status=SUCCESS');
    await expect(page.getByRole('status')).toHaveText(
      'Payment confirmation is being processed.',
    );
    await expect(page.locator('[data-payment-status]')).toHaveText(
      'Payment pending',
    );
    await expect(page.getByText('Shipping: Rp20,000')).toBeVisible();
    const [attempt] = await f.db
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.status, 'PENDING'));
    const body = JSON.stringify(
      {
        order: { invoice_number: attempt!.invoice, amount: 815000 },
        transaction: {
          original_request_id: attempt!.requestId,
          status: 'SUCCESS',
          date: dokuTime,
        },
      },
      null,
      2,
    );
    const headers = signedHeaders(body, randomUUID());
    for (let i = 0; i < 2; i++) {
      const response = await request.post(base + dokuNotificationPath, {
        data: body,
        headers,
      });
      expect(response.status()).toBe(200);
    }
    await page.getByRole('link', { name: 'Refresh payment status' }).click();
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
    expect(await f.db.select().from(financialTransactions)).toHaveLength(1);
    expect(await f.db.select().from(sales)).toHaveLength(1);
    expect(pageErrors).toEqual([]);
    expect(failedAssets).toEqual([]);
  } finally {
    await app.close();
    await f.cleanup();
  }
});
