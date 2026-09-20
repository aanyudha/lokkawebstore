import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { buildApp } from '../../src/app.js';
import { createDatabase } from '../../src/db/client.js';
import { customers } from '../../src/db/schema/index.js';
import { readEnv } from '../../src/config/env.js';

test('customer account pages render across viewports and stay accessible', async ({
  page,
}) => {
  const run = randomUUID();
  const email = `browser-${run}@example.test`;
  const password = 'kata-sandi-browser-123';
  const env = readEnv({
    ...process.env,
    NODE_ENV: 'test',
    PORT: '3012',
    APP_URL: 'http://127.0.0.1:3012',
  });
  const database = createDatabase(env.databaseUrl);
  const app = await buildApp(env, { database, logger: false });
  await app.listen({ host: env.host, port: env.port });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  const widths = [1440, 1024, 768, 430, 390, 375, 360];
  const checkLayout = async (name: string, path: string, expected: string) => {
    const response = await page.goto(`${env.appUrl}${path}`, {
      waitUntil: 'networkidle',
    });
    expect(response?.status()).toBe(200);
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.locator('img[alt="LOKKA"]').first()).toHaveAttribute(
      'src',
      '/images/brand/lokka-logo.webp',
    );
    expect(await page.content()).toContain(expected);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/${name}-${page.viewportSize()?.width}.png`,
      fullPage: true,
    });
  };

  try {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await checkLayout('account-login', '/account/login', 'Welcome back');
      await checkLayout(
        'account-register',
        '/id/akun/daftar',
        'Buat akun Anda',
      );
    }

    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`${env.appUrl}/account/register`);
    await page.getByLabel('Full name', { exact: true }).fill('Peraga Akun');
    await page.getByLabel('Email address', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Confirm password', { exact: true }).fill(password);

    const passwordInput = page.getByLabel('Password', { exact: true });
    const toggle = page
      .locator('.account-field', { has: passwordInput })
      .getByRole('button');
    await toggle.click();
    await expect(passwordInput).toHaveAttribute('type', 'text');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(passwordInput).toHaveAttribute('type', 'password');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(`${env.appUrl}/account`);

    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await checkLayout('account-home', '/account', 'Peraga Akun');
      await checkLayout('account-profile', '/account/profile', 'Profile');
      await checkLayout('account-password', '/account/password', 'Current');
    }

    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`${env.appUrl}/id/akun/profil`);
    await expect(page.locator('main h1')).toHaveText('Profil');
    await page.goto(`${env.appUrl}/account`);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(`${env.appUrl}/account/login`);

    expect(errors).toEqual([]);
  } finally {
    await database.db
      .delete(customers)
      .where(eq(customers.emailNormalized, email.toLowerCase()));
    await app.close();
  }
});
