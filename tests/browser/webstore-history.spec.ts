import { expect, test } from '@playwright/test';
import {
  historyBase,
  orderHistoryFixture,
} from '../helpers/order-history-fixture.js';

test('customer history filters, paginates and shows payment and delivery facts privately', async ({
  page,
}) => {
  const fixture = await orderHistoryFixture(async () => {
    throw new Error('Browsing requested payment transport');
  });
  const errors: string[] = [];
  const failedResponses: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      message.text().includes('Content Security Policy')
    )
      errors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico'))
      failedResponses.push(response.url());
  });
  const history = historyBase + '/account/orders';
  const foreign = history + '/' + fixture.foreign.orderNumber;
  try {
    await fixture.app.listen({ host: '127.0.0.1', port: 3057 });
    const before = await fixture.accountingRows();
    await page.goto(history);
    await page
      .getByLabel('Email address', { exact: true })
      .fill(fixture.customer.customer.email);
    await page
      .getByLabel('Password', { exact: true })
      .fill('temporary-customer-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(history);
    const cards = page.locator('[data-history-order]');
    const card = (number: string) =>
      cards.filter({ has: page.getByRole('heading', { name: number }) });
    await expect(cards).toHaveCount(12);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Orders');
    async function filter(value: string) {
      await page
        .getByLabel('Order status', { exact: true })
        .selectOption(value);
      await page
        .getByRole('button', { name: 'Apply filter', exact: true })
        .click();
    }
    await filter('waiting');
    await page.getByRole('link', { name: 'Next page' }).click();
    await expect(page).toHaveURL(history + '?status=waiting&page=2');
    await expect(page.getByLabel('Order status', { exact: true })).toHaveValue(
      'waiting',
    );
    await expect(cards).toHaveCount(4);
    await expect(
      card(fixture.pending.orderNumber).locator('[data-item-count]'),
    ).toHaveText('3');
    await expect(card(fixture.pending.orderNumber)).toContainText('Rp170,000');
    await card(fixture.pending.orderNumber)
      .getByRole('link', { name: /View order/i })
      .click();
    await expect(page.locator('[data-order-status]')).toHaveText(
      'Waiting for payment',
    );
    await expect(
      page.getByRole('button', { name: 'Pay now', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('row', { name: /Historical shirt/ }),
    ).toBeVisible();

    await page.goto(history);
    await filter('processing');
    await expect(card(fixture.review.orderNumber)).toContainText(
      'Payment confirmation under review',
    );
    await expect(card(fixture.processing.orderNumber)).toContainText(
      'Payment processing',
    );
    await card(fixture.preparing.orderNumber)
      .getByRole('link', { name: /View order/i })
      .click();
    await expect(page.locator('[data-order-status]')).toHaveText(
      'Preparing your order',
    );
    await expect(
      page.getByText(
        'Tracking number will appear after your order is shipped.',
      ),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Pay now|Retry payment/i }),
    ).toHaveCount(0);

    await page.goto(history);
    await filter('shipped');
    await expect(cards).toHaveCount(1);
    await card(fixture.shipped.orderNumber)
      .getByRole('link', { name: /View order/i })
      .click();
    await expect(page.locator('[data-order-status]')).toHaveText('Shipped');
    await expect(
      page.getByRole('heading', { name: 'Shipping selected at checkout' }),
    ).toBeVisible();
    await expect(page.locator('[data-quoted-courier]')).toHaveText(
      'J&T Express',
    );
    await expect(
      page.getByRole('region', { name: 'Actual shipment' }),
    ).toContainText('JNE');
    await expect(page.locator('[data-tracking-number]')).toHaveText(
      '000JNE123',
    );
    await expect(page.getByText(/18,765|actual shipping cost/i)).toHaveCount(0);

    await page.goto(history);
    await filter('delivered');
    await card(fixture.delivered.orderNumber)
      .getByRole('link', { name: /View order/i })
      .click();
    await expect(page.locator('[data-order-status]')).toHaveText('Delivered');
    await expect(page.locator('[data-order-timeline] time')).toHaveCount(4);
    await page.goto(
      historyBase + '/id/akun/pesanan/' + fixture.delivered.orderNumber,
    );
    await expect(page.locator('[data-order-status]')).toHaveText('Terkirim');
    await expect(page.getByText('Nomor resi', { exact: true })).toBeVisible();
    await expect(page.getByText('Rp18.765', { exact: true })).toHaveCount(0);

    await page.goto(history);
    await filter('cancelled');
    await expect(
      card(fixture.cancelled.orderNumber).locator('[data-order-status]'),
    ).toHaveText('Cancelled');
    expect((await page.goto(foreign))?.status()).toBe(404);
    await expect(
      page.getByText(fixture.foreign.orderNumber, { exact: true }),
    ).toHaveCount(0);
    expect(await fixture.accountingRows()).toEqual(before);
    expect(failedResponses).toEqual([foreign]);
    expect(errors).toEqual([]);
  } finally {
    await fixture.close();
  }
});
