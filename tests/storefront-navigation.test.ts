import { beforeAll, afterAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { storefrontNavigationFixture } from './helpers/storefront-navigation-fixture.js';
import { buildApp } from '../src/app.js';
import { readEnv } from '../src/config/env.js';
import { customers } from '../src/db/schema/index.js';
import type { FastifyInstance } from 'fastify';
import ejs from 'ejs';
import { orderedLocales } from '../src/i18n/index.js';
import { t } from '../src/i18n/translator.js';

let f: Awaited<ReturnType<typeof storefrontNavigationFixture>>;
let app: FastifyInstance;
const header = (html: string) =>
  html.match(/<header class="site-header"[\s\S]*?<\/header>/)![0];
beforeAll(async () => {
  f = await storefrontNavigationFixture();
  app = await buildApp(
    readEnv({
      ...process.env,
      APP_RUNTIME: 'fastify',
      NODE_ENV: 'test',
      DATABASE_URL: f.url,
    }),
    { database: { ...f.database, close: async () => {} }, logger: false },
  );
}, 60000);
afterAll(async () => {
  await app?.close();
  await f?.cleanup();
}, 30000);

it('uses ordered, active translated root categories across storefront and account pages', async () => {
  for (const [locale, paths] of [
    [
      'en',
      [
        '/',
        '/collections',
        '/category/ready-to-wear',
        `/product/${f.product.slug}`,
        '/account/login',
      ],
    ],
    [
      'id',
      [
        '/id',
        '/id/koleksi',
        '/id/kategori/siap-pakai',
        `/id/produk/${f.product.slug}`,
        '/id/akun/masuk',
      ],
    ],
  ] as const) {
    for (const path of paths) {
      const response = await app.inject(path);
      expect(response.statusCode).toBe(200);
      const nav = header(response.body);
      expect(nav).toContain(
        locale === 'en' ? '/category/ready-to-wear' : '/id/kategori/siap-pakai',
      );
      expect(nav).toContain(
        locale === 'en' ? 'Ready to Wear' : 'Busana Siap Pakai',
      );
      expect(
        nav.indexOf(locale === 'en' ? 'First category' : 'ID First category'),
      ).toBeLessThan(
        nav.indexOf(locale === 'en' ? 'Ready to Wear' : 'Busana Siap Pakai'),
      );
      expect(nav).not.toContain('hidden-category');
      expect(nav).not.toContain('child-category');
      const categoryNav = nav.match(/<nav class="main-nav"[\s\S]*?<\/nav>/)![0];
      expect(categoryNav).not.toContain('href="/collections"');
      expect(categoryNav).not.toContain('href="/id/koleksi"');
      expect(nav).toContain(locale === 'en' ? 'Sign in' : 'Masuk');
    }
  }
  expect((await app.inject('/id/collections')).headers.location).toBe(
    '/id/koleksi',
  );
  expect((await app.inject('/')).body).toContain(
    'class="btn btn-primary" href="/collections"',
  );
  expect(
    (await f.catalog.allCategories()).some((c) => c.slug === 'collections'),
  ).toBe(false);
  const expiredLogin = await app.inject({
    method: 'POST',
    url: '/account/login',
    payload: { csrf: 'expired' },
  });
  expect(expiredLogin.statusCode).toBe(403);
  expect(header(expiredLogin.body)).toContain('/category/ready-to-wear');
});

it('shows only the authenticated customer name in EN/ID and retains the account target', async () => {
  for (const [path, target] of [
    ['/', '/account'],
    ['/id', '/id/akun'],
    ['/account/profile', '/account'],
    ['/id/akun/profil', '/id/akun'],
  ]) {
    const response = await app.inject({
      url: path!,
      cookies: {
        lokka_customer: f.customer.sessionToken,
        lokka_customer_csrf: f.customer.csrfToken,
      },
    });
    expect(response.statusCode).toBe(200);
    const nav = header(response.body);
    expect(nav).toContain('>Diego</a>');
    expect(nav).toContain(`href="${target}"`);
    expect(nav).not.toContain('>Account</a>');
    for (const secret of [
      f.customer.customer.passwordHash,
      f.customer.sessionToken,
      f.customer.customer.id,
      f.customer.customer.email,
    ])
      expect(nav).not.toContain(secret);
    expect(response.headers['cache-control']).toBe('private, no-store');
  }
  const wrongSession = await app.inject({
    url: '/',
    cookies: {
      lokka_admin: f.customer.sessionToken,
      lokka_pos: f.customer.sessionToken,
    },
  });
  expect(header(wrongSession.body)).toContain('>Sign in</a>');
});

it('escapes authenticated profile names', async () => {
  try {
    for (const [name, en, id] of [
      [
        '<script>alert(1)</script>',
        '&lt;script&gt;alert(1)&lt;/script&gt;',
        '&lt;script&gt;alert(1)&lt;/script&gt;',
      ],
    ]) {
      await f.db
        .update(customers)
        .set({ name: name!, updatedAt: new Date() })
        .where(eq(customers.id, f.customer.customer.id));
      for (const [path, expected] of [
        ['/', en],
        ['/id', id],
      ]) {
        const response = await app.inject({
          url: path!,
          cookies: { lokka_customer: f.customer.sessionToken },
        });
        const nav = header(response.body);
        expect(nav).toContain(`>${expected}</a>`);
        expect(nav).not.toContain('<script>');
        expect(nav).not.toContain('diego@example.test');
      }
    }
  } finally {
    await f.auth.updateName(f.customer.customer.id, 'Diego');
  }
});

it('uses localized Account for missing or whitespace-only name presentation', async () => {
  // The DB requires a nonblank name; exercise the defensive view contract
  // directly without weakening or bypassing that schema constraint.
  for (const locale of ['en', 'id'] as const) {
    for (const name of [null, undefined, '', '   ']) {
      const nav = await ejs.renderFile('views/partials/header.ejs', {
        locale,
        locales: orderedLocales,
        customer: { name },
        navigationCategories: [],
        t: (key: string) => t(locale, key),
      });
      expect(nav).toContain(`>${locale === 'en' ? 'Account' : 'Akun'}</a>`);
      expect(nav).toContain(
        `href="${locale === 'en' ? '/account' : '/id/akun'}"`,
      );
    }
  }
});
