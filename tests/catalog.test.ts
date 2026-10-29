import 'dotenv/config';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { mkdir, readdir } from 'node:fs/promises';
import sharp from 'sharp';
import { buildApp } from '../src/app.js';
import { readEnv } from '../src/config/env.js';
import { createDatabase } from '../src/db/client.js';
import { commercialDatabase } from './helpers/commercial-database.js';
import {
  adminUsers,
  adminSessions,
  categories,
  products,
  vendors,
  productTranslations,
  categoryTranslations,
} from '../src/db/schema/index.js';
import { hashPassword, token, hashToken } from '../src/modules/auth/service.js';
import { createCatalog } from '../src/modules/catalog/service.js';
import { LocalCatalogImageStorage } from '../src/modules/catalog/storage.js';
import {
  formatIdr,
  variantInput,
  slug,
} from '../src/modules/catalog/validation.js';
import type { FastifyInstance } from 'fastify';

let fixture: Awaited<ReturnType<typeof commercialDatabase>>;
const run = randomUUID();
const env = readEnv({
  ...process.env,
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3000',
  CATALOG_STORAGE_ROOT: `storage/tests/${run}`,
});
let database: ReturnType<typeof createDatabase>;
let storage: LocalCatalogImageStorage;
let catalog: ReturnType<typeof createCatalog>;
let app: FastifyInstance;
let userId: string;
let cookie = '';
let csrf = '';
const password = token();
const categoryIds: string[] = [];
const productIds: string[] = [];
const imageKeys: string[] = [];
async function login(pass = password) {
  const page = await app.inject('/admin/login');
  const loginCookie = page.cookies.find(
    (c) => c.name === 'lokka_login_csrf',
  )!.value;
  return app.inject({
    method: 'POST',
    url: '/admin/login',
    cookies: { lokka_login_csrf: loginCookie },
    payload: {
      csrf: loginCookie,
      email: `${run}@example.test`,
      password: pass,
    },
  });
}
const post = (url: string, payload: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url,
    headers: { cookie },
    payload: { csrf, ...payload },
  });

/** Helper: create English + Indonesian translations for a product */
async function createProductTranslations(
  productId: string,
  nameEn: string,
  slugEn: string,
  nameId: string,
  slugId: string,
) {
  await catalog.saveProductTranslation(productId, 'en', {
    name: nameEn,
    slug: slugEn,
    shortDescription: 'English description',
  });
  await catalog.saveProductTranslation(productId, 'id', {
    name: nameId,
    slug: slugId,
    shortDescription: 'Deskripsi Indonesia',
  });
}

/** Helper: create English + Indonesian translations for a category */
async function createCategoryTranslations(
  categoryId: string,
  nameEn: string,
  slugEn: string,
  nameId: string,
  slugId: string,
) {
  await catalog.saveCategoryTranslation(categoryId, 'en', {
    name: nameEn,
    slug: slugEn,
  });
  await catalog.saveCategoryTranslation(categoryId, 'id', {
    name: nameId,
    slug: slugId,
  });
}

