import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { commercialDatabase } from './helpers/commercial-database.js';
import { buildApp } from '../src/app.js';
import { readEnv } from '../src/config/env.js';
import { customers, vendors } from '../src/db/schema/index.js';
import { safeReturnPath } from '../src/modules/customer/validation.js';

let fixture: Awaited<ReturnType<typeof commercialDatabase>>;
let app: FastifyInstance;
const origin = 'http://127.0.0.1:3000';
const email = 'Pelanggan@Example.test';
const password = 'kata-sandi-verifikasi';

const cookieHeader = (cookies: { name: string; value: string }[]) =>
  cookies
    .filter((c) => c.value)
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

const csrfOf = (cookies: { name: string; value: string }[]) =>
  cookies.find((c) => c.name === 'lokka_customer_csrf')!.value;

async function openRegister() {
  const response = await app.inject('/account/register');
  const loginCsrf = response.cookies.find(
    (c) => c.name === 'lokka_customer_login_csrf',
  )!.value;
  return loginCsrf;
}

beforeAll(async () => {
  fixture = await commercialDatabase();
  await fixture.database.db
    .insert(vendors)
    .values({ slug: 'lokka', name: 'LOKKA', status: 'active' });
  app = await buildApp(
    readEnv({
      ...process.env,
      DATABASE_URL: fixture.url,
      NODE_ENV: 'test',
      APP_URL: origin,
    }),
    { database: { ...fixture.database, close: async () => {} }, logger: false },
  );
}, 30000);

afterAll(async () => {
  await app.close();
  await fixture.cleanup();
});

describe('customer validation helpers', () => {
  it('accepts only same-site account return paths', () => {
    expect(safeReturnPath('/account/profile')).toBe('/account/profile');
    expect(safeReturnPath('/id/akun/profil?x=1')).toBe('/id/akun/profil?x=1');
    expect(safeReturnPath('//evil.test')).toBeNull();
    expect(safeReturnPath('/\\evil.test')).toBeNull();
    expect(safeReturnPath('javascript:alert(1)')).toBeNull();
    expect(safeReturnPath('https://evil.test/account')).toBeNull();
    expect(safeReturnPath('/admin')).toBeNull();
    expect(safeReturnPath('')).toBeNull();
  });
});

