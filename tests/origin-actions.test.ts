import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { accountingFixture } from './helpers/accounting-fixture.js';
import { buildApp } from '../src/app.js';
import { readEnv } from '../src/config/env.js';
import {
  financialTransactions,
  productVariants,
  sales,
} from '../src/db/schema/index.js';

const canonical = 'http://192.168.1.122:3000';
const supported = [canonical, 'http://127.0.0.1:3000', 'http://localhost:3000'];
let f: Awaited<ReturnType<typeof accountingFixture>>;
let app: FastifyInstance;
const cookies = (values: { name: string; value: string }[]) =>
  values
    .filter((c) => c.value)
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
async function login(
  target: FastifyInstance,
  surface: 'admin' | 'pos',
  origin = canonical,
) {
  const response = await target.inject(`/${surface}/login`);
  const csrf = response.cookies.find(
    (c) =>
      c.name ===
      (surface === 'admin' ? 'lokka_login_csrf' : 'lokka_pos_login_csrf'),
  )!.value;
  const result = await target.inject({
    method: 'POST',
    url: `/${surface}/login`,
    headers: { origin },
    cookies: Object.fromEntries(response.cookies.map((c) => [c.name, c.value])),
    payload: {
      csrf,
      email: f.admin.email,
      password: 'temporary-accounting-password',
    },
  });
  expect(result.statusCode).toBe(303);
  return {
    cookie: cookies(result.cookies),
    csrf: result.cookies.find(
      (c) =>
        c.name ===
        (surface === 'admin' ? 'lokka_admin_csrf' : 'lokka_pos_csrf'),
    )!.value,
  };
}
beforeAll(async () => {
  f = await accountingFixture();
  app = await buildApp(
    readEnv({
      ...process.env,
      APP_RUNTIME: 'fastify',
      DATABASE_URL: f.url,
      NODE_ENV: 'test',
      APP_URL: canonical,
      DEV_ALLOWED_ORIGINS: supported.slice(1).join(','),
    }),
    { database: { ...f.database, close: async () => {} }, logger: false },
  );
}, 60000);
afterAll(async () => {
  await app?.close();
  await f?.cleanup();
});

