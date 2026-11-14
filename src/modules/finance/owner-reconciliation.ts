import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  categories,
  directCosts,
  fixedAssets,
  ownerImports,
  products,
  productVariants,
  productImages,
  productTranslations,
} from '../../db/schema/index.js';
import { parseOwnerPayload } from './owner-import.js';
// Initial import QA only. Exact replays intentionally preserve subsequent live edits.
export async function reconcileInitialOwnerImport(
  db: Database['db'],
  input: unknown,
) {
  const source = parseOwnerPayload(input);
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`,
    );
    const entries = await tx
      .select()
      .from(ownerImports)
      .where(eq(ownerImports.sourceIdentity, source.sourceIdentity));
    const problems: string[] = [];
    for (const row of source.products) {
      const entry = entries.find(
        (e) => e.sheet === 'Aktiva Lancar' && e.sourceRow === row.sourceRow,
      );
      if (!entry) {
        problems.push(`Missing product source row ${row.sourceRow}`);
        continue;
      }
      const [product] = await tx
        .select()
        .from(products)
        .where(eq(products.id, entry.entityId));
      const variants = await tx
        .select()
        .from(productVariants)
        .where(eq(productVariants.productId, entry.entityId));
      const [variant] = variants;
      const costs = await tx
        .select()
        .from(directCosts)
        .where(eq(directCosts.productId, entry.entityId));
      const [category] = product?.categoryId
        ? await tx
            .select()
            .from(categories)
            .where(eq(categories.id, product.categoryId))
        : [];
      const media = await tx
        .select({ id: productImages.id })
        .from(productImages)
        .where(eq(productImages.productId, entry.entityId));
      const translations = await tx
        .select()
        .from(productTranslations)
        .where(eq(productTranslations.productId, entry.entityId));
      const good =
        product?.name === row.name &&
        product.status === 'draft' &&
        variants.length === 1 &&
        variant?.name === 'Default' &&
        variant.sku ===
          `LOKKA-SYS-OWNER-${String(row.sourceRow - 1).padStart(3, '0')}` &&
        variant.price === BigInt(row.price) &&
        variant.unit === row.unit &&
        variant.stockKnown === (row.stock !== null) &&
        variant.stockQuantity === (row.stock ?? 0) &&
        variant.weightGrams === 0 &&
        variant.status === 'inactive' &&
        costs.length === 2 &&
        costs.find((c) => c.category === 'DIRECT_MATERIAL')?.amountRupiah ===
          BigInt(row.material) &&
        costs.find((c) => c.category === 'DIRECT_LABOR')?.amountRupiah ===
          BigInt(row.labor) &&
        costs.reduce((sum, c) => sum + c.amountRupiah, 0n) ===
          BigInt(row.hpp) &&
        category?.slug ===
          (row.sourceRow <= 3 ? 'accessories' : 'ready-to-wear') &&
        media.length === 0 &&
        translations.length >= 2 &&
        translations.every((t) => t.name === row.name);
      if (!good)
        problems.push(
          `Product source row ${row.sourceRow} differs from source or import policy.`,
        );
    }
    for (const row of source.assets) {
      const entry = entries.find(
        (e) => e.sheet === 'Aktiva Tetap' && e.sourceRow === row.sourceRow,
      );
      const [asset] = entry
        ? await tx
            .select()
            .from(fixedAssets)
            .where(eq(fixedAssets.id, entry.entityId))
        : [];
      if (
        !asset ||
        asset.assetName !== row.name ||
        asset.quantity !== row.quantity ||
        asset.unit !== row.unit ||
        asset.acquisitionCostPerUnit !== BigInt(row.cost) ||
        asset.acquisitionDate !== null ||
        asset.status !== 'ACTIVE'
      )
        problems.push(
          `Fixed asset source row ${row.sourceRow} differs from source.`,
        );
    }
    const activeDemos = await tx
      .select({ id: products.id })
      .from(products)
      .where(
        and(
          sql`${products.slug} IN ('lokka-demo-shirt','lokka-demo-outer','lokka-demo-dress')`,
          eq(products.status, 'active'),
        ),
      );
    if (activeDemos.length)
      problems.push('A legacy demo product remains active.');
    if (problems.length) throw new Error(problems.join('\n'));
    return {
      productsMatched: source.products.length,
      fixedAssetsMatched: source.assets.length,
      knownStock: source.products.filter((p) => p.stock !== null).length,
      unknownStock: source.products.filter((p) => p.stock === null).length,
      activeDemos: 0,
    };
  });
}
