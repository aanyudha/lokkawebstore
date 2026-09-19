import { and, eq } from 'drizzle-orm';
import type { Database } from './client.js';
import {
  categories,
  categoryTranslations,
  products,
  productTranslations,
  productVariants,
  vendors,
} from './schema/index.js';

const DEMO_CATEGORY = {
  slug: 'ready-to-wear',
  name: 'Ready to Wear',
  translations: [
    {
      locale: 'en',
      name: 'Ready to Wear',
      slug: 'ready-to-wear',
      shortDescription: 'Everyday pieces from the LOKKA development catalog.',
    },
    {
      locale: 'id',
      name: 'Siap Pakai',
      slug: 'siap-pakai',
      shortDescription: 'Koleksi pengembangan LOKKA untuk keseharian.',
    },
  ],
} as const;

const DEMO_PRODUCT = {
  slug: 'lokka-demo-shirt',
  name: 'LOKKA Demo Shirt',
  translations: [
    {
      locale: 'en',
      name: 'LOKKA Demo Shirt',
      slug: 'lokka-demo-shirt',
      shortDescription: 'A bilingual development product with no imagery.',
      description:
        'Development-only sample item. No commercial or third-party assets are used.',
    },
    {
      locale: 'id',
      name: 'Kemeja Demo LOKKA',
      slug: 'kemeja-demo-lokka',
      shortDescription: 'Produk pengembangan dwibahasa tanpa gambar.',
      description:
        'Contoh pengembangan saja. Tidak memakai aset komersial atau pihak ketiga.',
    },
  ],
  variant: {
    sku: 'LOKKA-DEMO-SHIRT-M',
    name: 'M',
    price: 495000n,
    weightGrams: 300,
    stockQuantity: 12,
  },
} as const;

export function assertDevelopmentSeedAllowed(nodeEnv: string): void {
  if (nodeEnv === 'production')
    throw new Error(
      'Demo development seed refused: NODE_ENV=production. Use only against a development database.',
    );
}

export async function seedDevelopmentData(database: Database): Promise<void> {
  await database.db.transaction(async (tx) => {
    await tx
      .insert(vendors)
      .values({ slug: 'lokka', name: 'LOKKA', status: 'active' })
      .onConflictDoNothing({ target: vendors.slug });
    const [owner] = await tx
      .select()
      .from(vendors)
      .where(eq(vendors.slug, 'lokka'));
    if (!owner) throw new Error('LOKKA vendor is required for the demo seed.');

    const [existingCategory] = await tx
      .select()
      .from(categories)
      .where(eq(categories.slug, DEMO_CATEGORY.slug));
    if (!existingCategory)
      await tx.insert(categories).values({
        name: DEMO_CATEGORY.name,
        slug: DEMO_CATEGORY.slug,
        status: 'active',
        sortOrder: 0,
      });
    const [category] = await tx
      .select()
      .from(categories)
      .where(eq(categories.slug, DEMO_CATEGORY.slug));
    if (!category) throw new Error('Demo category could not be created.');
    for (const translation of DEMO_CATEGORY.translations) {
      const [existing] = await tx
        .select()
        .from(categoryTranslations)
        .where(
          and(
            eq(categoryTranslations.categoryId, category.id),
            eq(categoryTranslations.locale, translation.locale),
          ),
        );
      if (!existing)
        await tx.insert(categoryTranslations).values({
          categoryId: category.id,
          locale: translation.locale,
          name: translation.name,
          slug: translation.slug,
          shortDescription: translation.shortDescription,
        });
    }

    const [existingProduct] = await tx
      .select()
      .from(products)
      .where(eq(products.slug, DEMO_PRODUCT.slug));
    if (!existingProduct)
      await tx.insert(products).values({
        name: DEMO_PRODUCT.name,
        slug: DEMO_PRODUCT.slug,
        vendorId: owner.id,
        categoryId: category.id,
        status: 'active',
        featured: true,
        shortDescription: 'Development-only sample product.',
        description: 'Development-only sample product.',
        publishedAt: new Date(),
      });
    const [product] = await tx
      .select()
      .from(products)
      .where(eq(products.slug, DEMO_PRODUCT.slug));
    if (!product) throw new Error('Demo product could not be created.');
    for (const translation of DEMO_PRODUCT.translations) {
      const [existing] = await tx
        .select()
        .from(productTranslations)
        .where(
          and(
            eq(productTranslations.productId, product.id),
            eq(productTranslations.locale, translation.locale),
          ),
        );
      if (!existing)
        await tx.insert(productTranslations).values({
          productId: product.id,
          locale: translation.locale,
          name: translation.name,
          slug: translation.slug,
          shortDescription: translation.shortDescription,
          description: translation.description,
        });
    }

    const [existingVariant] = await tx
      .select()
      .from(productVariants)
      .where(eq(productVariants.sku, DEMO_PRODUCT.variant.sku));
    if (!existingVariant)
      await tx.insert(productVariants).values({
        productId: product.id,
        sku: DEMO_PRODUCT.variant.sku,
        name: DEMO_PRODUCT.variant.name,
        price: DEMO_PRODUCT.variant.price,
        weightGrams: DEMO_PRODUCT.variant.weightGrams,
        stockQuantity: DEMO_PRODUCT.variant.stockQuantity,
        status: 'active',
        sortOrder: 0,
      });
  });
}

export const devSeedSlugs = {
  category: DEMO_CATEGORY.slug,
  product: DEMO_PRODUCT.slug,
  variant: DEMO_PRODUCT.variant.sku,
} as const;
