import { expect, test } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { financialTransactions } from '../../src/db/schema/index.js';
import {
  accountingPassword,
  backOfficeOrdersFixture,
} from '../helpers/back-office-orders-fixture.js';
import { historyBase } from '../helpers/order-history-fixture.js';

test('staff review and dispatch a webstore order which the customer tracks through delivery', async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(12000);
  const fixture = await backOfficeOrdersFixture();
  const customer = await browser.newPage();
  customer.setDefaultTimeout(12000);
  const errors: string[] = [];
  const failed: string[] = [];
  for (const current of [page, customer]) {
    current.on('pageerror', (error) => errors.push(error.message));
    current.on('console', (message) => {
      if (
        message.type() === 'error' &&
        message.text().includes('Content Security Policy')
      )
        errors.push(message.text());
    });
    current.on('response', (response) => {
      if (response.status() >= 400 && !response.url().endsWith('/favicon.ico'))
        failed.push(response.url());
    });
  }
  const list = historyBase + '/admin/orders';
  const order = fixture.preparing;
  const detail = list + '/' + order.orderNumber;
  const customerDetail = historyBase + '/account/orders/' + order.orderNumber;
  const postedExpense = () =>
    fixture.db
      .select()
      .from(financialTransactions)
      .where(eq(financialTransactions.shipmentOrderId, order.id));
  try {
    await fixture.app.listen({ host: '127.0.0.1', port: 3057 });
    const before = await fixture.accountingRows();
    await page.goto(historyBase + '/admin/login');
    await page.getByLabel('Email', { exact: true }).fill(fixture.admin.email);
    await page.getByLabel('Password', { exact: true }).fill(accountingPassword);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page
      .getByRole('navigation', { name: 'Admin' })
      .getByRole('link', { name: 'Orders', exact: true })
      .click();
    const rows = page.locator('[data-order-row]');
    await expect(rows).toHaveCount(25);
    const status = page.getByRole('combobox', {
      name: 'Order status',
      exact: true,
    });
    await status.selectOption('waiting');
    await page.getByLabel('Search orders').fill('Diego');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await page.getByRole('link', { name: 'Next page' }).click();
    await expect(page.getByLabel('Search orders')).toHaveValue('Diego');
    await expect(status).toHaveValue('waiting');
    await expect(rows).toHaveCount(4);
    await status.selectOption('ready');
    await page.getByLabel('Search orders').fill(order.orderNumber);
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(rows).toHaveCount(1);
    await page.getByRole('link', { name: `View ${order.orderNumber}` }).click();
    await expect(page).toHaveURL(detail);
    await expect(
      page.getByRole('region', { name: 'Payment history' }),
    ).toContainText('Confirmed');
    const quote = page.getByRole('region', { name: 'Checkout shipping' });
    await expect(quote).toContainText('J&T Express');
    await expect(quote).toContainText('Rp22.000');
    await expect(page.locator('[data-shipping-expense]')).toHaveText(
      'Not posted',
    );
    expect(await fixture.accountingRows()).toEqual(before);
    await page.getByLabel('Courier', { exact: true }).fill('JNE');
    await page.getByLabel('Service', { exact: true }).fill('REG');
    await page.getByLabel('Tracking number / Nomor resi').fill('000BROWSER-E6');
    await page.getByLabel('Actual shipping cost (Rp)').fill('18500');
    await page.getByRole('button', { name: 'Mark as shipped' }).click();
    await expect(page).toHaveURL(detail);
    await expect(page.locator('[data-shipping-expense]')).toHaveText('Posted');
    await expect(
      page.getByRole('region', { name: 'Actual fulfillment' }),
    ).toContainText('JNE · REG');
    await expect(quote).toContainText('Rp22.000');
    const expense = await postedExpense();
    expect(expense).toMatchObject([
      { amountRupiah: 18500n, type: 'SHIPPING_EXPENSE' },
    ]);

    await customer.goto(historyBase + '/account/orders');
    await customer
      .getByLabel('Email address', { exact: true })
      .fill(fixture.customer.customer.email);
    await customer
      .getByLabel('Password', { exact: true })
      .fill('temporary-customer-password');
    await customer
      .getByRole('button', { name: 'Sign in', exact: true })
      .click();
    await customer
      .getByLabel('Order status', { exact: true })
      .selectOption('shipped');
    await customer
      .getByRole('button', { name: 'Apply filter', exact: true })
      .click();
    await customer
      .getByRole('link', { name: `View order ${order.orderNumber}` })
      .click();
    await expect(customer).toHaveURL(customerDetail);
    await expect(customer.locator('[data-tracking-number]')).toHaveText(
      '000BROWSER-E6',
    );
    await expect(customer.getByText('Rp18,500', { exact: true })).toHaveCount(
      0,
    );

    await page.getByLabel('Correct tracking number').fill('000BROWSER-NEW');
    await page.getByRole('button', { name: 'Save tracking number' }).click();
    const audit = page
      .getByRole('region', { name: 'Tracking corrections' })
      .getByRole('row', { name: /000BROWSER-E6/ });
    await expect(audit).toContainText('000BROWSER-NEW');
    await expect(audit).toContainText(fixture.admin.name);
    await page.getByRole('button', { name: 'Mark as delivered' }).click();
    await expect(
      page.getByRole('region', { name: 'Order summary' }),
    ).toContainText('Delivered');
    await customer.reload();
    await expect(customer.locator('[data-order-status]')).toHaveText(
      'Delivered',
    );
    await expect(customer.locator('[data-tracking-number]')).toHaveText(
      '000BROWSER-NEW',
    );
    expect(await postedExpense()).toEqual(expense);

    await page.goto(list + '?status=review');
    await page
      .getByRole('link', { name: `View ${fixture.review.orderNumber}` })
      .click();
    await expect(
      page.getByRole('region', { name: 'Payment history' }),
    ).toContainText('Stock shortfall');
    await expect(
      page.getByRole('button', {
        name: /Mark paid|Force paid|Approve payment|Mark as shipped/i,
      }),
    ).toHaveCount(0);
    expect(await fixture.accountingRows()).toEqual([1, 2, 1, 1]);
    expect(failed).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    try {
      await customer.close();
    } finally {
      await fixture.close();
    }
  }
});
