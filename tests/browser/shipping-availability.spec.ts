import { expect, test } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { buildApp } from '../../src/app.js';
import { readEnv } from '../../src/config/env.js';
import {
  customerAddresses,
  financialTransactions,
  fulfillmentOrigins,
  inventoryMovements,
  orders,
  sales,
  shippingMethods,
} from '../../src/db/schema/index.js';
import { createCartService } from '../../src/modules/cart/service.js';
import { createCustomerAddresses } from '../../src/modules/customer/addresses.js';
import {
  configureCheckoutShipping,
  jntFixtureEnv,
  sampleAddress,
} from '../helpers/checkout-fixture.js';
import { storefrontNavigationFixture } from '../helpers/storefront-navigation-fixture.js';

test('Sleman checkout uses staff rates until a usable J&T tariff is available', async ({
  page,
}) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(12000);
  const f = await storefrontNavigationFixture();
  const base = 'http://127.0.0.1:3058';
  const customerId = f.customer.customer.id;
  const location = {
    city: 'Sleman',
    province: 'Yogyakarta',
    postalCode: '55571',
  };
  const district = 'Fixture District';
  const calls: string[] = [];
  let tariff: 'timeout' | 'usable' | 'empty' = 'usable';
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  const errors: string[] = [];
  const failed: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (
      response.status() >= 400 &&
      !response.url().endsWith('/favicon.ico') &&
      !(
        response.status() === 422 &&
        /\/(?:review(?:\/rates)?|cart\/orders)$/.test(response.url())
      )
    )
      failed.push(response.url());
  });
  async function start(providerEnv: NodeJS.ProcessEnv) {
    await app?.close();
    app = await buildApp(
      readEnv({
        ...process.env,
        DATABASE_URL: f.url,
        APP_RUNTIME: 'fastify',
        APP_URL: base,
        NODE_ENV: 'test',
        ...providerEnv,
      }),
      {
        database: { ...f.database, close: async () => {} },
        logger: false,
        async shippingFetch(_url, options) {
          calls.push(
            JSON.parse(new URLSearchParams(String(options?.body)).get('data')!)
              .destAreaCode,
          );
          if (tariff === 'timeout')
            return new Promise((_resolve, reject) => {
              options?.signal?.addEventListener(
                'abort',
                () => reject(options.signal?.reason),
                { once: true },
              );
            });
          return Response.json({
            is_success: 'true',
            content:
              tariff === 'empty' ? '[]' : '[{"name":"EZ","cost":"26000"}]',
          });
        },
      },
    );
    await app.listen({ host: '127.0.0.1', port: 3058 });
  }
  const review = base + '/cart/review';
  const options = () =>
    page.getByRole('combobox', { name: 'Shipping method', exact: true });
  const lookup = () =>
    page
      .getByRole('button', { name: 'Check shipping rates', exact: true })
      .click();
  const reviewOrder = () =>
    page.getByRole('button', { name: 'Review order', exact: true }).click();
  const choice = page.getByRole('option', {
    name: /Standard delivery.*22,000/,
  });
  const unavailable =
    'Shipping is not available for this address yet. Please contact LOKKA or try another address.';
  try {
    const method = await configureCheckoutShipping(f.db, f.catalog);
    const [origin] = await f.db
      .update(fulfillmentOrigins)
      .set({ isDefault: false, updatedAt: new Date() })
      .returning();
    const [address] = await f.db
      .insert(customerAddresses)
      .values({
        customerId,
        ...location,
        recipientName: sampleAddress.recipientName,
        phone: sampleAddress.phone,
        addressLine1: sampleAddress.addressLine1,
        isDefault: true,
      })
      .returning();
    const cart = createCartService(f.db);
    await cart.mutate(customerId, 'add', f.variant.id, 1);
    await start({ SHIPPING_RATE_PROVIDER: 'disabled' });
    await page.goto(base + '/admin/login');
    await page.getByLabel('Email', { exact: true }).fill(f.admin.email);
    await page
      .getByLabel('Password', { exact: true })
      .fill('temporary-accounting-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.goto(base + '/admin/settings/fulfillment');
    const settings = page.getByRole('region', {
      name: 'Checkout shipping availability',
    });
    await expect(settings).toContainText('No active default origin');
    await expect(settings).toContainText('Disabled');
    await expect(settings.locator('[data-active-shipping-methods]')).toHaveText(
      '1',
    );
    await page.goto(base + '/account/login');
    await page
      .getByLabel('Email address', { exact: true })
      .fill(f.customer.customer.email);
    await page
      .getByLabel('Password', { exact: true })
      .fill('temporary-customer-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.goto(review);
    await expect(choice).toBeAttached();
    await options().selectOption(method.id);
    await reviewOrder();
    await expect(page.locator('[data-shipping-address]')).toContainText(
      'Sleman, Yogyakarta 55571',
    );
    await page
      .getByRole('button', { name: 'Place order', exact: true })
      .click();
    await expect(page.locator('[data-order-status]')).toHaveText(
      'Waiting for payment',
    );
    const [order] = await f.db.select().from(orders);
    expect(order).toMatchObject({
      shippingAmount: 22000n,
      shipmentWeightGrams: BigInt(f.variant.weightGrams),
      shippingAddressSnapshot: { ...location, district: null },
      shippingMethodSnapshot: { quoteSource: 'MANUAL' },
    });
    for (const table of [sales, financialTransactions, inventoryMovements])
      expect(await f.db.$count(table)).toBe(0);
    expect(calls).toEqual([]);
    await cart.mutate(customerId, 'add', f.variant.id, 1);

    await start({ ...jntFixtureEnv, JNT_TARIFF_KEY: '' });
    await page.goto(base + '/admin/settings/fulfillment');
    await expect(settings).toContainText(
      'J&T (configuration missing or invalid)',
    );
    await page.goto(review);
    await expect(choice).toBeAttached();
    await expect(
      page.getByRole('button', { name: 'Check shipping rates' }),
    ).toHaveCount(0);

    await f.db
      .update(fulfillmentOrigins)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(fulfillmentOrigins.id, origin!.id));
    await start({
      ...jntFixtureEnv,
      JNT_TARIFF_DESTINATION_CODES: JSON.stringify({
        [`Yogyakarta|Sleman|${district}|55571`]: 'SLEMAN_FIXTURE',
      }),
    });
    await page.goto(review);
    await lookup();
    await expect(choice).toBeAttached();
    expect(calls).toEqual([]);
    await expect(page.getByText(unavailable, { exact: true })).toHaveCount(0);

    await createCustomerAddresses(f.db).save(
      customerId,
      { ...sampleAddress, ...location, district },
      address!.id,
    );
    tariff = 'timeout';
    await page.goto(review);
    await lookup();
    await expect(choice).toBeAttached();
    expect(calls).toEqual(['SLEMAN_FIXTURE']);
    tariff = 'usable';
    await options().selectOption(method.id);
    await reviewOrder();
    await expect(page.locator('[data-shipping-amount]')).toHaveText('Rp22,000');
    expect(calls).toHaveLength(1);

    await page.goto(review);
    await lookup();
    await expect(
      page.getByRole('option', { name: /J&T Express.*EZ.*26,000/ }),
    ).toBeAttached();
    await expect(choice).toHaveCount(0);
    await options().selectOption('jnt:EZ');
    await reviewOrder();
    await expect(page.locator('[data-shipping-amount]')).toHaveText('Rp26,000');
    tariff = 'empty';
    await page
      .getByRole('button', { name: 'Place order', exact: true })
      .click();
    await expect(choice).toBeAttached();
    await expect(page.getByText(unavailable, { exact: true })).toHaveCount(0);

    await f.db
      .update(shippingMethods)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(shippingMethods.id, method.id));
    await page.goto(review);
    await lookup();
    await expect(page.getByRole('alert')).toHaveText(unavailable);
    await expect(options()).toHaveCount(0);
    await page.goto(base + '/id/keranjang/review');
    await page
      .getByRole('button', { name: 'Cek ongkos kirim', exact: true })
      .click();
    await expect(page.getByRole('alert')).toHaveText(
      'Pengiriman belum tersedia untuk alamat ini. Silakan hubungi LOKKA atau gunakan alamat lain.',
    );
    await page.goto(base + '/admin/settings/fulfillment');
    await expect(settings).toContainText(
      'No active fallback shipping rates are configured.',
    );
    expect(failed).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    try {
      await app?.close();
    } finally {
      await f.cleanup();
    }
  }
});