describe('customer identity and authentication', () => {
  let sessionCookie = '';
  let csrf = '';

  it('registers a customer and rotates to an authenticated session', async () => {
    const loginCsrf = await openRegister();
    const response = await app.inject({
      method: 'POST',
      url: '/account/register',
      cookies: { lokka_customer_login_csrf: loginCsrf },
      headers: { origin },
      payload: {
        csrf: loginCsrf,
        name: 'Pelanggan Uji',
        email,
        password,
        confirmPassword: password,
      },
    });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/account');
    sessionCookie = cookieHeader(response.cookies);
    csrf = csrfOf(response.cookies);

    const [stored] = await fixture.database.db
      .select()
      .from(customers)
      .where(eq(customers.emailNormalized, email.toLowerCase()));
    expect(stored?.name).toBe('Pelanggan Uji');
    expect(stored?.status).toBe('ACTIVE');
    expect(stored?.passwordHash).not.toContain(password);
  });

  it('rejects a duplicate email deterministically', async () => {
    const loginCsrf = await openRegister();
    const response = await app.inject({
      method: 'POST',
      url: '/account/register',
      cookies: { lokka_customer_login_csrf: loginCsrf },
      headers: { origin },
      payload: {
        csrf: loginCsrf,
        name: 'Duplicate',
        email: email.toUpperCase(),
        password,
        confirmPassword: password,
      },
    });
    expect(response.statusCode).toBe(422);
  });

  it('requires CSRF and rejects mismatched passwords', async () => {
    const loginCsrf = await openRegister();
    const noCsrf = await app.inject({
      method: 'POST',
      url: '/account/register',
      cookies: { lokka_customer_login_csrf: loginCsrf },
      headers: { origin },
      payload: { name: 'No CSRF', email: 'no-csrf@example.test', password },
    });
    expect(noCsrf.statusCode).toBe(403);

    const loginCsrf2 = await openRegister();
    const mismatch = await app.inject({
      method: 'POST',
      url: '/account/register',
      cookies: { lokka_customer_login_csrf: loginCsrf2 },
      headers: { origin },
      payload: {
        csrf: loginCsrf2,
        name: 'Mismatch',
        email: 'mismatch@example.test',
        password,
        confirmPassword: 'different-password',
      },
    });
    expect(mismatch.statusCode).toBe(422);
  });

  it('serves the account pages to the authenticated session only', async () => {
    const anonymous = await app.inject('/account');
    expect(anonymous.statusCode).toBe(303);
    expect(anonymous.headers.location).toContain('/account/login');

    const home = await app.inject({
      url: '/account',
      headers: { cookie: sessionCookie },
    });
    expect(home.statusCode).toBe(200);
    expect(home.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(home.headers['cache-control']).toContain('no-store');
    expect(home.body).toContain('Pelanggan Uji');

    const storefront = await app.inject({
      url: '/',
      headers: { cookie: sessionCookie },
    });
    expect(storefront.statusCode).toBe(200);
    expect(storefront.body).toContain('/account');
  });

  it('signs in a case-insensitive email with a valid password', async () => {
    const loginPage = await app.inject('/account/login');
    const loginCsrf = loginPage.cookies.find(
      (c) => c.name === 'lokka_customer_login_csrf',
    )!.value;
    const bad = await app.inject({
      method: 'POST',
      url: '/account/login',
      cookies: { lokka_customer_login_csrf: loginCsrf },
      headers: { origin },
      payload: { csrf: loginCsrf, email, password: 'wrong-password' },
    });
    expect(bad.statusCode).toBe(401);

    const loginPage2 = await app.inject('/account/login');
    const loginCsrf2 = loginPage2.cookies.find(
      (c) => c.name === 'lokka_customer_login_csrf',
    )!.value;
    const good = await app.inject({
      method: 'POST',
      url: '/account/login',
      cookies: { lokka_customer_login_csrf: loginCsrf2 },
      headers: { origin },
      payload: { csrf: loginCsrf2, email: email.toUpperCase(), password },
    });
    expect(good.statusCode).toBe(303);
    expect(good.headers.location).toBe('/account');
  });

  it('honours a safe returnTo and ignores an open redirect', async () => {
    const page = await app.inject(
      '/account/login?returnTo=%2Faccount%2Fprofile',
    );
    const loginCsrf = page.cookies.find(
      (c) => c.name === 'lokka_customer_login_csrf',
    )!.value;
    const response = await app.inject({
      method: 'POST',
      url: '/account/login',
      cookies: { lokka_customer_login_csrf: loginCsrf },
      headers: { origin },
      payload: {
        csrf: loginCsrf,
        email,
        password,
        returnTo: 'https://evil.test/steal',
      },
    });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/account');
  });

  it('updates the profile name', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/account/profile',
      cookies: { lokka_customer_csrf: csrf },
      headers: { cookie: sessionCookie, origin },
      payload: { csrf, name: 'Nama Diperbarui' },
    });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe(
      '/account/profile?status=profileUpdated',
    );
    const page = await app.inject({
      url: '/account/profile?status=profileUpdated',
      headers: { cookie: sessionCookie },
    });
    expect(page.body).toContain('Nama Diperbarui');
  });

  it('changes the password, rotates the session and invalidates the old one', async () => {
    const previousCookie = sessionCookie;
    const response = await app.inject({
      method: 'POST',
      url: '/account/password',
      cookies: { lokka_customer_csrf: csrf },
      headers: { cookie: sessionCookie, origin },
      payload: {
        csrf,
        currentPassword: password,
        newPassword: 'kata-sandi-baru-yang-kuat',
        confirmPassword: 'kata-sandi-baru-yang-kuat',
      },
    });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/account?status=passwordUpdated');
    sessionCookie = cookieHeader(response.cookies);
    csrf = csrfOf(response.cookies);

    const stale = await app.inject({
      url: '/account',
      headers: { cookie: previousCookie },
    });
    expect(stale.statusCode).toBe(303);

    const fresh = await app.inject({
      url: '/account',
      headers: { cookie: sessionCookie },
    });
    expect(fresh.statusCode).toBe(200);
  });

  it('serves the Indonesian account routes', async () => {
    const login = await app.inject('/id/akun/masuk');
    expect(login.statusCode).toBe(200);
    expect(login.body).toContain('Selamat datang kembali');
    const register = await app.inject('/id/akun/daftar');
    expect(register.statusCode).toBe(200);
    expect(register.body).toContain('Buat akun');
  });

  it('logs out and clears the session', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/account/logout',
      cookies: { lokka_customer_csrf: csrf },
      headers: { cookie: sessionCookie, origin },
      payload: { csrf },
    });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/account/login');
    const after = await app.inject({
      url: '/account',
      headers: { cookie: sessionCookie },
    });
    expect(after.statusCode).toBe(303);
  });

  it('keeps customer and admin authentication isolated', async () => {
    const response = await app.inject({
      url: '/admin',
      headers: { cookie: sessionCookie },
    });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/admin/login');
  });
});
