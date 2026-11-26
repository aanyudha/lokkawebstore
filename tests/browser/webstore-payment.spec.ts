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
  jntFixtureEnv,
  sampleAddress,
} from '../helpers/checkout-fixture.js';
import { dokuFixture, signedHeaders } from '../helpers/doku-fixture.js';
import { storefrontNavigationFixture } from '../helpers/storefront-navigation-fixture.js';

test('a saved unpaid order can start DOKU after runtime activation and only a verified notification confirms it', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const f = await storefrontNavigationFixture();
  const base = 'http://127.0.0.1:3052';
  const hostedOrigin = 'https://sandbox.doku.com';
  const hosted = new Map<string, string>();
  const amounts: number[] = [];
  const tariffCalls: string[] = [];
  const makeApp = (provider: 'disabled' | 'doku') =>
    buildApp(
      readEnv({
        ...process.env,
        DATABASE_URL: f.url,
        APP_URL: base,
        NODE_ENV: 'test',
        APP_RUNTIME: 'fastify',
        PAYMENT_PROVIDER: provider,
        DOKU_ENV: 'sandbox',
        DOKU_CLIENT_ID: provider === 'doku' ? dokuFixture.clientId : '',
        DOKU_SECRET_KEY: provider === 'doku' ? dokuFixture.secretKey : '',
        DOKU_NOTIFICATION_URL:
          provider === 'doku' ? dokuFixture.notificationUrl : '',
        ...jntFixtureEnv,
      }),
      {
        database: { ...f.database, close: async () => {} },
        logger: false,
        async shippingFetch(url, options) {
          expect(url).toBe(jntFixtureEnv.JNT_TARIFF_URL);
          const tariff = new URLSearchParams(String(options?.body));
          tariffCalls.push(JSON.parse(tariff.get('data')!).weight);
          return Response.json({
            is_success: 'true',
            content: '[{"name":"EZ","cost":"22000"}]',
          });
        },
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
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
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
    app = await makeApp('disabled');
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
      ['District or kecamatan', sampleAddress.district],
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
    await page.getByRole('button', { name: 'Check shipping rates' }).click();
    await expect(
      page.getByRole('option', { name: /J&T Express.*EZ.*22,000/ }),
    ).toBeAttached();
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
      'Waiting for payment',
    );
    await expect(page.locator('[data-grand-total]')).toHaveText('Rp817,000');
    const [order] = await f.db.select().from(orders);
    expect(order?.shippingMethodSnapshot).toMatchObject({
      courierCode: 'JNT',
      serviceCode: 'EZ',
      quoteSource: 'JNT',
    });
    expect(tariffCalls).toEqual(['0.200', '0.200', '0.200']);
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
    const customerOrder = '/account/orders/' + order!.orderNumber;
    const adminOrder = base + '/admin/orders/' + order!.orderNumber;
    const readiness = page.locator('[aria-label="Payment readiness"] dd');
    const offline =
      'Online payment is temporarily unavailable. Your order has been saved. Please try again later.';
    const payNow = page.getByRole('button', { name: 'Pay now', exact: true });
    await expect(page.getByRole('status')).toHaveText(offline);
    await expect(page.locator('[data-payment-status]')).toHaveText(
      'No payment recorded',
    );
    await expect(payNow).toHaveCount(0);
    await page.goto(base + '/id/akun/pesanan/' + order!.orderNumber);
    await expect(page.getByRole('status')).toHaveText(
      'Pembayaran online sementara belum tersedia. Pesanan Anda sudah tersimpan. Silakan coba kembali nanti.',
    );
    expect(await currentAttempts()).toHaveLength(0);
    for (const table of [sales, financialTransactions, inventoryMovements])
      expect(await f.db.$count(table)).toBe(0);

    await page.goto(base + '/admin/login');
    await page.getByLabel('Email', { exact: true }).fill(f.admin.email);
    await page
      .getByLabel('Password', { exact: true })
      .fill('temporary-accounting-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.goto(adminOrder);
    await expect(readiness).toHaveText(['Disabled', 'Missing', 'Missing']);

    await app.close();
    app = await makeApp('doku');
    await app.listen({ host: '127.0.0.1', port: 3052 });
    const adminResponse = await page.goto(adminOrder);
    await expect(readiness).toHaveText([
      'DOKU Sandbox',
      'Configured',
      'Configured',
    ]);
    const protectedHtml = (await adminResponse?.text()) ?? '';
    for (const value of [
      dokuFixture.clientId,
      dokuFixture.secretKey,
      dokuFixture.notificationUrl,
    ])
      expect(protectedHtml).not.toContain(value);
    await page.goto(base + '/account/orders');
    await page
      .getByRole('link', {
        name: 'View order ' + order!.orderNumber,
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(base + customerOrder);
    await expect(payNow).toBeVisible();
    await expect(page.getByText(offline, { exact: true })).toHaveCount(0);
    expect(await f.db.select().from(orders)).toEqual([order]);
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
    await payNow.click();
    await expect(page).toHaveURL(hostedOrigin + '/checkout-link-v2/1');
    await page.getByRole('link', { name: 'Return to LOKKA' }).click();
    await expect(page.getByRole('status')).toHaveText(
      'Payment confirmation is being processed.',
    );
    await expect(page.locator('[data-order-status]')).toHaveText(
      'Payment processing',
    );
    const [first] = await currentAttempts();
    expect(first).toMatchObject({
      orderId: order!.id,
      amount: order!.grandTotal,
      sequence: 1,
      status: 'PENDING',
      checkoutUrl: hostedOrigin + '/checkout-link-v2/1',
    });
    await page
      .getByRole('button', { name: 'Continue to payment', exact: true })
      .click();
    await expect(page).toHaveURL(hostedOrigin + '/checkout-link-v2/1');
    await page.getByRole('link', { name: 'Return to LOKKA' }).click();
    expect(await currentAttempts()).toEqual([first]);
    expect(amounts).toEqual([817000]);
    expect(await f.db.select().from(orders)).toEqual([order]);
    for (const table of [sales, financialTransactions, inventoryMovements])
      expect(await f.db.$count(table)).toBe(0);
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
    await expect(page.locator('[data-order-status]')).toHaveText(
      'Preparing your order',
    );
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

    await page.goto(adminOrder);
    await page.getByRole('link', { name: 'Shipments', exact: true }).click();
    await page.getByRole('link', { name: order!.orderNumber }).click();
    await expect(page.getByText('J&T Express · EZ')).toBeVisible();
    await page.getByLabel('Courier', { exact: true }).fill('JNE');
    await page.getByLabel('Service', { exact: true }).fill('REG');
    await page.getByLabel('Tracking number / Nomor resi').fill('000123456');
    await page.getByLabel('Actual shipping cost (Rp)').fill('17000');
    await page.getByRole('button', { name: 'Mark as shipped' }).click();
    await expect(page.getByText('000123456', { exact: true })).toBeVisible();
    await page.goto(base + customerOrder);
    await expect(page.locator('[data-shipment-status]')).toHaveText('Shipped');
    await expect(page.locator('[data-tracking-number]')).toHaveText(
      '000123456',
    );
    await expect(page.getByText('JNE', { exact: true })).toBeVisible();
    await expect(page.locator('[data-quoted-courier]')).toHaveText(
      'J&T Express',
    );
    await expect(page.locator('[data-shipping-amount]')).toHaveText('Rp22,000');
    await expect(page.locator('[data-grand-total]')).toHaveText('Rp817,000');
    await page.goto(
      base + '/admin/fulfillment/shipments?orderNumber=' + order!.orderNumber,
    );
    await page.getByLabel('Correct tracking number').fill('000123457');
    await page.getByRole('button', { name: 'Save tracking number' }).click();
    await expect(page.getByText('000123457', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Mark as delivered' }).click();
    await expect(page.getByText('DELIVERED', { exact: true })).toBeVisible();
    await page.goto(base + '/id/akun/pesanan/' + order!.orderNumber);
    await expect(page.locator('[data-shipment-status]')).toHaveText('Terkirim');
    await expect(page.getByText('Nomor resi', { exact: true })).toBeVisible();
    await expect(page.locator('[data-tracking-number]')).toHaveText(
      '000123457',
    );
    expect(tariffCalls).toHaveLength(3);
    expect(await f.db.select().from(financialTransactions)).toHaveLength(2);
    expect(await f.accounting.report(period)).toMatchObject({
      revenue: 817000n,
      shippingCharged: 22000n,
      cogs: 300000n,
      operatingExpenses: 17000n,
    });
    expect(failedAssets).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    try {
      await app?.close();
    } finally {
      await f.cleanup();
    }
  }
});
