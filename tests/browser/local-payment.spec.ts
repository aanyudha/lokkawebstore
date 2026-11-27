import { expect, test } from '@playwright/test';
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
import { createCartService } from '../../src/modules/cart/service.js';
import { createCheckout } from '../../src/modules/checkout/service.js';
import {
  configureCheckoutShipping,
  reviewedCheckout,
  saveCheckoutAddress,
} from '../helpers/checkout-fixture.js';
import { storefrontNavigationFixture } from '../helpers/storefront-navigation-fixture.js';

test('pays an existing order through the authenticated local checkout after opting in', async ({
  page,
}) => {
  page.setDefaultTimeout(12000);
  const f = await storefrontNavigationFixture();
  const base = 'http://127.0.0.1:3061';
  const errors: string[] = [];
  const failed: string[] = [];
  const networkPayments: string[] = [];
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (entry) => {
    if (
      entry.type() === 'error' &&
      entry.text().includes('Content Security Policy')
    )
      errors.push(entry.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico'))
      failed.push(response.url());
  });
  try {
    const customer = f.customer.customer.id;
    const method = await configureCheckoutShipping(f.db, f.catalog);
    const address = await saveCheckoutAddress(f.db, customer);
    await createCartService(f.db).mutate(customer, 'add', f.variant.id, 1);
    const order = await createCheckout(f.db).place(
      customer,
      await reviewedCheckout(f.db, customer, address.id, method.id),
    );
    expect(await f.db.$count(paymentAttempts)).toBe(0);
    const env = readEnv({
      ...process.env,
      DATABASE_URL: f.url,
      APP_URL: base,
      NODE_ENV: 'test',
      PAYMENT_PROVIDER: 'local',
    });
    app = await buildApp(env, {
      database: { ...f.database, close: async () => {} },
      logger: false,
      paymentFetch: async (url) => {
        networkPayments.push(String(url));
        throw new Error('Unexpected payment network request');
      },
    });
    await app.listen({ host: '127.0.0.1', port: 3061 });
    const orderUrl = `${base}/account/orders/${order.orderNumber}`;
    await page.goto(orderUrl);
    await page
      .getByLabel('Email address', { exact: true })
      .fill(f.customer.customer.email);
    await page
      .getByLabel('Password', { exact: true })
      .fill('temporary-customer-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(orderUrl);
    await expect(page.locator('[data-order-status]')).toHaveText(
      'Waiting for payment',
    );
    await expect(
      page.getByText('Local development', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Pay now', exact: true }).click();
    const localUrl = page.url();
    expect(localUrl.startsWith(orderUrl + '/payment/local/')).toBe(true);
    await expect(
      page.getByRole('heading', { name: 'Local payment checkout' }),
    ).toBeVisible();
    await expect(
      page.getByText(order.orderNumber, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Rp817,000', { exact: true })).toBeVisible();
    await expect(page.locator('[data-local-payment-status]')).toHaveText(
      'Payment pending',
    );
    await page.goto(orderUrl + '/payment/return?status=SUCCESS');
    await expect(page.locator('[data-order-status]')).toHaveText(
      'Payment processing',
    );
    await page
      .getByRole('button', { name: 'Continue to payment', exact: true })
      .click();
    await expect(page).toHaveURL(localUrl);
    expect(await f.db.$count(paymentAttempts)).toBe(1);
    await page
      .getByRole('button', { name: 'Simulate success', exact: true })
      .click();
    await expect(page).toHaveURL(orderUrl);
    await expect(page.locator('[data-order-status]')).toHaveText(
      'Preparing your order',
    );
    await expect(page.locator('[data-payment-status]')).toHaveText(
      'Payment confirmed',
    );
    expect(
      (await f.db.select().from(orders).where(eq(orders.id, order.id)))[0],
    ).toMatchObject({ status: 'PAID', grandTotal: order.grandTotal });
    for (const table of [
      paymentAttempts,
      sales,
      financialTransactions,
      inventoryMovements,
    ])
      expect(await f.db.$count(table)).toBe(1);
    await page.goto(base + '/admin/login');
    await page.getByLabel('Email', { exact: true }).fill(f.admin.email);
    await page
      .getByLabel('Password', { exact: true })
      .fill('temporary-accounting-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.goto(`${base}/admin/orders/${order.orderNumber}`);
    await expect(
      page.locator('[aria-label="Payment readiness"] dd'),
    ).toHaveText(['Local development', 'DEVELOPMENT ONLY']);
    expect(networkPayments).toEqual([]);
    expect(errors).toEqual([]);
    expect(failed).toEqual([]);
  } finally {
    try {
      await app?.close();
    } finally {
      await f.cleanup();
    }
  }
});
