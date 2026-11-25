import { and, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  financialTransactions as expenses,
  saleItems,
  sales,
} from '../../db/schema/index.js';
import { EXPENSE_CATEGORIES, type CashFlowPeriod } from './ledger.js';

// Manual cash income (including PRODUCT_SALES) is cash-only. Only completed
// canonical sales recognize revenue; never infer revenue from category names.
export const MANUAL_INCOME_ACCOUNTING = 'CASH_ONLY' as const;

type ReportConnection =
  Database['db'] | Parameters<Parameters<Database['db']['transaction']>[0]>[0];
export async function readAccounting(
  tx: ReportConnection,
  period: CashFlowPeriod,
) {
  const validSales = and(
    eq(sales.status, 'completed'),
    inArray(sales.source, ['POS', 'WEBSTORE']),
    gte(sales.createdAt, period.from),
    lte(sales.createdAt, period.to),
  );
  const validExpenses = and(
    eq(expenses.status, 'POSTED'),
    eq(expenses.direction, 'EXPENSE'),
    or(
      and(eq(expenses.type, 'MANUAL'), eq(expenses.source, 'MANUAL')),
      eq(expenses.type, 'SHIPPING_EXPENSE'),
    ),
    inArray(expenses.category, [...EXPENSE_CATEGORIES]),
    gte(expenses.occurredAt, period.from),
    lte(expenses.occurredAt, period.to),
  );
  const bySourceRows = await tx
    .select({
      key: sales.source,
      revenue: sql<string>`sum(${sales.total}::numeric)::text`,
      shippingCharged: sql<string>`sum(${sales.shippingAmount}::numeric)::text`,
      count: sql<string>`count(*)::text`,
    })
    .from(sales)
    .where(validSales)
    .groupBy(sales.source)
    .orderBy(sales.source);
  // Cast before multiplication: a period aggregate may exceed pg bigint.
  const [costs] = await tx
    .select({
      knownCogs: sql<string>`coalesce(sum(${saleItems.quantity}::numeric * ${saleItems.costSnapshot}), 0)::text`,
      itemCount: sql<string>`count(*)::text`,
      units: sql<string>`coalesce(sum(${saleItems.quantity}::numeric), 0)::text`,
      missingItems: sql<string>`count(*) filter (where ${saleItems.costSnapshot} is null)::text`,
    })
    .from(saleItems)
    .innerJoin(sales, eq(sales.id, saleItems.saleId))
    .where(validSales);
  const [missingSales] = await tx
    .select({
      count: sql<string>`count(*)::text`,
    })
    .from(sales)
    .where(
      and(
        validSales,
        sql`not exists (select 1 from ${saleItems} where ${saleItems.saleId} = ${sales.id})`,
      ),
    );
  const byCategoryRows = await tx
    .select({
      key: expenses.category,
      total: sql<string>`sum(${expenses.amountRupiah}::numeric)::text`,
    })
    .from(expenses)
    .where(validExpenses)
    .groupBy(expenses.category)
    .orderBy(expenses.category);
  const recentSales = await tx
    .select({
      id: sales.id,
      reference: sales.transactionNumber,
      source: sales.source,
      occurredAt: sales.createdAt,
      revenue: sales.total,
      shippingCharged: sales.shippingAmount,
    })
    .from(sales)
    .where(validSales)
    .orderBy(desc(sales.createdAt), desc(sales.id))
    .limit(100);
  const recentItems = await tx
    .select({
      id: saleItems.id,
      saleId: sales.id,
      reference: sales.transactionNumber,
      product: saleItems.productNameSnapshot,
      variant: saleItems.variantNameSnapshot,
      sku: saleItems.skuSnapshot,
      quantity: saleItems.quantity,
      unitCost: saleItems.costSnapshot,
      cogs: sql<
        string | null
      >`(${saleItems.quantity}::numeric * ${saleItems.costSnapshot})::text`,
    })
    .from(saleItems)
    .innerJoin(sales, eq(sales.id, saleItems.saleId))
    .where(validSales)
    .orderBy(desc(sales.createdAt), desc(sales.id), saleItems.id)
    .limit(200);
  const recentExpenses = await tx
    .select({
      id: expenses.id,
      occurredAt: expenses.occurredAt,
      category: expenses.category,
      notes: expenses.notes,
      total: expenses.amountRupiah,
    })
    .from(expenses)
    .where(validExpenses)
    .orderBy(desc(expenses.occurredAt), desc(expenses.id))
    .limit(100);
  const bySource = bySourceRows.map((r) => ({
    key: r.key,
    revenue: BigInt(r.revenue),
    count: BigInt(r.count),
  }));
  const byCategory = byCategoryRows.map((r) => ({
    ...r,
    total: BigInt(r.total),
  }));
  const revenue = bySource.reduce((sum, r) => sum + r.revenue, 0n);
  const shippingCharged = bySourceRows.reduce(
    (sum, r) => sum + BigInt(r.shippingCharged),
    0n,
  );
  const operatingExpenses = byCategory.reduce((sum, r) => sum + r.total, 0n);
  const missingItemCount = BigInt(costs!.missingItems);
  const missingSaleCount = BigInt(missingSales!.count);
  const knownCogs = BigInt(costs!.knownCogs);
  const cogs = missingItemCount || missingSaleCount ? null : knownCogs;
  const grossProfit = cogs === null ? null : revenue - cogs;
  return {
    revenue,
    merchandiseRevenue: revenue - shippingCharged,
    shippingCharged,
    cogs,
    knownCogs,
    grossProfit,
    operatingExpenses,
    netProfit: grossProfit === null ? null : grossProfit - operatingExpenses,
    missingItemCount,
    missingSaleCount,
    itemCount: BigInt(costs!.itemCount),
    units: BigInt(costs!.units),
    saleCount: bySource.reduce((sum, r) => sum + r.count, 0n),
    bySource,
    byCategory,
    recentSales,
    recentItems,
    recentExpenses,
  };
}
export function createAccounting(db: Database['db']) {
  return {
    async report(period: CashFlowPeriod) {
      return db.transaction(async (tx) => {
        await tx.execute(
          sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`,
        );
        return readAccounting(tx, period);
      });
    },
  };
}
export type Accounting = ReturnType<typeof createAccounting>;
