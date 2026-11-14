import { and, eq, ne, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  products,
  productVariants,
  directCosts,
  fixedAssets,
  vendors,
  reportingCoverage,
  sales,
  saleItems,
} from '../../db/schema/index.js';
import { readAccounting } from './accounting.js';
import { createLedger, resolvePeriod, type CashFlowPeriod } from './ledger.js';
import { FormError } from '../catalog/validation.js';
type Connection = Parameters<Parameters<Database['db']['transaction']>[0]>[0];
const nextMonth = (date: string) =>
  new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 1));
export function createInvestorReports(db: Database['db']) {
  async function assets(tx: Connection) {
    const [owner] = await tx
      .select()
      .from(vendors)
      .where(eq(vendors.slug, 'lokka'));
    if (!owner)
      throw new FormError('vendor', 'LOKKA vendor is not configured.');
    const costs = await tx
      .select({
        productId: directCosts.productId,
        total: sql<string>`sum(${directCosts.amountRupiah}::numeric)::text`,
      })
      .from(directCosts)
      .groupBy(directCosts.productId);
    const costsByProduct = new Map(
      costs.map((row) => [row.productId, BigInt(row.total)]),
    );
    const stock = await tx
      .select({ product: products, variant: productVariants })
      .from(products)
      .innerJoin(productVariants, eq(productVariants.productId, products.id))
      .where(
        and(eq(products.vendorId, owner.id), ne(products.status, 'archived')),
      )
      .orderBy(products.name, productVariants.sku);
    const inventory = stock.map(({ product, variant }) => {
      const hpp = costsByProduct.get(product.id) ?? null;
      const complete = variant.stockKnown && hpp !== null;
      return {
        product,
        variant,
        hpp,
        inventoryValue: complete ? BigInt(variant.stockQuantity) * hpp : null,
        retailValue: variant.stockKnown
          ? BigInt(variant.stockQuantity) * variant.price
          : null,
      };
    });
    const fixed = (
      await tx
        .select()
        .from(fixedAssets)
        .where(eq(fixedAssets.vendorId, owner.id))
        .orderBy(fixedAssets.assetName, fixedAssets.id)
    ).map((row) => ({
      ...row,
      total: BigInt(row.quantity) * row.acquisitionCostPerUnit,
    }));
    const knownUnits = inventory.reduce(
      (sum, row) =>
        sum + (row.variant.stockKnown ? BigInt(row.variant.stockQuantity) : 0n),
      0n,
    );
    const hppValue = inventory.reduce(
      (sum, row) => sum + (row.inventoryValue ?? 0n),
      0n,
    );
    const retailValue = inventory.reduce(
      (sum, row) => sum + (row.retailValue ?? 0n),
      0n,
    );
    const comparativeRetail = inventory.reduce(
      (sum, row) => sum + (row.inventoryValue !== null ? row.retailValue! : 0n),
      0n,
    );
    const fixedValue = fixed.reduce(
      (sum, row) => sum + (row.status === 'ACTIVE' ? row.total : 0n),
      0n,
    );
    return {
      inventory,
      fixed,
      knownUnits,
      hppValue,
      retailValue,
      comparativeRetail,
      grossSpread: comparativeRetail - hppValue,
      fixedValue,
      combinedValue: hppValue + fixedValue,
      incompleteCount: inventory.filter((row) => row.inventoryValue === null)
        .length,
      unknownStockCount: inventory.filter((row) => !row.variant.stockKnown)
        .length,
      unknownCostCount: inventory.filter((row) => row.hpp === null).length,
      ownerId: owner.id,
    };
  }
  async function projection(tx: Connection, ownerId: string, asOf: Date) {
    const months = await tx
      .select()
      .from(reportingCoverage)
      .where(eq(reportingCoverage.vendorId, ownerId))
      .orderBy(reportingCoverage.month);
    const currentMonth = asOf.toISOString().slice(0, 7) + '-01';
    // Require consecutive, documented months immediately preceding the current month.
    const included: typeof months = [];
    let boundary = currentMonth;
    for (const row of [...months].reverse()) {
      if (row.month >= currentMonth) continue;
      if (
        nextMonth(row.month).toISOString().slice(0, 10) !== boundary ||
        !row.salesComplete
      )
        break;
      included.unshift(row);
      boundary = row.month;
    }
    const first = included[0];
    const from = first ? new Date(first.month + 'T00:00:00.000Z') : null;
    const to = new Date(currentMonth + 'T00:00:00.000Z');
    const days = from ? (to.getTime() - from.getTime()) / 86400000 : 0;
    if (!first || !from || days < 30) return null;
    const period: CashFlowPeriod = {
      period: 'custom',
      from,
      to: new Date(to.getTime() - 1),
      fromInput: first.month,
      toInput: new Date(to.getTime() - 1).toISOString().slice(0, 10),
    };
    const actual = await readAccounting(tx, period);
    if (actual.cogs === null || !actual.saleCount) return null;
    const factor = (amount: bigint) => (amount * 12n) / BigInt(included.length);
    const expenseCoverage = included.every((row) => row.expensesComplete);
    return {
      from: period.fromInput,
      to: period.toInput,
      days,
      months: included.length,
      revenue: factor(actual.revenue),
      cogs: factor(actual.cogs),
      grossProfit: factor(actual.grossProfit!),
      expenses: expenseCoverage ? factor(actual.operatingExpenses) : null,
      netProfit: expenseCoverage ? factor(actual.netProfit!) : null,
    };
  }
  async function report(asOf = new Date(), includePlan = false) {
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`,
      );
      const asset = await assets(tx);
      if (!includePlan) return { asOf, asset, plan: null };
      const period = resolvePeriod({
        period: 'custom',
        from: '2000-01-01',
        to: asOf.toISOString().slice(0, 10),
      });
      period.to = asOf;
      const accounting = await readAccounting(tx, period);
      const cash = await createLedger(tx).cashFlow(period);
      const [legacy] = await tx
        .select({ count: sql<string>`count(distinct ${sales.id})::text` })
        .from(sales)
        .innerJoin(saleItems, eq(saleItems.saleId, sales.id))
        .where(
          and(
            eq(sales.status, 'completed'),
            sql`${saleItems.skuSnapshot} LIKE 'LOKKA-DEMO-%'`,
            sql`${sales.createdAt} <= ${asOf}`,
          ),
        );
      return {
        asOf,
        asset,
        plan: {
          accounting,
          cash,
          legacySales: BigInt(legacy?.count ?? '0'),
          projection: await projection(tx, asset.ownerId, asOf),
          period,
        },
      };
    });
  }
  return { report };
}