describe('cross-module mutation origin regressions', () => {
  it('does not advertise unsupported COOP on plain-HTTP LAN development', async () => {
    expect(
      (await app.inject('/admin/login')).headers['cross-origin-opener-policy'],
    ).toBeUndefined();
  });
  it.each(supported)(
    'allows real admin, finance, fulfillment and POS mutations from %s',
    async (origin) => {
      const admin = await login(app, 'admin', origin);
      const post = (url: string, payload: Record<string, unknown>) =>
        app.inject({
          method: 'POST',
          url,
          headers: { origin, cookie: admin.cookie },
          payload: { csrf: admin.csrf, ...payload },
        });
      expect(
        (
          await post(`/admin/products/${f.product.id}`, {
            name: f.product.name,
            slug: f.product.slug,
            status: 'active',
          })
        ).statusCode,
      ).toBe(303);
      expect(
        (
          await post('/admin/finance/income-expense', {
            direction: 'EXPENSE',
            category: 'PACKAGING',
            amountRupiah: '50000',
            occurredAt: new Date().toISOString().slice(0, 16),
          })
        ).statusCode,
      ).toBe(303);
      expect(
        (
          await post('/admin/settings/fulfillment', {
            name: 'Origin QA',
            contactName: 'QA',
            phone: '+628000000000',
            addressLine1: 'QA address',
            district: 'QA district',
            city: 'QA city',
            province: 'QA province',
            postalCode: '12345',
            countryCode: 'ID',
            status: 'active',
          })
        ).statusCode,
      ).toBe(303);
      const pos = await login(app, 'pos', origin);
      const result = await app.inject({
        method: 'POST',
        url: '/pos/api/sales',
        headers: { origin, cookie: pos.cookie },
        payload: {
          csrf: pos.csrf,
          items: [{ variantId: f.variant.id, quantity: 1 }],
          cashTendered: '795000',
        },
      });
      expect(result.statusCode).toBe(200);
      const sale = result.json<{ saleId: string }>();
      expect(
        await f.db
          .select()
          .from(financialTransactions)
          .where(eq(financialTransactions.saleId, sale.saleId)),
      ).toMatchObject([{ amountRupiah: 795000n }]);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/pos/logout',
            headers: { origin, cookie: pos.cookie },
            payload: { csrf: pos.csrf },
          })
        ).statusCode,
      ).toBe(303);
      expect((await post('/admin/logout', {})).statusCode).toBe(303);
    },
  );
  it.each(supported)(
    'keeps customer EN/ID registration/profile/logout working from %s',
    async (origin) => {
      for (const [index, prefix] of ['/account', '/id/akun'].entries()) {
        const register =
          index === 0 ? `${prefix}/register` : `${prefix}/daftar`;
        const profile = index === 0 ? `${prefix}/profile` : `${prefix}/profil`;
        const logout = index === 0 ? `${prefix}/logout` : `${prefix}/keluar`;
        const open = await app.inject(register);
        const token = open.cookies.find(
          (c) => c.name === 'lokka_customer_login_csrf',
        )!.value;
        const result = await app.inject({
          method: 'POST',
          url: register,
          headers: { origin },
          cookies: { lokka_customer_login_csrf: token },
          payload: {
            csrf: token,
            name: 'Origin QA customer',
            email: `origin-${supported.indexOf(origin)}-${index}@example.test`,
            password: 'temporary-customer-password',
            confirmPassword: 'temporary-customer-password',
          },
        });
        expect(result.statusCode).toBe(303);
        const cookie = cookies(result.cookies);
        const csrf = result.cookies.find(
          (c) => c.name === 'lokka_customer_csrf',
        )!.value;
        expect(
          (
            await app.inject({
              method: 'POST',
              url: profile,
              headers: { origin, cookie },
              payload: { csrf, name: 'Updated origin customer' },
            })
          ).statusCode,
        ).toBe(303);
        expect(
          (
            await app.inject({
              method: 'POST',
              url: profile,
              headers: { origin, cookie },
              payload: { name: 'No CSRF' },
            })
          ).statusCode,
        ).toBe(403);
        expect(
          (
            await app.inject({
              method: 'POST',
              url: logout,
              headers: { origin, cookie },
              payload: { csrf },
            })
          ).statusCode,
        ).toBe(303);
      }
    },
  );
  it('blocks forged Origin for every mutation surface before any domain writes, regardless of forwarded headers', async () => {
    const admin = await login(app, 'admin');
    const pos = await login(app, 'pos');
    const saleCount = (await f.db.select().from(sales)).length;
    const financeCount = (await f.db.select().from(financialTransactions))
      .length;
    const stock = (
      await f.db
        .select()
        .from(productVariants)
        .where(eq(productVariants.id, f.variant.id))
    )[0]!.stockQuantity;
    for (const origin of [
      'http://evil.example',
      'http://127.0.0.1:9999',
      'not-an-origin',
      'null',
      '',
    ]) {
      for (const url of [
        '/admin/login',
        `/admin/products/${f.product.id}`,
        '/admin/finance/income-expense',
        '/admin/settings/fulfillment',
        '/admin/logout',
        '/pos/login',
        '/pos/api/sales',
        '/pos/logout',
        '/account/register',
        '/account/login',
        '/account/profile',
        '/account/password',
        '/account/logout',
        '/id/akun/daftar',
        '/id/akun/masuk',
        '/id/akun/profil',
        '/id/akun/kata-sandi',
        '/id/akun/keluar',
      ]) {
        const identity = url.startsWith('/pos') ? pos : admin;
        const response = await app.inject({
          method: 'POST',
          url,
          headers: {
            origin,
            cookie: identity.cookie,
            host: '192.168.1.122:3000',
            referer: `${canonical}/admin`,
            'x-forwarded-host': '192.168.1.122:3000',
            'x-forwarded-proto': 'http',
          },
          payload: {
            csrf: identity.csrf,
            items: [{ variantId: f.variant.id, quantity: 1 }],
            cashTendered: '795000',
          },
        });
        expect(response.statusCode, `${url} from ${origin}`).toBe(403);
        expect(response.body).toContain('Invalid origin');
      }
    }
    expect((await f.db.select().from(sales)).length).toBe(saleCount);
    expect((await f.db.select().from(financialTransactions)).length).toBe(
      financeCount,
    );
    expect(
      (
        await f.db
          .select()
          .from(productVariants)
          .where(eq(productVariants.id, f.variant.id))
      )[0]!.stockQuantity,
    ).toBe(stock);
  });
  it('preserves missing-Origin clients while requiring CSRF on admin/finance/POS', async () => {
    const admin = await login(app, 'admin');
    const pos = await login(app, 'pos');
    const expense = {
      direction: 'EXPENSE',
      category: 'PACKAGING',
      amountRupiah: '1000',
      occurredAt: new Date().toISOString().slice(0, 16),
    };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/admin/finance/income-expense',
          headers: { cookie: admin.cookie },
          payload: { csrf: admin.csrf, ...expense },
        })
      ).statusCode,
    ).toBe(303);
    for (const url of ['/admin/finance/income-expense', '/pos/api/sales']) {
      const cookie = url.startsWith('/pos') ? pos.cookie : admin.cookie;
      for (const csrf of [undefined, 'invalid'])
        expect(
          (
            await app.inject({
              method: 'POST',
              url,
              headers: { origin: canonical, cookie },
              payload: { csrf, ...expense },
            })
          ).statusCode,
        ).toBe(403);
    }
  });
  it('accepts configured HTTPS public origin behind Nginx without trusting request Host or forwarded headers', async () => {
    const publicOrigin = 'https://shop.example';
    const production = await buildApp(
      readEnv({
        ...process.env,
        APP_RUNTIME: 'fastify',
        DATABASE_URL: f.url,
        NODE_ENV: 'production',
        APP_URL: publicOrigin,
        TRUST_PROXY: 'true',
        DEV_ALLOWED_ORIGINS: supported.join(','),
      }),
      { database: { ...f.database, close: async () => {} }, logger: false },
    );
    try {
      expect(
        (await production.inject('/admin/login')).headers[
          'cross-origin-opener-policy'
        ],
      ).toBe('same-origin');
      const admin = await login(production, 'admin', publicOrigin);
      const data = {
        csrf: admin.csrf,
        direction: 'EXPENSE',
        category: 'PACKAGING',
        amountRupiah: '1000',
        occurredAt: new Date().toISOString().slice(0, 16),
      };
      const headers = {
        cookie: admin.cookie,
        host: '127.0.0.1:3000',
        'x-forwarded-host': 'shop.example',
        'x-forwarded-proto': 'https',
      };
      expect(
        (
          await production.inject({
            method: 'POST',
            url: '/admin/finance/income-expense',
            headers: { ...headers, origin: publicOrigin },
            payload: data,
          })
        ).statusCode,
      ).toBe(303);
      for (const origin of [
        canonical,
        'http://127.0.0.1:3000',
        'https://evil.example',
      ])
        expect(
          (
            await production.inject({
              method: 'POST',
              url: '/admin/finance/income-expense',
              headers: { ...headers, origin },
              payload: data,
            })
          ).statusCode,
        ).toBe(403);
    } finally {
      await production.close();
    }
  });
});
