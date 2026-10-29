import { eq, and, sql, desc } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  products,
  productVariants,
  productImages,
  sales,
  saleItems,
  salePayments,
  inventoryMovements,
  transactionCounters,
  adminUsers,
  directCosts,
} from '../../db/schema/index.js';
import { insertSaleIncome } from '../finance/ledger.js';

export interface SaleItemInput {
  variantId: string;
  quantity: number;
}

export interface SaleCompletionInput {
  source: 'POS' | 'WEBSTORE';
  cashierId?: string;
  customerId?: string;
  items: SaleItemInput[];
  cashTendered?: bigint;
}

export interface SaleResult {
  saleId: string;
  transactionNumber: string;
  source: string;
  subtotal: bigint;
  discountAmount: bigint;
  total: bigint;
  cashReceived: bigint;
  changeAmount: bigint;
  items: {
    id: string;
    productName: string;
    variantName: string;
    sku: string;
    quantity: number;
    unitPrice: bigint;
    lineTotal: bigint;
  }[];
  completedAt: Date;
}

export interface PosProduct {
  id: string;
  name: string;
  slug: string;
  status: string;
  categoryId: string | null;
  variants: {
    id: string;
    name: string;
    sku: string;
    price: bigint;
    stockQuantity: number;
    status: string;
  }[];
  primaryImage: {
    storageKey: string;
    width: number;
    height: number;
  } | null;
}

async function nextTransactionNumber(
  tx: Parameters<Parameters<Database['db']['transaction']>[0]>[0],
): Promise<string> {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10);
  const [counter] = await tx
    .select()
    .from(transactionCounters)
    .where(eq(transactionCounters.date, dateStr))
    .for('update');
  let seq: number;
  if (counter) {
    seq = counter.nextSequence;
    await tx
      .update(transactionCounters)
      .set({ nextSequence: seq + 1 })
      .where(eq(transactionCounters.date, dateStr));
  } else {
    seq = 1;
    await tx.insert(transactionCounters).values({
      date: dateStr,
      nextSequence: 2,
    });
  }
  const dateCompact = dateStr.replace(/-/g, '');
  return `POS-${dateCompact}-${String(seq).padStart(6, '0')}`;
}