beforeAll(async () => {
  fixture = await commercialDatabase();
  database = fixture.database;
  storage = new LocalCatalogImageStorage(env.catalogStorageRoot);
  catalog = createCatalog(database.db, storage);
  await database.check();
  await database.db
    .insert(vendors)
    .values({ slug: 'lokka', name: 'LOKKA', status: 'active' })
    .onConflictDoNothing();
  const [user] = await database.db
    .insert(adminUsers)
    .values({
      email: `${run}@example.test`,
      name: 'Temporary verification admin',
      passwordHash: await hashPassword(password),
    })
    .returning();
  userId = user!.id;
  const testEnv = readEnv({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: fixture.url,
    APP_URL: 'http://localhost:3000',
    CATALOG_STORAGE_ROOT: `storage/tests/${run}`,
  });
  app = await buildApp(testEnv, {
    database: { db: database.db, check: database.check, close: async () => {} },
    logger: false,
  });
  const result = await login();
  expect(result.statusCode).toBe(303);
  cookie = result.cookies
    .filter((c) => c.value)
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  csrf = result.cookies.find((c) => c.name === 'lokka_admin_csrf')!.value;
}, 30000);
afterAll(async () => {
  if (productIds.length) {
    await database.db
      .delete(productTranslations)
      .where(inArray(productTranslations.productId, productIds));
    await database.db.delete(products).where(inArray(products.id, productIds));
  }
  if (categoryIds.length) {
    await database.db
      .delete(categoryTranslations)
      .where(inArray(categoryTranslations.categoryId, categoryIds));
    await database.db
      .update(categories)
      .set({ parentId: null })
      .where(inArray(categories.id, categoryIds));
    await database.db
      .delete(categories)
      .where(inArray(categories.id, categoryIds));
  }
  if (userId)
    await database.db.delete(adminUsers).where(eq(adminUsers.id, userId));
  await database.db.delete(vendors).where(eq(vendors.slug, 'lokka'));
  await Promise.all(imageKeys.map((key) => storage.remove(key)));
  await app?.close();
  await fixture?.cleanup();
}, 30000);
describe('admin security', () => {
  it('sets Secure cookies in production', async () => {
    const production = await buildApp(
      { ...env, nodeEnv: 'production' },
      { database: { ...database, close: async () => {} }, logger: false },
    );
    try {
      const loginPage = await production.inject('/admin/login');
      const challenge = loginPage.cookies.find(
        (c) => c.name === 'lokka_login_csrf',
      )!;
      expect(challenge.secure).toBe(true);
      const result = await production.inject({
        method: 'POST',
        url: '/admin/login',
        cookies: { lokka_login_csrf: challenge.value },
        payload: {
          email: `${run}@example.test`,
          password,
          csrf: challenge.value,
        },
      });
      expect(result.statusCode).toBe(303);
      expect(result.cookies.find((c) => c.name === 'lokka_admin')!.secure).toBe(
        true,
      );
      expect(
        result.cookies.find((c) => c.name === 'lokka_admin_csrf')!.secure,
      ).toBe(true);
    } finally {
      await production.close();
    }
  });
  it('valid login sets bounded HttpOnly cookies and stores only hashes', async () => {
    const result = await login();
    expect(result.statusCode).toBe(303);
    const sessionCookie = result.cookies.find((c) => c.name === 'lokka_admin')!;
    expect(sessionCookie.httpOnly).toBe(true);
    expect(sessionCookie.path).toBe('/admin');
    expect(sessionCookie.sameSite).toBe('Lax');
    const [session] = await database.db
      .select()
      .from(adminSessions)
      .where(eq(adminSessions.tokenHash, hashToken(sessionCookie.value)));
    expect(session!.tokenHash).not.toBe(sessionCookie.value);
    expect(session!.csrfTokenHash).not.toBe(
      result.cookies.find((c) => c.name === 'lokka_admin_csrf')!.value,
    );
  });
  it('rejects invalid login', async () => {
    expect((await login('incorrect password')).statusCode).toBe(401);
  });
  it.each([
    '/admin',
    '/admin/products',
    '/admin/categories',
    '/admin/inventory',
    '/admin/media',
  ])('protects %s', async (url) => {
    expect((await app.inject(url)).headers.location).toBe('/admin/login');
  });
  it('rejects invalid sessions', async () => {
    expect(
      (await app.inject({ url: '/admin', cookies: { lokka_admin: token() } }))
        .statusCode,
    ).toBe(303);
  });
  it.each(['http://localhost:3000', 'http://127.0.0.1:3000'])(
    'revokes sessions on logout from the configured origin %s',
    async (appUrl) => {
      const configuredApp = await buildApp(
        { ...env, appUrl },
        { database: { ...database, close: async () => {} }, logger: false },
      );
      try {
        const result = await login();
        const cookies = Object.fromEntries(
          result.cookies.filter((c) => c.value).map((c) => [c.name, c.value]),
        );
        const response = await configuredApp.inject({
          method: 'POST',
          url: '/admin/logout',
          headers: { origin: appUrl },
          cookies,
          payload: { csrf: cookies.lokka_admin_csrf },
        });
        expect(response.statusCode).toBe(303);
        expect(
          (await configuredApp.inject({ url: '/admin', cookies })).headers
            .location,
        ).toBe('/admin/login');
      } finally {
        await configuredApp.close();
      }
    },
  );
  it('rejects disabled admins and expired sessions', async () => {
    const result = await login();
    const cookies = Object.fromEntries(
      result.cookies.filter((c) => c.value).map((c) => [c.name, c.value]),
    );
    await database.db
      .update(adminSessions)
      .set({ expiresAt: new Date(0) })
      .where(eq(adminSessions.tokenHash, hashToken(cookies.lokka_admin!)));
    expect((await app.inject({ url: '/admin', cookies })).statusCode).toBe(303);
    await database.db
      .update(adminUsers)
      .set({ status: 'disabled' })
      .where(eq(adminUsers.id, userId));
    try {
      expect(
        (await app.inject({ url: '/admin', headers: { cookie } })).statusCode,
      ).toBe(303);
    } finally {
      await database.db
        .update(adminUsers)
        .set({ status: 'active' })
        .where(eq(adminUsers.id, userId));
    }
  });
  it('rejects missing CSRF', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/admin/categories',
          headers: { cookie },
          payload: { name: 'Bad' },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('rejects an origin that differs from configured localhost', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/admin/logout',
          headers: { cookie, origin: 'https://foreign.test' },
          payload: { csrf },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('accepts loopback alias http://127.0.0.1 in development', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/admin/categories',
          headers: { cookie, origin: 'http://127.0.0.1:3000' },
          payload: { csrf, name: '', status: 'hidden' },
        })
      ).statusCode,
    ).not.toBe(403);
  });
  it('cannot bypass logout CSRF using multipart', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/admin/logout',
          headers: {
            cookie,
            'content-type': 'multipart/form-data; boundary=x',
          },
          payload: '--x--\r\n',
        })
      ).statusCode,
    ).toBe(403);
  });
  it('marks admin pages noindex and does not cache', async () => {
    const response = await app.inject({ url: '/admin', headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-robots-tag']).toContain('noindex');
    expect(response.headers['cache-control']).toContain('no-store');
  });
});
describe('catalog workflow', () => {
  it('paginates 24 products and filters by category with page canonicals', async () => {
    const category = await catalog.saveCategory({
      name: `Pagination ${run}`,
      slug: `pagination-${run}`,
      status: 'active',
      sortOrder: '0',
    });
    categoryIds.push(category.id);
    // Create translations for the category
    await createCategoryTranslations(
      category.id,
      `Pagination ${run}`,
      `pagination-${run}`,
      `Paginasi ${run}`,
      `paginasi-${run}`,
    );
    const [vendor] = await database.db
      .select()
      .from(vendors)
      .where(eq(vendors.slug, 'lokka'));
    const rows = await database.db
      .insert(products)
      .values(
        Array.from({ length: 25 }, (_, index) => ({
          name: `Page item ${index}`,
          slug: `page-${run}-${index}`,
          vendorId: vendor!.id,
          categoryId: category.id,
          status: 'active' as const,
        })),
      )
      .returning();
    productIds.push(...rows.map((r) => r.id));
    // Create translations for the first product to test locale routing
    await createProductTranslations(
      rows[0]!.id,
      `Page item 0`,
      `page-${run}-0`,
      `Item halaman 0`,
      `item-halaman-${run}-0`,
    );
    expect((await catalog.publicList(1, category.id)).rows).toHaveLength(24);
    expect((await catalog.publicList(2, category.id)).rows).toHaveLength(1);
    // Test locale-aware category route
    const response = await app.inject(`/id/kategori/paginasi-${run}?page=2`);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(`paginasi-${run}?page=2`);
    expect(
      (await app.inject(`/id/kategori/paginasi-${run}?page=3`)).statusCode,
    ).toBe(404);
    // Old route redirects to locale-prefixed
    expect((await app.inject(`/kategori/pagination-${run}`)).statusCode).toBe(
      301,
    );
    expect((await catalog.publicList(1, randomUUID())).rows).toHaveLength(0);
    await database.db
      .update(products)
      .set({ status: 'draft' })
      .where(
        inArray(
          products.id,
          rows.map((r) => r.id),
        ),
      );
    expect((await catalog.publicList(1, category.id)).rows).toHaveLength(0);
  });
  it('creates category/product/variant, updates inventory and renders public SEO', async () => {
    const categoryForm = {
      name: `Category ${run}`,
      slug: `category-${run}`,
      status: 'active',
      sortOrder: '0',
    };
    expect((await post('/admin/categories', categoryForm)).statusCode).toBe(
      303,
    );
    const category = (await catalog.categoryList()).find(
      (c) => c.slug === categoryForm.slug,
    )!;
    categoryIds.push(category.id);
    // Create translations for the category
    await createCategoryTranslations(
      category.id,
      `Category ${run}`,
      `category-${run}`,
      `Kategori ${run}`,
      `kategori-${run}`,
    );
    const duplicate = await post('/admin/categories', categoryForm);
    expect(duplicate.statusCode).toBe(422);
    expect(duplicate.body).toContain(categoryForm.name);
    const productForm = {
      name: `Batik ${run}`,
      slug: `batik-${run}`,
      status: 'active',
      categoryId: category.id,
      shortDescription: 'Batik Indonesia',
      description: 'Detail kain',
      seoTitle: 'Batik pilihan',
    };
    const created = await post('/admin/products', {
      ...productForm,
      status: 'draft',
    });
    expect(created.statusCode).toBe(303);
    const productId = created.headers.location!.split('/')[3]!;
    productIds.push(productId);
    // Create translations for the product
    await createProductTranslations(
      productId,
      `Batik ${run}`,
      `batik-${run}`,
      `Batik ${run}`,
      `batik-${run}`,
    );
    const variant = {
      name: 'M',
      sku: `SKU-${run}`,
      price: '695000',
      compareAtPrice: '795000',
      stockQuantity: '10',
      weightGrams: '300',
      status: 'active',
      sortOrder: '0',
    };
    expect(
      (await post(`/admin/products/${productId}/variants`, variant)).statusCode,
    ).toBe(303);
    expect(
      (await post(`/admin/products/${productId}/variants`, variant)).statusCode,
    ).toBe(422);
    const related = await catalog.relations([productId]);
    await catalog.saveProduct(productForm, productId);
    const variantId = related.variants[0]!.id;
    expect(
      (
        await post(`/admin/products/${productId}/variants/${variantId}/stock`, {
          stockQuantity: '3',
        })
      ).statusCode,
    ).toBe(303);
    expect(
      (
        await post(`/admin/products/${productId}/variants/${variantId}/stock`, {
          stockQuantity: '-1',
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (await catalog.relations([productId])).variants[0]!.stockQuantity,
    ).toBe(3);
    // Test locale-aware product route
    const detail = await app.inject(`/product/batik-${run}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.body).toContain('Rp695,000');
    expect(detail.body).toContain('application/ld+json');
    expect(detail.body).toContain('"price":"695000"');
    expect(detail.body).not.toContain('ratingValue');
    // Test Indonesian locale route
    const detailId = await app.inject(`/id/produk/batik-${run}`);
    expect(detailId.statusCode).toBe(200);
    expect(detailId.body).toContain('Rp695.000');
    // Test category route
    expect((await app.inject(`/category/category-${run}`)).statusCode).toBe(
      200,
    );
    expect((await app.inject(`/id/kategori/kategori-${run}`)).statusCode).toBe(
      200,
    );
    expect((await app.inject('/id/koleksi')).statusCode).toBe(200);
    // Sitemap should contain both locale URLs
    const sitemap = (await app.inject('/sitemap.xml')).body;
    expect(sitemap).toContain(`/product/batik-${run}`);
    expect(sitemap).toContain(`/id/produk/batik-${run}`);
    for (const url of [
      `/admin/products/${productId}/edit`,
      `/admin/categories/${category.id}/edit`,
      '/admin/products/new',
      '/admin/categories/new',
      '/admin/inventory',
      '/admin/media',
    ])
      expect((await app.inject({ url, headers: { cookie } })).statusCode).toBe(
        200,
      );
    expect(
      (
        await post(`/admin/products/${productId}`, {
          ...productForm,
          name: `Edited ${run}`,
        })
      ).statusCode,
    ).toBe(303);
    // Copied fallback text follows the base edit; distinct translations remain.
    expect((await app.inject(`/product/batik-${run}`)).body).toContain(
      `Edited ${run}`,
    );
    // Multipart upload exercises authentication, first-part CSRF, decode, DB and disk.
    const picture = await sharp({
      create: { width: 1000, height: 1250, channels: 3, background: '#70483b' },
    })
      .png()
      .toBuffer();
    const boundary = `lokka-${run}`;
    const upload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="csrf"\r\n\r\n${csrf}\r\n--${boundary}\r\nContent-Disposition: form-data; name="images"; filename="../../fake.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      picture,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const uploaded = await app.inject({
      method: 'POST',
      url: `/admin/products/${productId}/images`,
      headers: {
        cookie,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: upload,
    });
    expect(uploaded.statusCode).toBe(303);
    await catalog.addImages(productId, [picture], 'Second image');
    const images = (await catalog.relations([productId])).images;
    imageKeys.push(...images.map((i) => i.storageKey));
    expect(images.filter((i) => i.isPrimary)).toHaveLength(1);
    for (const [size, max] of [
      ['thumb', 400],
      ['card', 800],
      ['detail', 1600],
    ] as const) {
      const meta = await sharp(
        await storage.read(images[0]!.storageKey, size),
      ).metadata();
      expect(meta.format).toBe('webp');
      expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(max);
      expect(meta.exif).toBeUndefined();
    }
    expect(
      (await app.inject(storage.url(images[0]!.storageKey, 'card'))).statusCode,
    ).toBe(200);
    expect(
      (
        await post(`/admin/products/${productId}/images/${images[1]!.id}`, {
          altText: 'Updated alt',
          sortOrder: '0',
          isPrimary: 'on',
        })
      ).statusCode,
    ).toBe(303);
    expect((await catalog.relations([productId])).images[0]!.id).toBe(
      images[1]!.id,
    );
    expect(
      (
        await post(
          `/admin/products/${productId}/images/${images[1]!.id}/delete`,
          {},
        )
      ).statusCode,
    ).toBe(303);
    expect((await catalog.relations([productId])).images[0]!.isPrimary).toBe(
      true,
    );
    for (const status of ['draft', 'archived']) {
      await catalog.saveProduct({ ...productForm, status }, productId);
      // When product is not active, locale routes should 404
      expect((await app.inject(`/product/batik-${run}`)).statusCode).toBe(404);
      expect((await app.inject('/sitemap.xml')).body).not.toContain(
        `/product/batik-${run}`,
      );
      expect(
        (await app.inject(storage.url(images[0]!.storageKey, 'card')))
          .statusCode,
      ).toBe(404);
    }
  }, 30000);
  it('prevents hierarchy cycles and rejects hidden categories publicly', async () => {
    const a = await catalog.saveCategory({
      name: `A ${run}`,
      status: 'hidden',
      sortOrder: '0',
    });
    categoryIds.push(a.id);
    const b = await catalog.saveCategory({
      name: `B ${run}`,
      status: 'active',
      sortOrder: '0',
      parentId: a.id,
    });
    categoryIds.push(b.id);
    // Create translations for the categories
    await createCategoryTranslations(
      a.id,
      `A ${run}`,
      `a-${run}`,
      `A ${run}`,
      `a-${run}`,
    );
    await createCategoryTranslations(
      b.id,
      `B ${run}`,
      `b-${run}`,
      `B ${run}`,
      `b-${run}`,
    );
    await expect(
      catalog.saveCategory(
        {
          name: a.name,
          slug: a.slug,
          status: a.status,
          sortOrder: '0',
          parentId: b.id,
        },
        a.id,
      ),
    ).rejects.toThrow('berputar');
    // Hidden category should not be publicly accessible
    expect((await app.inject(`/category/a-${run}`)).statusCode).toBe(404);
    expect((await app.inject(`/id/kategori/a-${run}`)).statusCode).toBe(404);
    // Active category should be accessible
    expect((await app.inject(`/category/b-${run}`)).statusCode).toBe(200);
    expect((await app.inject(`/id/kategori/b-${run}`)).statusCode).toBe(200);
  });
  it('serves the official logo', async () => {
    const result = await app.inject('/images/lokka_logo.png');
    expect(result.statusCode).toBe(200);
    expect(result.headers['content-type']).toContain('image/png');
    expect(result.rawPayload.readUInt32BE(16)).toBe(4000);
  });
  it('returns product 404', async () => {
    expect((await app.inject('/product/nonexistent-product')).statusCode).toBe(
      404,
    );
    expect(
      (await app.inject('/id/produk/nonexistent-product')).statusCode,
    ).toBe(404);
  });
  it('auto-creates an English translation when saving a new product', async () => {
    const p = await catalog.saveProduct({
      name: `Auto Translate ${run}`,
      slug: `auto-translate-${run}`,
      status: 'draft',
    });
    productIds.push(p.id);
    const translation = await catalog.productTranslationFor(p.id, 'en');
    expect(translation).not.toBeNull();
    expect(translation!.name).toBe(`Auto Translate ${run}`);
    expect(translation!.slug).toBe(`auto-translate-${run}`);
    await expect(
      catalog.saveProduct(
        {
          name: `Auto Translate ${run}`,
          slug: `auto-translate-${run}`,
          status: 'draft',
        },
        p.id,
      ),
    ).resolves.toBeDefined();
    const after = await catalog.productTranslationFor(p.id, 'en');
    expect(after!.name).toBe(`Auto Translate ${run}`);
  });
  it('makes admin-created product visible on storefront via auto-translation', async () => {
    const product = await catalog.saveProduct({
      name: `Storefront Visible ${run}`,
      slug: `storefront-visible-${run}`,
      status: 'draft',
    });
    productIds.push(product.id);
    await catalog.saveVariant(product.id, {
      name: 'Regular',
      sku: `SV-${run}`,
      price: '50000',
      weightGrams: '100',
      stockQuantity: '10',
      status: 'active',
      sortOrder: '0',
    });
    await catalog.saveProduct(
      {
        name: `Storefront Visible ${run}`,
        slug: `storefront-visible-${run}`,
        status: 'active',
      },
      product.id,
    );
    expect(
      (await app.inject(`/product/storefront-visible-${run}`)).statusCode,
    ).toBe(200);
    expect(
      (await app.inject(`/id/produk/storefront-visible-${run}`)).statusCode,
    ).toBe(200);
  });
  it('rejects ownership mismatches', async () => {
    await expect(catalog.saveVariant(randomUUID(), {})).rejects.toThrow(
      'tidak ditemukan',
    );
  });
});
describe('validation and image boundaries', () => {
  it('formats arbitrary precision IDR', () => {
    expect(formatIdr(695000n)).toBe('Rp695.000');
    expect(formatIdr(9007199254740993n)).toBe('Rp9.007.199.254.740.993');
  });
  it.each(['0', '-1', '1.5', '1e5', 'NaN', '9223372036854775808'])(
    'rejects invalid price %s',
    (price) => {
      expect(() => variantInput({ name: 'M', sku: 'M', price })).toThrow();
    },
  );
  it('preserves manual slugs', () => {
    expect(slug({ slug: 'stable-url' }, 'New name')).toBe('stable-url');
  });
  it.each([
    Buffer.from('<svg/>'),
    Buffer.from('GIF89a'),
    Buffer.from('not an image'),
    Buffer.from([255, 216, 255, 1, 2]),
  ])('rejects invalid or unsupported images', async (bytes) => {
    await expect(storage.save(bytes)).rejects.toThrow();
  });
  it('prevents storage traversal', () => {
    expect(() => storage.path('../outside', 'card')).toThrow();
  });
  it('does not upscale and cleans files', async () => {
    const image = await storage.save(
      await sharp({
        create: { width: 20, height: 30, channels: 3, background: 'white' },
      })
        .png()
        .toBuffer(),
    );
    imageKeys.push(image.storageKey);
    const meta = await sharp(
      await storage.read(image.storageKey, 'detail'),
    ).metadata();
    expect(meta.width).toBe(20);
    await storage.remove(image.storageKey);
    await mkdir(storage.root, { recursive: true });
    expect(
      (await readdir(storage.root)).some((f) => f.startsWith(image.storageKey)),
    ).toBe(false);
  });
});
