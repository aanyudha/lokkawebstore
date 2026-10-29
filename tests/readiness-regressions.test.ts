import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { unlink } from 'node:fs/promises';
import sharp from 'sharp';
import { accountingFixture } from './helpers/accounting-fixture.js';
import { buildApp } from '../src/app.js';
import { readEnv } from '../src/config/env.js';
import { createCatalog } from '../src/modules/catalog/service.js';
import { LocalCatalogImageStorage } from '../src/modules/catalog/storage.js';
import { seedDevelopmentData } from '../src/db/seed-dev-data.js';
import {
  products,
  productVariants,
  saleItems,
  sales,
  inventoryMovements,
} from '../src/db/schema/index.js';
import type { FastifyInstance } from 'fastify';

let f: Awaited<ReturnType<typeof accountingFixture>>;
let app: FastifyInstance;
let cookie = '',
  csrf = '';
beforeEach(async () => {
  f = await accountingFixture();
  app = await buildApp(
    readEnv({
      ...process.env,
      APP_RUNTIME: 'fastify',
      DATABASE_URL: f.url,
      NODE_ENV: 'test',
      APP_URL: 'http://127.0.0.1:3000',
    }),
    { database: { ...f.database, close: async () => {} }, logger: false },
  );
  const login = await app.inject('/pos/login');
  const token = login.cookies.find(
    (c) => c.name === 'lokka_pos_login_csrf',
  )!.value;
  const signedIn = await app.inject({
    method: 'POST',
    url: '/pos/login',
    cookies: { lokka_pos_login_csrf: token },
    payload: {
      csrf: token,
      email: f.admin.email,
      password: 'temporary-accounting-password',
    },
  });
  cookie = signedIn.cookies
    .filter((c) => c.value)
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  csrf = signedIn.cookies.find((c) => c.name === 'lokka_pos_csrf')!.value;
}, 60000);
afterEach(async () => {
  await app?.close();
  await f?.cleanup();
}, 60000);
const post = (payload: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: '/pos/api/sales',
    headers: { cookie },
    payload: { csrf, ...payload },
  });
async function noSale() {
  expect(await f.db.select().from(sales)).toHaveLength(0);
  expect(
    (
      await f.db
        .select()
        .from(productVariants)
        .where(eq(productVariants.id, f.variant.id))
    )[0]!.stockQuantity,
  ).toBe(100);
}