export function createSalesService(db: Database['db']) {
  async function searchProducts(query?: string): Promise<PosProduct[]> {
    const activeCondition = eq(products.status, 'active');

    let productIdsToShow: string[] | null = null;
    if (query && query.trim()) {
      const pattern = `%${query.trim()}%`;
      // Find matching product IDs by name OR by variant SKU
      const nameMatches = await db
        .select({ id: products.id })
        .from(products)
        .where(and(activeCondition, sql`${products.name} ILIKE ${pattern}`))
        .limit(50);
      const skuMatches = await db
        .select({ productId: productVariants.productId })
        .from(productVariants)
        .where(sql`${productVariants.sku} ILIKE ${pattern}`)
        .limit(50);
      const idSet = new Set<string>();
      for (const r of nameMatches) idSet.add(r.id);
      for (const r of skuMatches) idSet.add(r.productId);
      productIdsToShow = [...idSet];
      if (!productIdsToShow.length) return [];
    }

    const idsCondition = productIdsToShow
      ? sql`${products.id} IN (${sql.join(
          productIdsToShow.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : activeCondition;

    const productsList = await db
      .select({
        id: products.id,
        name: products.name,
        slug: products.slug,
        status: products.status,
        categoryId: products.categoryId,
      })
      .from(products)
      .where(idsCondition)
      .limit(50);

    const productIds = productsList.map((p) => p.id);
    if (!productIds.length) return [];

    const [variantsRows, imagesRows] = await Promise.all([
      db
        .select({
          id: productVariants.id,
          productId: productVariants.productId,
          name: productVariants.name,
          sku: productVariants.sku,
          price: productVariants.price,
          stockQuantity: productVariants.stockQuantity,
          status: productVariants.status,
        })
        .from(productVariants)
        .where(
          sql`${productVariants.productId} IN (${sql.join(
            productIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        ),
      db
        .select({
          productId: productImages.productId,
          storageKey: productImages.storageKey,
          width: productImages.width,
          height: productImages.height,
          isPrimary: productImages.isPrimary,
        })
        .from(productImages)
        .where(
          sql`${productImages.productId} IN (${sql.join(
            productIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        ),
    ]);

    const variantMap = new Map<string, PosProduct['variants']>();
    for (const v of variantsRows) {
      const list = variantMap.get(v.productId) ?? [];
      list.push({
        id: v.id,
        name: v.name,
        sku: v.sku,
        price: v.price,
        stockQuantity: v.stockQuantity,
        status: v.status,
      });
      variantMap.set(v.productId, list);
    }

    const imageMap = new Map<string, PosProduct['primaryImage']>();
    for (const img of imagesRows) {
      if (img.isPrimary) {
        imageMap.set(img.productId, {
          storageKey: img.storageKey,
          width: img.width,
          height: img.height,
        });
      } else if (!imageMap.has(img.productId)) {
        imageMap.set(img.productId, {
          storageKey: img.storageKey,
          width: img.width,
          height: img.height,
        });
      }
    }

    return productsList.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      status: p.status,
      categoryId: p.categoryId,
      variants: variantMap.get(p.id) ?? [],
      primaryImage: imageMap.get(p.id) ?? null,
    }));
  }

  async function completeSale(input: SaleCompletionInput): Promise<SaleResult> {
    if (!input.items.length)
      throw new Error('Sale must have at least one item');
    if (input.source === 'POS' && !input.cashierId)
      throw new Error('POS sale requires a cashier');

    return db.transaction(async (tx) => {
      const variantIds = input.items.map((i) => i.variantId);
      const parents = await tx
        .select({ productId: productVariants.productId })
        .from(productVariants)
        .where(
          sql`${productVariants.id} IN (${sql.join(
            variantIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        );
      const productIds = [...new Set(parents.map((v) => v.productId))].sort();
      // Match catalog's product-before-variant lock order. Cost writers also
      // hold the product lock, so cost capture cannot race their updates.
      const productSnapshots = productIds.length
        ? await tx
            .select({ id: products.id, name: products.name })
            .from(products)
            .where(
              sql`${products.id} IN (${sql.join(
                productIds.map((id) => sql`${id}`),
                sql`, `,
              )})`,
            )
            .orderBy(products.id)
            .for('update')
        : [];
      // Lock relevant variant rows
      const variantRows = await tx
        .select({
          id: productVariants.id,
          productId: productVariants.productId,
          name: productVariants.name,
          sku: productVariants.sku,
          price: productVariants.price,
          stockQuantity: productVariants.stockQuantity,
          status: productVariants.status,
        })
        .from(productVariants)
        .where(
          sql`${productVariants.id} IN (${sql.join(
            variantIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        )
        .for('update');

      const variantMap = new Map(variantRows.map((v) => [v.id, v]));

      // Validate and calculate
      let subtotal = 0n;
      const saleItemData: {
        variantId: string;
        productId: string;
        variant: (typeof variantRows)[0];
        quantity: number;
        unitPrice: bigint;
        lineTotal: bigint;
      }[] = [];

      for (const item of input.items) {
        const variant = variantMap.get(item.variantId);
        if (!variant) throw new Error(`Variant not found: ${item.variantId}`);
        if (variant.status !== 'active')
          throw new Error(`Variant ${variant.sku} is not active`);
        if (variant.stockQuantity < item.quantity)
          throw new Error(
            `Insufficient stock for ${variant.sku}: available ${variant.stockQuantity}, requested ${item.quantity}`,
          );

        const lineTotal = variant.price * BigInt(item.quantity);
        subtotal += lineTotal;
        saleItemData.push({
          variantId: variant.id,
          productId: variant.productId,
          variant,
          quantity: item.quantity,
          unitPrice: variant.price,
          lineTotal,
        });
      }

      const total = subtotal;
      const transactionNumber = await nextTransactionNumber(tx);
      const now = new Date();

      // Create sale
      const [sale] = await tx
        .insert(sales)
        .values({
          transactionNumber,
          source: input.source,
          status: 'completed',
          customerId: input.customerId ?? null,
          cashierId: input.cashierId ?? null,
          subtotal,
          discountAmount: 0n,
          total,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: sales.id });

      if (!sale) throw new Error('Failed to create sale');

      // Cost writers lock the product row too: capture one stable direct-cost
      // fact per unit, excluding pricing-only Global Overhead assumptions.
      const costs = await tx
        .select({
          productId: directCosts.productId,
          cost: sql<string>`sum(${directCosts.amountRupiah})::text`,
        })
        .from(directCosts)
        .where(
          sql`${directCosts.productId} IN (${sql.join(
            productIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        )
        .groupBy(directCosts.productId);
      const costMap = new Map(costs.map((c) => [c.productId, BigInt(c.cost)]));

      // Create sale items with historical snapshots. No configured components
      // means unknown cost, not a claimed zero; an explicit zero component is valid.
      const createdItems: SaleResult['items'] = [];
      for (const item of saleItemData) {
        const productRow = productSnapshots.find(
          (p) => p.id === item.productId,
        );

        const [createdItem] = await tx
          .insert(saleItems)
          .values({
            saleId: sale.id,
            productId: item.productId,
            variantId: item.variantId,
            skuSnapshot: item.variant.sku,
            productNameSnapshot: productRow?.name ?? 'Unknown',
            variantNameSnapshot: item.variant.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal,
            costSnapshot: costMap.get(item.productId) ?? null,
            createdAt: now,
          })
          .returning({ id: saleItems.id });

        if (!createdItem) throw new Error('Failed to create sale item');

        createdItems.push({
          id: createdItem.id,
          productName: productRow?.name ?? 'Unknown',
          variantName: item.variant.name,
          sku: item.variant.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
        });
      }

      // Create payment record
      const cashReceived = input.cashTendered ?? total;
      const changeAmount = cashReceived > total ? cashReceived - total : 0n;
      await tx.insert(salePayments).values({
        saleId: sale.id,
        method: 'CASH',
        status: 'COMPLETED',
        amountDue: total,
        amountTendered: cashReceived,
        changeAmount,
        createdAt: now,
        updatedAt: now,
      });

      // Create inventory movements and update stock
      for (const item of saleItemData) {
        const negQty = -item.quantity;
        await tx.insert(inventoryMovements).values({
          variantId: item.variantId,
          type: 'SALE',
          quantityChange: negQty,
          referenceType: 'SALE',
          referenceId: sale.id,
          notes: `POS sale ${transactionNumber}`,
          createdAt: now,
        });
        await tx
          .update(productVariants)
          .set({
            stockQuantity: item.variant.stockQuantity - item.quantity,
            updatedAt: now,
          })
          .where(eq(productVariants.id, item.variantId));
      }

      // Canonical finance entry: exactly one posted income row per sale.
      // Cash tendered and change stay in sale_payments; they never become a
      // second ledger row (no double counting).
      await insertSaleIncome(tx, {
        saleId: sale.id,
        source: input.source,
        amountRupiah: total,
        occurredAt: now,
        notes: `Sale ${transactionNumber}`,
      });

      return {
        saleId: sale.id,
        transactionNumber,
        source: input.source,
        subtotal,
        discountAmount: 0n,
        total,
        cashReceived,
        changeAmount,
        items: createdItems,
        completedAt: now,
      };
    });
  }

  async function getSale(saleId: string) {
    const [sale] = await db
      .select()
      .from(sales)
      .where(eq(sales.id, saleId))
      .limit(1);
    if (!sale) return null;

    const [items, payments, cashier] = await Promise.all([
      db.select().from(saleItems).where(eq(saleItems.saleId, saleId)),
      db.select().from(salePayments).where(eq(salePayments.saleId, saleId)),
      sale.cashierId
        ? db
            .select({
              id: adminUsers.id,
              name: adminUsers.name,
              email: adminUsers.email,
            })
            .from(adminUsers)
            .where(eq(adminUsers.id, sale.cashierId))
            .limit(1)
        : Promise.resolve([]),
    ]);

    return {
      ...sale,
      items,
      payments,
      cashier: cashier[0] ?? null,
    };
  }

  async function listSales(
    opts: {
      limit?: number;
      offset?: number;
      source?: string;
    } = {},
  ) {
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    const conditions = [];
    if (opts.source)
      conditions.push(eq(sales.source, opts.source as 'POS' | 'WEBSTORE'));

    const where = conditions.length ? and(...conditions) : undefined;

    const [items, countResult] = await Promise.all([
      db
        .select()
        .from(sales)
        .where(where)
        .orderBy(desc(sales.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(sales)
        .where(where),
    ]);

    return { items, total: countResult[0]?.count ?? 0 };
  }

  async function getVariantStock(variantId: string) {
    const [v] = await db
      .select({
        stockQuantity: productVariants.stockQuantity,
        sku: productVariants.sku,
      })
      .from(productVariants)
      .where(eq(productVariants.id, variantId))
      .limit(1);
    return v ?? null;
  }

  return {
    searchProducts,
    completeSale,
    getSale,
    listSales,
    getVariantStock,
  };
}
