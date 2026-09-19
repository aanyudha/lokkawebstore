import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { readEnv } from '../src/config/env.js';
import { createDatabase } from '../src/db/client.js';
import {
  assertDevelopmentSeedAllowed,
  devSeedSlugs,
  seedDevelopmentData,
} from '../src/db/seed-dev-data.js';
import {
  adminUsers,
  categories,
  categoryTranslations,
  productTranslations,
  products,
  productVariants,
  vendors,
} from '../src/db/schema/index.js';
import { hashPassword } from '../src/modules/auth/service.js';
import { createCatalog } from '../src/modules/catalog/service.js';
import { LocalCatalogImageStorage } from '../src/modules/catalog/storage.js';
const env = readEnv({
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL,
  APP_URL: 'http://localhost:3000',
  CATALOG_STORAGE_ROOT: `storage/tests/seed-dev-${randomUUID()}`,
});
const database = createDatabase(env.databaseUrl);
const storage = new LocalCatalogImageStorage(env.catalogStorageRoot);
const catalog = createCatalog(database.db, storage);
const countAfter = async (rows: PromiseLike<unknown[]>) => (await rows).length;
let createdCategory = false;
let createdProduct = false;
let tempAdminId: string | undefined;

beforeAll(async () => {
  await database.check();
  const [demoCategory] = await database.db
    .select()
    .from(categories)
    .where(eq(categories.slug, devSeedSlugs.category));
  const [demoProduct] = await database.db
    .select()
    .from(products)
    .where(eq(products.slug, devSeedSlugs.product));
  createdCategory = !demoCategory;
  createdProduct = !demoProduct;
}, 30000);
afterAll(async () => {
  if (createdProduct) {
    const [demoProduct] = await database.db
      .select()
      .from(products)
      .where(eq(products.slug, devSeedSlugs.product));
    if (demoProduct) {
      await database.db.delete(products).where(eq(products.id, demoProduct.id));
    }
  }
  if (createdCategory) {
    const [demoCategory] = await database.db
      .select()
      .from(categories)
      .where(eq(categories.slug, devSeedSlugs.category));
    if (demoCategory) {
      await database.db
        .delete(categories)
        .where(eq(categories.id, demoCategory.id));
    }
  }
  if (tempAdminId)
    await database.db.delete(adminUsers).where(eq(adminUsers.id, tempAdminId));
  await database.close();
}, 30000);
describe('development seed', () => {
  it('refuses NODE_ENV=production without any database access', () => {
    expect(() => assertDevelopmentSeedAllowed('production')).toThrow(
      /NODE_ENV=production/,
    );
    expect(() => assertDevelopmentSeedAllowed('development')).not.toThrow();
    expect(() => assertDevelopmentSeedAllowed('test')).not.toThrow();
  });
  it('seeds an active bilingual category and product under exactly one LOKKA vendor', async () => {
    await seedDevelopmentData(database);
    expect(
      await countAfter(
        database.db.select().from(vendors).where(eq(vendors.slug, 'lokka')),
      ),
    ).toBe(1);
    const [category] = await database.db
      .select()
      .from(categories)
      .where(eq(categories.slug, devSeedSlugs.category));
    expect(category?.status).toBe('active');
    for (const locale of ['en', 'id']) {
      const [translation] = await database.db
        .select()
        .from(categoryTranslations)
        .where(
          and(
            eq(categoryTranslations.categoryId, category!.id),
            eq(categoryTranslations.locale, locale),
          ),
        );
      expect(translation).toBeDefined();
    }
    const [product] = await database.db
      .select()
      .from(products)
      .where(eq(products.slug, devSeedSlugs.product));
    expect(product?.status).toBe('active');
    for (const locale of ['en', 'id']) {
      const [translation] = await database.db
        .select()
        .from(productTranslations)
        .where(
          and(
            eq(productTranslations.productId, product!.id),
            eq(productTranslations.locale, locale),
          ),
        );
      expect(translation).toBeDefined();
    }
    const [variant] = await database.db
      .select()
      .from(productVariants)
      .where(eq(productVariants.sku, devSeedSlugs.variant));
    expect(variant?.status).toBe('active');
    expect(variant?.stockQuantity).toBe(12);
    expect(variant?.price).toBe(495000n);
  });
  it('is idempotent and never duplicates core records', async () => {
    const before = {
      vendors: await countAfter(
        database.db.select().from(vendors).where(eq(vendors.slug, 'lokka')),
      ),
      categories: await countAfter(
        database.db
          .select()
          .from(categories)
          .where(eq(categories.slug, devSeedSlugs.category)),
      ),
      products: await countAfter(
        database.db
          .select()
          .from(products)
          .where(eq(products.slug, devSeedSlugs.product)),
      ),
      variants: await countAfter(
        database.db
          .select()
          .from(productVariants)
          .where(eq(productVariants.sku, devSeedSlugs.variant)),
      ),
    };
    const [product] = await database.db
      .select()
      .from(products)
      .where(eq(products.slug, devSeedSlugs.product));
    const translationCounts = await Promise.all(
      ['en', 'id'].map(async (locale) =>
        countAfter(
          database.db
            .select()
            .from(productTranslations)
            .where(
              and(
                eq(productTranslations.productId, product!.id),
                eq(productTranslations.locale, locale),
              ),
            ),
        ),
      ),
    );
    await seedDevelopmentData(database);
    expect(
      await countAfter(
        database.db.select().from(vendors).where(eq(vendors.slug, 'lokka')),
      ),
    ).toBe(before.vendors);
    expect(
      await countAfter(
        database.db
          .select()
          .from(categories)
          .where(eq(categories.slug, devSeedSlugs.category)),
      ),
    ).toBe(before.categories);
    expect(
      await countAfter(
        database.db
          .select()
          .from(products)
          .where(eq(products.slug, devSeedSlugs.product)),
      ),
    ).toBe(before.products);
    expect(
      await countAfter(
        database.db
          .select()
          .from(productVariants)
          .where(eq(productVariants.sku, devSeedSlugs.variant)),
      ),
    ).toBe(before.variants);
    for (const [locale, countBefore] of [
      ['en', translationCounts[0]!],
      ['id', translationCounts[1]!],
    ] as const) {
      expect(
        await countAfter(
          database.db
            .select()
            .from(productTranslations)
            .where(
              and(
                eq(productTranslations.productId, product!.id),
                eq(productTranslations.locale, locale),
              ),
            ),
        ),
      ).toBe(countBefore);
    }
  });
  it('resolves the bilingual sample product publicly in both locales', async () => {
    const enRendered = await catalog.localizedProduct('en', 'lokka-demo-shirt');
    expect(enRendered).not.toBeNull();
    const idRendered = await catalog.localizedProduct(
      'id',
      'kemeja-demo-lokka',
    );
    expect(idRendered).not.toBeNull();
    expect(enRendered!.product.id).toBe(idRendered!.product.id);
    expect(enRendered!.product.status).toBe('active');
    expect(enRendered!.variants[0]!.sku).toBe(devSeedSlugs.variant);
  });
  it('leaves admin creation independent from the demo seed', async () => {
    const before = await countAfter(
      database.db
        .select()
        .from(adminUsers)
        .where(eq(adminUsers.status, 'active')),
    );
    const [user] = await database.db
      .insert(adminUsers)
      .values({
        email: `${randomUUID()}@example.test`,
        name: 'Demo seed verification admin',
        passwordHash: await hashPassword('temporary-password'),
      })
      .returning();
    tempAdminId = user!.id;
    await seedDevelopmentData(database);
    expect(
      await database.db
        .select()
        .from(adminUsers)
        .where(eq(adminUsers.id, user!.id)),
    ).toHaveLength(1);
    expect(
      await countAfter(
        database.db
          .select()
          .from(adminUsers)
          .where(eq(adminUsers.status, 'active')),
      ),
    ).toBe(before + 1);
  });
});
