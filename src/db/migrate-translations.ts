import 'dotenv/config';
import { readEnv } from '../config/env.js';
import { createDatabase } from './client.js';
import {
  products,
  categories,
  productTranslations,
  categoryTranslations,
} from './schema/index.js';

const database = createDatabase(readEnv().databaseUrl);

try {
  // Migrate existing products into Indonesian translations (existing data was Indonesian)
  const existingProducts = await database.db.select().from(products);
  let migratedProducts = 0;
  for (const p of existingProducts) {
    await database.db
      .insert(productTranslations)
      .values({
        productId: p.id,
        locale: 'id',
        name: p.name,
        slug: p.slug,
        shortDescription: p.shortDescription,
        description: p.description,
        seoTitle: p.seoTitle,
        seoDescription: p.seoDescription,
      })
      .onConflictDoNothing();
    migratedProducts++;
  }

  // Migrate existing categories into Indonesian translations
  const existingCategories = await database.db.select().from(categories);
  let migratedCategories = 0;
  for (const c of existingCategories) {
    await database.db
      .insert(categoryTranslations)
      .values({
        categoryId: c.id,
        locale: 'id',
        name: c.name,
        slug: c.slug,
        shortDescription: c.shortDescription,
        seoTitle: c.seoTitle,
        seoDescription: c.seoDescription,
      })
      .onConflictDoNothing();
    migratedCategories++;
  }

  console.info(
    `Translation migration complete: ${migratedProducts} products, ${migratedCategories} categories migrated to Indonesian`,
  );
} finally {
  await database.close();
}