describe('owner-readiness regressions', () => {
  it('rejects other ports and schemes for POS mutations, including logout', async () => {
    for (const origin of [
      'http://127.0.0.1:9999',
      'https://127.0.0.1:3000',
      'https://example.test',
    ]) {
      for (const url of ['/pos/api/sales', '/pos/logout']) {
        const response = await app.inject({
          method: 'POST',
          url,
          headers: { cookie, origin },
          payload: {
            csrf,
            items: [{ variantId: f.variant.id, quantity: 1 }],
            cashTendered: '795000',
          },
        });
        expect(response.statusCode).toBe(403);
      }
    }
    await noSale();
  });
  it('rejects malformed sale fields as controlled 422 without partial writes', async () => {
    for (const payload of [
      { items: [null], cashTendered: '795000' },
      {
        items: [{ variantId: f.variant.id, quantity: 1 }],
        cashTendered: 'not-money',
      },
      {
        items: [{ variantId: 'not-a-uuid', quantity: 1 }],
        cashTendered: '795000',
      },
      {
        items: [{ variantId: f.variant.id, quantity: 0 }],
        cashTendered: '795000',
      },
      {
        items: [{ variantId: f.variant.id, quantity: 1.5 }],
        cashTendered: '795000',
      },
      {
        items: [{ variantId: f.variant.id, quantity: -1 }],
        cashTendered: '795000',
      },
    ]) {
      expect((await post(payload)).statusCode).toBe(422);
      await noSale();
    }
  });
  it('rejects insufficient or omitted POS tender before recording any facts', async () => {
    for (const cashTendered of ['1', '0', undefined]) {
      expect(
        (
          await post({
            items: [{ variantId: f.variant.id, quantity: 1 }],
            cashTendered,
          })
        ).statusCode,
      ).toBe(422);
      await noSale();
    }
  });
  it('removes archived products from SKU search and rejects a stale POS cart', async () => {
    await f.db
      .update(products)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(eq(products.id, f.product.id));
    expect(await f.salesService.searchProducts(f.variant.sku)).toHaveLength(0);
    expect(
      (
        await post({
          items: [{ variantId: f.variant.id, quantity: 1 }],
          cashTendered: '795000',
        })
      ).statusCode,
    ).toBe(422);
    await noSale();
  });
  it('consolidates repeated variant lines and decrements the total quantity once', async () => {
    const response = await post({
      items: [
        { variantId: f.variant.id, quantity: 2 },
        { variantId: f.variant.id, quantity: 3 },
      ],
      cashTendered: '3975000',
    });
    expect(response.statusCode).toBe(200);
    const sale = response.json<{ saleId: string }>();
    expect(
      (
        await f.db
          .select()
          .from(productVariants)
          .where(eq(productVariants.id, f.variant.id))
      )[0]!.stockQuantity,
    ).toBe(95);
    expect(
      await f.db
        .select()
        .from(saleItems)
        .where(eq(saleItems.saleId, sale.saleId)),
    ).toMatchObject([{ quantity: 5 }]);
    expect(
      await f.db
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.referenceId, sale.saleId)),
    ).toMatchObject([{ quantityChange: -5 }]);
  });
  it('rejects combined duplicate-line overselling atomically', async () => {
    expect(
      (
        await post({
          items: [
            { variantId: f.variant.id, quantity: 60 },
            { variantId: f.variant.id, quantity: 60 },
          ],
          cashTendered: '95400000',
        })
      ).statusCode,
    ).toBe(422);
    await noSale();
  });
  it('keeps history and receipt Rupiah exact beyond Number safe precision', async () => {
    const huge = 9007199254740993n;
    await f.db
      .update(productVariants)
      .set({ price: huge, updatedAt: new Date() })
      .where(eq(productVariants.id, f.variant.id));
    const result = await f.salesService.completeSale({
      source: 'POS',
      cashierId: f.admin.id,
      items: [{ variantId: f.variant.id, quantity: 1 }],
      cashTendered: huge,
    });
    for (const path of ['/pos/history', `/pos/sales/${result.saleId}`]) {
      const page = await app.inject({ url: path, headers: { cookie } });
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('Rp9.007.199.254.740.993');
    }
    expect(
      (await app.inject({ url: '/pos/history', headers: { cookie } })).body,
    ).toContain(f.admin.name);
  });
  it('uses valid translated category URLs, canonical links and collection alias', async () => {
    await seedDevelopmentData(f.database);
    const page = await app.inject('/category/ready-to-wear');
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain(
      'rel="canonical" href="http://127.0.0.1:3000/category/ready-to-wear"',
    );
    expect(page.body).toContain(
      'hreflang="id-ID" href="http://127.0.0.1:3000/id/kategori/siap-pakai"',
    );
    const alias = await app.inject('/id/collections');
    expect(alias.statusCode).toBe(301);
    expect(alias.headers.location).toBe('/id/koleksi');
  });
  it('updates copied storefront fallback text while preserving custom translations and historical names', async () => {
    const catalog = createCatalog(
      f.db,
      new LocalCatalogImageStorage('storage/tests/readiness'),
    );
    const p = await catalog.saveProduct({
      name: 'Before owner edit',
      status: 'draft',
    });
    await catalog.saveProductTranslation(p.id, 'id', {
      name: 'Terjemahan khusus',
      slug: 'terjemahan-khusus',
    });
    await catalog.saveProduct(
      { name: 'After owner edit', slug: p.slug, status: 'draft' },
      p.id,
    );
    expect((await catalog.productTranslationFor(p.id, 'en'))!.name).toBe(
      'After owner edit',
    );
    expect((await catalog.productTranslationFor(p.id, 'id'))!.name).toBe(
      'Terjemahan khusus',
    );
  });
  it('falls back to another public derivative when the requested image file is missing', async () => {
    const storage = new LocalCatalogImageStorage(
      'storage/tests/readiness-media',
    );
    const image = await storage.save(
      await sharp({
        create: { width: 30, height: 30, channels: 3, background: 'white' },
      })
        .png()
        .toBuffer(),
    );
    try {
      await unlink(storage.path(image.storageKey, 'thumb'));
      expect(
        (await storage.read(image.storageKey, 'thumb')).length,
      ).toBeGreaterThan(0);
      await storage.remove(image.storageKey);
      // All derivatives missing: a valid placeholder, never the private source.
      expect(
        (await sharp(await storage.read(image.storageKey, 'card')).metadata())
          .format,
      ).toBe('webp');
    } finally {
      await storage.removeWithSource(
        image.storageKey,
        image.source.sourceStorageKey,
        image.source.sourceFormat,
      );
    }
  });
  it('allocates transaction numbers atomically even on the first sale of the day', async () => {
    // Exercise the numbering operation against independent products, so their
    // stock locks do not serialize the otherwise-concurrent first counter write.
    const [p] = await f.db
      .insert(products)
      .values({
        vendorId: f.product.vendorId,
        name: 'Second register product',
        slug: 'second-register',
        status: 'active',
      })
      .returning();
    const [v] = await f.db
      .insert(productVariants)
      .values({
        productId: p!.id,
        name: 'M',
        sku: 'SECOND-M',
        price: 100n,
        stockQuantity: 10,
        weightGrams: 100,
        status: 'active',
      })
      .returning();
    const settled = await Promise.allSettled([
      f.sell(),
      f.salesService.completeSale({
        source: 'POS',
        cashierId: f.admin.id,
        items: [{ variantId: v!.id, quantity: 1 }],
        cashTendered: 100n,
      }),
    ]);
    expect(settled.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(
      (
        await f.db
          .select({
            n: sql<string>`count(distinct ${sales.transactionNumber})::text`,
          })
          .from(sales)
      )[0]!.n,
    ).toBe('2');
  });
});
