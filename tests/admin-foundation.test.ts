import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { commercialDatabase } from './helpers/commercial-database.js';
import { buildApp } from '../src/app.js';
import { readEnv } from '../src/config/env.js';
import { adminUsers, vendors } from '../src/db/schema/index.js';
import { hashPassword } from '../src/modules/auth/service.js';
import { createCatalog } from '../src/modules/catalog/service.js';
import { LocalCatalogImageStorage } from '../src/modules/catalog/storage.js';

let fixture: Awaited<ReturnType<typeof commercialDatabase>>;
let app: FastifyInstance;
let cookie = '';
let csrf = '';
let productId = '';
let categoryId = '';
let catalog: ReturnType<typeof createCatalog>;
beforeAll(async () => {
  fixture = await commercialDatabase();
  const db = fixture.database.db;
  await db
    .insert(vendors)
    .values({ slug: 'lokka', name: 'LOKKA', status: 'active' });
  await db.insert(adminUsers).values({
    email: 'foundation@example.test',
    name: 'Office <Admin>',
    passwordHash: await hashPassword('foundation-test-password'),
  });
  catalog = createCatalog(
    db,
    new LocalCatalogImageStorage('storage/tests/admin-foundation'),
  );
  productId = (
    await catalog.saveProduct({ name: 'Foundation product', status: 'draft' })
  ).id;
  categoryId = (
    await catalog.saveCategory({
      name: 'Foundation category',
      status: 'hidden',
    })
  ).id;
  app = await buildApp(
    readEnv({
      ...process.env,
      APP_RUNTIME: 'fastify',
      DATABASE_URL: fixture.url,
      NODE_ENV: 'test',
      APP_URL: 'http://localhost:3000',
    }),
    { database: { ...fixture.database, close: async () => {} }, logger: false },
  );
  app.get('/admin/test-failure', async () => {
    throw new Error('private diagnostic');
  });
  const login = await app.inject('/admin/login');
  const loginCsrf = login.cookies.find(
    (c) => c.name === 'lokka_login_csrf',
  )!.value;
  const response = await app.inject({
    method: 'POST',
    url: '/admin/login',
    cookies: { lokka_login_csrf: loginCsrf },
    payload: {
      csrf: loginCsrf,
      email: 'foundation@example.test',
      password: 'foundation-test-password',
    },
  });
  expect(response.statusCode).toBe(303);
  cookie = response.cookies
    .filter((c) => c.value)
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  csrf = response.cookies.find((c) => c.name === 'lokka_admin_csrf')!.value;
}, 30000);
afterAll(async () => {
  await app?.close();
  await fixture?.cleanup();
});
const get = (url: string) => app.inject({ url, headers: { cookie } });
describe('admin presentation boundaries', () => {
  it('uses a dedicated auth layout with real email login and isolated assets', async () => {
    const response = await app.inject('/admin/login');
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('data-admin-layout="auth"');
    expect(response.body).toMatch(/\/build\/admin\.[^"]+\.css/);
    expect(response.body).not.toContain('/build/main.');
    expect(response.body).not.toMatch(
      /site-header|site-footer|account-layout|remember|forgot|lokka_logo\.png/,
    );
    expect(response.body).toContain('data-admin-password');
  });
  it('renders only implemented navigation and escapes the validated admin identity', async () => {
    const response = await get('/admin');
    expect(response.body).toContain('data-admin-layout="backoffice"');
    expect(response.body).toContain('Office &lt;Admin&gt;');
    expect(response.body).not.toContain('Office <Admin>');
    const nav = response.body.match(
      /<nav aria-label="Admin">([\s\S]*?)<\/nav>/,
    )![1]!;
    for (const path of [
      '/admin',
      '/admin/products',
      '/admin/categories',
      '/admin/inventory',
      '/admin/media',
      '/pos',
      '/admin/finance/cash-flow',
      '/admin/finance/income-expense',
      '/admin/finance/accounting',
      '/admin/finance/overhead',
      '/admin/settings/fulfillment',
      '/admin/settings/homepage',
    ])
      expect(nav).toContain(`href="${path}"`);
    expect(nav.match(/href=/g)).toHaveLength(12);
    expect(nav).not.toMatch(
      /Orders|Customers|Story|Lookbook|Legal|Tax|SMEXPO|Reports|User Management/,
    );
    expect(response.body).toContain('aria-controls="admin-sidebar"');
    expect(response.body).toContain('aria-expanded="false"');
  });
  it('includes a Sales → POS shortcut linking to the separate POS surface', async () => {
    const response = await get('/admin');
    const nav = response.body.match(
      /<nav aria-label="Admin">([\s\S]*?)<\/nav>/,
    )![1]!;
    expect(nav).toContain('Sales');
    expect(nav).toContain('POS');
    expect(nav).toContain('href="/pos"');
    expect(nav).not.toMatch(/href="\/pos\/login"/);
    expect(nav).not.toMatch(/href="\/admin\/pos"/);
  });
  it('does not expose POS in customer/public navigation', async () => {
    for (const url of ['/', '/collections', '/account/login']) {
      const response = await app.inject(url);
      expect(response.body).not.toContain('href="/pos"');
      expect(response.body).not.toMatch(/>POS</);
    }
  });
  it('keeps nested product pages active and all pages in one shell', async () => {
    const pages: [string, string][] = [
      ['/admin', '/admin'],
      ['/admin/products', '/admin/products'],
      ['/admin/products/new', '/admin/products'],
      [`/admin/products/${productId}/edit`, '/admin/products'],
      [`/admin/products/${productId}/pricing`, '/admin/products'],
      ['/admin/categories', '/admin/categories'],
      ['/admin/categories/new', '/admin/categories'],
      [`/admin/categories/${categoryId}/edit`, '/admin/categories'],
      ['/admin/inventory', '/admin/inventory'],
      ['/admin/media', '/admin/media'],
      ['/admin/finance/cash-flow', '/admin/finance/cash-flow'],
      ['/admin/finance/income-expense', '/admin/finance/income-expense'],
      ['/admin/finance/overhead', '/admin/finance/overhead'],
      ['/admin/settings/fulfillment', '/admin/settings/fulfillment'],
    ];
    for (const [url, active] of pages) {
      const response = await get(url);
      expect(response.statusCode, url).toBe(200);
      expect(response.body, url).toContain('data-admin-layout="backoffice"');
      expect(response.body, url).toMatch(
        new RegExp(`href="${active}"[^>]*aria-current="page"`),
      );
      expect(response.body.match(/<main\b/g), url).toHaveLength(1);
      expect(response.body.match(/<h1\b/g), url).toHaveLength(1);
      expect(response.body, url).not.toMatch(
        /site-header|site-footer|\/build\/main\./,
      );
    }
  });
  it('preserves invalid form data, mutation CSRF and upload field order', async () => {
    const rejected = await app.inject({
      method: 'POST',
      url: '/admin/products',
      headers: { cookie },
      payload: { name: 'No CSRF', status: 'draft' },
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.body).toContain('Access denied');
    expect(rejected.body).not.toContain('site-header');
    const invalid = await app.inject({
      method: 'POST',
      url: '/admin/products',
      headers: { cookie },
      payload: { csrf, name: 'Preserved name', status: 'invalid' },
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.body).toContain('Preserved name');
    expect(invalid.body).toContain('role="alert"');
    const page = await get(`/admin/products/${productId}/edit`);
    const upload = page.body.match(
      /<form[^>]*enctype="multipart\/form-data"[\s\S]*?<\/form>/,
    )![0];
    expect(upload.match(/<input[^>]+name="([^"]+)"/)![1]).toBe('csrf');
  });
  it('renders internal 404 and 500 without storefront chrome or sensitive diagnostics', async () => {
    for (const [url, status] of [
      ['/admin/missing', 404],
      ['/admin/test-failure', 500],
    ] as const) {
      const response = await app.inject(url);
      expect(response.statusCode).toBe(status);
      expect(response.body).toContain('data-admin-layout="auth"');
      expect(response.body).not.toMatch(
        /site-header|site-footer|private diagnostic|Office &lt;Admin&gt;/,
      );
      expect(response.headers['cache-control']).toContain('no-store');
      expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
    }
  });
  it('leaves public and customer rendering on the original assets and layout', async () => {
    for (const url of [
      '/',
      '/id',
      '/collections',
      '/id/koleksi',
      '/account/login',
      '/account/register',
      '/id/akun/masuk',
      '/id/akun/daftar',
    ]) {
      const response = await get(url);
      expect(response.statusCode, url).toBe(200);
      expect(response.body, url).toContain('site-header');
      expect(response.body, url).toContain('site-footer');
      expect(response.body, url).toContain('/build/main.');
      expect(response.body, url).not.toMatch(
        /data-admin-layout|\/build\/admin\.|Office &lt;Admin&gt;/,
      );
    }
    expect((await app.inject('/admin')).statusCode).toBe(303);
    expect((await get('/account')).statusCode).toBe(303);
  });
  it('auto-creates an English translation when creating a product via admin form', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/products',
      headers: { cookie },
      payload: {
        csrf,
        name: 'Admin Auto Translate Product',
        status: 'draft',
      },
    });
    expect(res.statusCode).toBe(303);
    const match = res.headers.location!.match(
      /\/admin\/products\/([^/]+)\/edit/,
    );
    const id = match![1]!;
    const translation = await catalog.productTranslationFor(id, 'en');
    expect(translation).not.toBeNull();
    expect(translation!.name).toBe('Admin Auto Translate Product');
  });
});
