import { createHash } from 'node:crypto';
import { supportedLocaleCodes } from '../../i18n/index.js';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  adminUsers,
  ownerImports,
  vendors,
  products,
  productVariants,
  productTranslations,
} from '../../db/schema/index.js';
import { createCatalog } from '../catalog/service.js';
import type { CatalogImageStorage } from '../catalog/storage.js';
import {
  FormError,
  id,
  integer,
  textField,
  type Form,
} from '../catalog/validation.js';
import { rupiah } from './calculations.js';
import { createFinance } from './service.js';
import { createFixedAssets } from './fixed-assets.js';
export const payloadHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function parseOwnerPayload(input: unknown) {
  if (!input || typeof input !== 'object')
    throw new FormError('source', 'Invalid owner payload.');
  const form = input as Form;
  const sourceIdentity = textField(form, 'sourceIdentity', 100, true);
  const workbookHash = textField(form, 'workbookHash', 64, true);
  if (!/^[a-f0-9]{64}$/.test(workbookHash))
    throw new FormError('source', 'Invalid source SHA-256.');
  if (
    !Array.isArray(form.products) ||
    form.products.length !== 34 ||
    !Array.isArray(form.assets) ||
    form.assets.length !== 20
  )
    throw new FormError(
      'source',
      'Expected 34 product rows and 20 fixed asset rows.',
    );
  const rowForm = (row: unknown): Form => {
    if (!row || typeof row !== 'object')
      throw new FormError('source', 'Invalid source row.');
    return row as Form;
  };
  const sourceInteger = (row: Form, field: string, min = 0) => {
    const value = row[field];
    if (typeof value === 'number' && !Number.isSafeInteger(value))
      throw new FormError(field, 'Expected an integer.');
    return integer(
      { ...row, [field]: typeof value === 'number' ? String(value) : value },
      field,
      min,
    );
  };
  const productRows = form.products.map((raw) => {
    const row = rowForm(raw);
    const result = {
      sourceRow: sourceInteger(row, 'sourceRow', 2),
      name: textField(row, 'name', 200, true),
      stock: row.stock === null ? null : sourceInteger(row, 'stock'),
      unit: textField(row, 'unit', 30, true),
      price: rupiah(row, 'price').toString(),
      material: rupiah(row, 'material').toString(),
      labor: rupiah(row, 'labor').toString(),
      hpp: rupiah(row, 'hpp').toString(),
    };
    if (BigInt(result.material) + BigInt(result.labor) !== BigInt(result.hpp))
      throw new FormError(
        'hpp',
        'Source HPP does not equal material plus labor.',
      );
    return result;
  });
  const assetRows = form.assets.map((raw) => {
    const row = rowForm(raw);
    return {
      sourceRow: sourceInteger(row, 'sourceRow', 2),
      name: textField(row, 'name', 200, true),
      quantity: sourceInteger(row, 'quantity', 1),
      unit: textField(row, 'unit', 30, true),
      cost: rupiah(row, 'cost').toString(),
    };
  });
  for (const [rows, last] of [
    [productRows, 35],
    [assetRows, 21],
  ] as const) {
    if (
      new Set(rows.map((row) => row.sourceRow)).size !== rows.length ||
      rows.some((row) => row.sourceRow > last)
    )
      throw new FormError(
        'source',
        'Source row identities must cover the original worksheet data rows exactly.',
      );
  }
  return {
    sourceIdentity,
    workbookHash,
    products: productRows,
    assets: assetRows,
  };
}
export type OwnerPayload = ReturnType<typeof parseOwnerPayload>;
export async function importOwnerData(
  db: Database['db'],
  storage: CatalogImageStorage,
  input: unknown,
  adminId: string,
  apply = false,
) {
  const data = parseOwnerPayload(input);
  return db.transaction(async (tx) => {
    await tx.execute(
      apply
        ? sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`
        : sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`,
    );
    if (apply) await tx.execute(sql`SELECT pg_advisory_xact_lock(724027)`);
    const [admin] = await tx
      .select()
      .from(adminUsers)
      .where(
        and(eq(adminUsers.id, id(adminId)), eq(adminUsers.status, 'active')),
      );
    if (!admin)
      throw new FormError(
        'admin',
        'An active owner admin is required for import attribution.',
      );
    const catalog = createCatalog(tx, storage);
    const [vendor] = await tx
      .select()
      .from(vendors)
      .where(eq(vendors.slug, 'lokka'));
    if (!vendor)
      throw new FormError('vendor', 'LOKKA vendor is not configured.');
    const vendorId = vendor.id;
    const finance = createFinance(tx, catalog);
    const fixed = createFixedAssets(tx);
    const existing = await tx
      .select()
      .from(ownerImports)
      .where(eq(ownerImports.sourceIdentity, data.sourceIdentity));
    const entries = [
      ...data.products.map((row) => ({ sheet: 'Aktiva Lancar', row })),
      ...data.assets.map((row) => ({ sheet: 'Aktiva Tetap', row })),
    ];
    let skipped = 0;
    for (const { sheet, row } of entries) {
      const applied = existing.find(
        (entry) => entry.sheet === sheet && entry.sourceRow === row.sourceRow,
      );
      if (!applied) continue;
      if (
        applied.payloadHash !== payloadHash(row) ||
        applied.workbookHash !== data.workbookHash
      )
        throw new FormError(
          'source',
          'Changed source requires an explicit reviewed update plan; automatic overwrite refused.',
        );
      if (sheet === 'Aktiva Lancar') await catalog.product(applied.entityId);
      else await fixed.get(applied.entityId);
      skipped++;
    }
    for (const row of data.products) {
      if (
        existing.some(
          (entry) =>
            entry.sheet === 'Aktiva Lancar' &&
            entry.sourceRow === row.sourceRow,
        )
      )
        continue;
      const index = row.sourceRow - 1;
      const slug = `${row.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')}-owner-${index}`;
      const sku = `LOKKA-SYS-OWNER-${String(index).padStart(3, '0')}`;
      if (
        (
          await tx
            .select({ id: products.id })
            .from(products)
            .where(eq(products.slug, slug))
        ).length ||
        (
          await tx
            .select({ id: productVariants.id })
            .from(productVariants)
            .where(eq(productVariants.sku, sku))
        ).length
      )
        throw new FormError(
          'source',
          'Existing catalog identifier conflicts with the import; review required.',
        );
    }
    // Positively identify seed entities using ownership, slug, names, descriptions,
    // translations and SKU; preserve every referenced row and media object.
    const demos: { id: string; name: string }[] = [];
    for (const kind of ['shirt', 'outer', 'dress']) {
      const slug = `lokka-demo-${kind}`;
      const [product] = await tx
        .select()
        .from(products)
        .where(and(eq(products.slug, slug), eq(products.vendorId, vendorId)));
      if (!product) continue;
      const variants = await tx
        .select()
        .from(productVariants)
        .where(eq(productVariants.productId, product.id));
      const translations = await tx
        .select()
        .from(productTranslations)
        .where(eq(productTranslations.productId, product.id));
      const name = `LOKKA Demo ${kind[0]!.toUpperCase()}${kind.slice(1)}`;
      if (
        product.name !== name ||
        product.description !== 'Development-only sample product.' ||
        product.shortDescription !== 'Development-only sample product.' ||
        variants.length !== 1 ||
        variants[0]!.sku !== `LOKKA-DEMO-${kind.toUpperCase()}-M` ||
        !translations.some(
          (t) => t.locale === 'en' && t.slug === slug && t.name === name,
        ) ||
        !translations.some(
          (t) =>
            t.locale === 'id' &&
            t.description?.includes('Contoh pengembangan saja.'),
        )
      )
        throw new FormError(
          'cleanup',
          `Seed identity changed for ${slug}; review before archiving.`,
        );
      if (product.status !== 'archived')
        demos.push({ id: product.id, name: product.name });
    }
    const summary = {
      dryRun: !apply,
      sourceIdentity: data.sourceIdentity,
      workbookHash: data.workbookHash,
      created: entries.length - skipped,
      updated: 0,
      skipped,
      incomplete: data.products.filter((row) => row.stock === null).length,
      archive: demos.map((row) => row.name),
      products: data.products.length,
      assets: data.assets.length,
    };
    if (!apply) return summary;
    let categories = await catalog.categoryList();
    for (const [name, slug] of [
      ['Accessories', 'accessories'],
      ['Ready to Wear', 'ready-to-wear'],
    ]) {
      if (!categories.some((row) => row.slug === slug)) {
        const category = await catalog.saveCategory({
          name,
          slug,
          status: 'active',
          sortOrder: '0',
        });
        for (const locale of supportedLocaleCodes)
          await catalog.saveCategoryTranslation(category.id, locale, {
            name,
            slug,
          });
      }
    }
    categories = await catalog.categoryList();
    for (const { sheet, row } of entries) {
      if (
        existing.some(
          (entry) => entry.sheet === sheet && entry.sourceRow === row.sourceRow,
        )
      )
        continue;
      let entityId: string;
      if (sheet === 'Aktiva Lancar' && 'stock' in row) {
        const index = row.sourceRow - 1;
        const slug = `${row.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')}-owner-${index}`;
        const sku = `LOKKA-SYS-OWNER-${String(index).padStart(3, '0')}`;
        const conflicts = await tx
          .select({ id: products.id })
          .from(products)
          .where(eq(products.slug, slug));
        const skuConflicts = await tx
          .select({ id: productVariants.id })
          .from(productVariants)
          .where(eq(productVariants.sku, sku));
        if (conflicts.length || skuConflicts.length)
          throw new FormError(
            'source',
            'Existing catalog identifier conflicts with the import; review required.',
          );
        const category = categories.find(
          (c) => c.slug === (index <= 2 ? 'accessories' : 'ready-to-wear'),
        )!;
        const product = await catalog.saveProduct({
          name: row.name,
          slug,
          status: 'draft',
          categoryId: category.id,
        });
        const variant = await catalog.saveVariant(product.id, {
          name: 'Default',
          sku,
          price: row.price,
          weightGrams: '0',
          stockKnown: row.stock === null ? 'false' : 'true',
          stockQuantity: row.stock === null ? '' : '0',
          unit: row.unit,
          status: 'inactive',
        });
        if (row.stock !== null)
          await catalog.stock(product.id, variant.id, {
            stockKnown: 'true',
            stockQuantity: String(row.stock),
            stockNote: `Owner workbook import ${data.sourceIdentity}, ${sheet} row ${row.sourceRow}`,
          });
        await finance.saveProductCost(product.id, {
          name: 'Biaya Bahan',
          category: 'DIRECT_MATERIAL',
          amountRupiah: row.material,
          sortOrder: '0',
        });
        await finance.saveProductCost(product.id, {
          name: 'Biaya Jahit',
          category: 'DIRECT_LABOR',
          amountRupiah: row.labor,
          sortOrder: '1',
        });
        entityId = product.id;
      } else if ('cost' in row) {
        const asset = await fixed.save(
          {
            assetName: row.name,
            quantity: String(row.quantity),
            unit: row.unit,
            acquisitionCostPerUnit: row.cost,
            status: 'ACTIVE',
            notes: `Owner workbook: ${data.sourceIdentity}; source row ${row.sourceRow}. Harga Beli treated as cost per unit/pack.`,
          },
          adminId,
        );
        entityId = asset.id;
      } else throw new FormError('source', 'Invalid sheet mapping.');
      await tx.insert(ownerImports).values({
        sourceIdentity: data.sourceIdentity,
        workbookHash: data.workbookHash,
        sheet,
        sourceRow: row.sourceRow,
        entityId,
        payloadHash: payloadHash(row),
        createdBy: adminId,
      });
    }
    for (const demo of demos) await catalog.archive(demo.id);
    return summary;
  });
}
