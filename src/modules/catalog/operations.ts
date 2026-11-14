import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  or,
  sql,
} from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  categories,
  products,
  productVariants,
  vendors,
} from '../../db/schema/index.js';
import { createCatalog } from './service.js';
import type { CatalogImageStorage } from './storage.js';
import { FormError, choice, stockInput, type Form } from './validation.js';
import {
  listInput,
  pagination,
  searchPattern,
  selectedIds,
  type BulkResult,
} from './listing.js';
import { isOperationalVariant, readinessBadges } from './sellability.js';
export function createCatalogOperations(
  db: Database['db'],
  storage: CatalogImageStorage,
) {
  async function owner() {
    const [vendor] = await db
      .select()
      .from(vendors)
      .where(eq(vendors.slug, 'lokka'));
    if (!vendor)
      throw new FormError('vendor', 'LOKKA vendor is not configured.');
    return vendor.id;
  }
  async function metrics(threshold: number) {
    const vendorId = await owner();
    const [productCounts] = await db
      .select({
        active: sql<number>`count(*) filter(where ${products.status}='active')::int`,
        draft: sql<number>`count(*) filter(where ${products.status}='draft')::int`,
      })
      .from(products)
      .where(eq(products.vendorId, vendorId));
    const [variantCounts] = await db
      .select({
        total: count(),
        low: sql<number>`count(*) filter(where ${productVariants.stockKnown} AND ${productVariants.stockQuantity} <= ${threshold})::int`,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(eq(products.vendorId, vendorId));
    const [categoryCount] = await db
      .select({ total: count() })
      .from(categories);
    return {
      'Active products': productCounts!.active,
      'Draft products': productCounts!.draft,
      Categories: categoryCount!.total,
      Variants: variantCounts!.total,
      'Low stock': variantCounts!.low,
    };
  }
  async function productList(
    query: Record<string, unknown> = {},
    path = '/admin/products',
  ) {
    const input = listInput(query);
    const pattern = searchPattern(input.q);
    const condition = and(
      eq(products.vendorId, await owner()),
      input.q
        ? or(
            ilike(products.name, pattern),
            exists(
              db
                .select({ id: productVariants.id })
                .from(productVariants)
                .where(
                  and(
                    eq(productVariants.productId, products.id),
                    or(
                      ilike(productVariants.sku, pattern),
                      ilike(productVariants.name, pattern),
                    ),
                  ),
                ),
            ),
            exists(
              db
                .select({ id: categories.id })
                .from(categories)
                .where(
                  and(
                    eq(categories.id, products.categoryId),
                    ilike(categories.name, pattern),
                  ),
                ),
            ),
          )
        : undefined,
    );
    const rows = await db
      .select()
      .from(products)
      .where(condition)
      .orderBy(desc(products.updatedAt), asc(products.id))
      .limit(input.limit)
      .offset(input.offset);
    const [total] = await db
      .select({ value: count() })
      .from(products)
      .where(condition);
    const variants = rows.length
      ? await db
          .select()
          .from(productVariants)
          .where(
            inArray(
              productVariants.productId,
              rows.map((row) => row.id),
            ),
          )
      : [];
    return {
      products: rows.map((row) => ({
        ...row,
        readiness: readinessBadges(
          row,
          variants.filter((v) => v.productId === row.id),
        ),
      })),
      listing: pagination(total!.value, input, path),
    };
  }
  async function inventoryList(query: Record<string, unknown> = {}) {
    const input = listInput(query);
    const filter = typeof query.stock === 'string' ? query.stock : '';
    if (!['', 'unknown', 'out', 'in'].includes(filter))
      throw new FormError('stock', 'Choose a valid stock filter.');
    const pattern = searchPattern(input.q);
    const condition = and(
      eq(products.vendorId, await owner()),
      input.q
        ? or(
            ilike(products.name, pattern),
            ilike(productVariants.sku, pattern),
            ilike(productVariants.name, pattern),
          )
        : undefined,
      filter === 'unknown'
        ? eq(productVariants.stockKnown, false)
        : filter === 'out'
          ? and(
              eq(productVariants.stockKnown, true),
              eq(productVariants.stockQuantity, 0),
            )
          : filter === 'in'
            ? and(
                eq(productVariants.stockKnown, true),
                sql`${productVariants.stockQuantity}>0`,
              )
            : undefined,
    );
    const rows = await db
      .select({ product: products, variant: productVariants })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(condition)
      .orderBy(
        asc(products.name),
        asc(productVariants.sku),
        asc(productVariants.id),
      )
      .limit(input.limit)
      .offset(input.offset);
    const [total] = await db
      .select({ value: count() })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(condition);
    return {
      inventory: rows.map((row) => ({
        ...row,
        readiness: readinessBadges(row.product, [row.variant]),
      })),
      stockFilter: filter,
      listing: pagination(
        total!.value,
        input,
        '/admin/inventory',
        filter ? { stock: filter } : {},
      ),
    };
  }
  const result = (): BulkResult => ({
    updated: 0,
    skipped: 0,
    failed: 0,
    rows: [],
  });
  const add = (
    summary: BulkResult,
    id: string,
    name: string,
    state: 'updated' | 'skipped' | 'failed',
    reason: string,
  ) => {
    summary[state]++;
    summary.rows.push({ id, name, result: state, reason });
  };
  const fields = (row: Record<string, unknown>): Form =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        value === null
          ? ''
          : typeof value === 'boolean'
            ? key === 'featured'
              ? value
                ? 'on'
                : ''
              : String(value)
            : typeof value === 'number' || typeof value === 'bigint'
              ? String(value)
              : value,
      ]),
    );
  async function bulkProducts(form: Form) {
    const ids = selectedIds(form);
    const action = choice(form, 'action', [
      'activate',
      'deactivate',
      'archive',
    ]);
    const vendorId = await owner();
    return db.transaction(async (tx) => {
      // Same product-before-variant order as sale, cost and stock writers.
      const rows = await tx
        .select()
        .from(products)
        .where(and(inArray(products.id, ids), eq(products.vendorId, vendorId)))
        .orderBy(products.id)
        .for('update');
      const summary = result();
      for (const selected of ids) {
        const product = rows.find((row) => row.id === selected);
        if (!product) {
          add(
            summary,
            selected,
            selected,
            'failed',
            'Product not found or not owned by LOKKA.',
          );
          continue;
        }
        if (product.status === 'archived') {
          add(
            summary,
            selected,
            product.name,
            'skipped',
            'Archived item retained with its historical references; restore individually in Products.',
          );
          continue;
        }
        const target =
          action === 'activate'
            ? 'active'
            : action === 'deactivate'
              ? 'draft'
              : 'archived';
        if (product.status === target) {
          add(summary, selected, product.name, 'skipped', `Already ${target}.`);
          continue;
        }
        try {
          const reason = await tx.transaction(async (rowTx) => {
            const catalog = createCatalog(rowTx, storage);
            let message =
              'Status updated; catalog, stock and historical snapshots retained.';
            if (action === 'activate') {
              const variants = await rowTx
                .select()
                .from(productVariants)
                .where(eq(productVariants.productId, product.id))
                .orderBy(productVariants.id)
                .for('update');
              const eligible = variants.filter(
                (v) =>
                  isOperationalVariant({ ...v, status: 'active' }) &&
                  v.stockKnown &&
                  v.stockQuantity > 0,
              );
              if (!eligible.length)
                throw new FormError(
                  'status',
                  variants.some((v) => !v.stockKnown)
                    ? 'Stock unknown; confirm quantity before bulk activation.'
                    : 'No eligible known-stock variant with positive stock, valid SKU and price.',
                );
              for (const variant of eligible)
                if (variant.status !== 'active')
                  await catalog.saveVariant(
                    product.id,
                    { ...fields(variant), status: 'active' },
                    variant.id,
                  );
              message = `Activated ${eligible.length} eligible variants for operations; ${variants.length - eligible.length} other variants unchanged. Weight missing affects Webstore readiness only.`;
            }
            if (action === 'archive') await catalog.archive(product.id);
            else
              await catalog.saveProduct(
                { ...fields(product), status: target },
                product.id,
              );
            return message;
          });
          add(summary, selected, product.name, 'updated', reason);
        } catch (error) {
          if (!(error instanceof FormError)) throw error;
          add(summary, selected, product.name, 'failed', error.message);
        }
      }
      return summary;
    });
  }
  async function bulkInventory(form: Form) {
    const ids = selectedIds(form);
    const action = choice(form, 'action', ['save', 'unknown']);
    const vendorId = await owner();
    return db.transaction(async (tx) => {
      const owned = await tx
        .select({ product: products, variant: productVariants })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(
          and(
            inArray(productVariants.id, ids),
            eq(products.vendorId, vendorId),
          ),
        );
      const productIds = [
        ...new Set(owned.map((row) => row.product.id)),
      ].sort();
      const lockedProducts = productIds.length
        ? await tx
            .select()
            .from(products)
            .where(inArray(products.id, productIds))
            .orderBy(products.id)
            .for('update')
        : [];
      const variants = owned.length
        ? await tx
            .select()
            .from(productVariants)
            .where(
              inArray(
                productVariants.id,
                owned.map((row) => row.variant.id),
              ),
            )
            .orderBy(productVariants.id)
            .for('update')
        : [];
      const summary = result();
      for (const selected of ids) {
        const row = owned.find((row) => row.variant.id === selected);
        const variant = variants.find((v) => v.id === selected);
        if (!row || !variant) {
          add(
            summary,
            selected,
            selected,
            'failed',
            'Variant not found or not owned by LOKKA.',
          );
          continue;
        }
        const name = `${row.product.name} / ${variant.sku}`;
        if (
          lockedProducts.find((p) => p.id === row.product.id)?.status ===
          'archived'
        ) {
          add(
            summary,
            selected,
            name,
            'skipped',
            'Archived historical item; stock is not overwritten in bulk.',
          );
          continue;
        }
        const state =
          action === 'unknown' ? 'false' : form[`stockKnown_${selected}`];
        const quantity =
          action === 'unknown' ? '' : form[`stockQuantity_${selected}`];
        if (
          state === 'false' &&
          variant.stockKnown &&
          variant.stockQuantity > 0
        ) {
          add(
            summary,
            selected,
            name,
            'failed',
            'Positive recorded quantity cannot be discarded by bulk marking unknown. Review and correct the quantity explicitly first.',
          );
          continue;
        }
        if (
          action === 'save' &&
          (typeof state !== 'string' || typeof quantity !== 'string')
        ) {
          add(
            summary,
            selected,
            name,
            'failed',
            'Enter the stock state and quantity for each selected row.',
          );
          continue;
        }
        try {
          const catalog = createCatalog(tx, storage);
          // stock() validates before writing and records only factual confirmations/corrections.
          const values = stockInput(
            { stockKnown: state, stockQuantity: quantity },
            variant.stockKnown,
          );
          if (
            values.stockKnown === variant.stockKnown &&
            values.stockQuantity === variant.stockQuantity
          ) {
            add(
              summary,
              selected,
              name,
              'skipped',
              'Stock state and quantity unchanged.',
            );
            continue;
          }
          await catalog.stock(row.product.id, selected, {
            stockKnown: state,
            stockQuantity: quantity,
            stockNote: 'Bulk owner stock confirmation / correction',
          });
          add(
            summary,
            selected,
            name,
            'updated',
            values.stockKnown
              ? 'Quantity confirmed; correction recorded.'
              : 'Marked unspecified; no numerical stock movement fabricated.',
          );
        } catch (error) {
          if (!(error instanceof FormError)) throw error;
          add(summary, selected, name, 'failed', error.message);
        }
      }
      return summary;
    });
  }
  return { metrics, productList, inventoryList, bulkProducts, bulkInventory };
}
