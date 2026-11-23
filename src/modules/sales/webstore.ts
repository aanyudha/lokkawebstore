import { eq } from 'drizzle-orm';
import {
  inventoryMovements,
  orderItems,
  orders,
  productVariants,
  saleItems,
  sales,
} from '../../db/schema/index.js';
import { lockCatalog, type Transaction } from '../cart/service.js';
import { insertSaleIncome } from '../finance/ledger.js';

export async function lockOrderStock(
  tx: Transaction,
  orderId: string,
): Promise<
  | {
      item: typeof orderItems.$inferSelect;
      variant: typeof productVariants.$inferSelect;
    }[]
  | null
> {
  const items = await tx
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  if (!items.length) return null;
  const { variantRows } = await lockCatalog(
    tx,
    items.flatMap((item) => (item.variantId ? [item.variantId] : [])),
  );
  const variants = new Map(variantRows.map((variant) => [variant.id, variant]));
  const stock = [];
  for (const item of items) {
    const variant = item.variantId && variants.get(item.variantId);
    if (
      !variant ||
      item.productId !== variant.productId ||
      !variant.stockKnown ||
      variant.stockQuantity < item.quantity
    )
      return null;
    stock.push({ item, variant });
  }
  return stock;
}

export async function postPaidWebstoreSale(
  tx: Transaction,
  order: typeof orders.$inferSelect,
  stock: NonNullable<Awaited<ReturnType<typeof lockOrderStock>>>,
  paidAt: Date,
  now: Date,
) {
  const [sale] = await tx
    .insert(sales)
    .values({
      orderId: order.id,
      transactionNumber: order.orderNumber,
      customerId: order.customerId,
      source: 'WEBSTORE',
      status: 'completed',
      subtotal: order.subtotal,
      shippingAmount: order.shippingAmount,
      discountAmount: order.discountAmount,
      total: order.grandTotal,
      createdAt: paidAt,
      updatedAt: now,
    })
    .returning({ id: sales.id });
  const saleId = sale!.id;
  await tx.insert(saleItems).values(
    stock.map(({ item, variant }) => ({
      saleId,
      productId: variant.productId,
      variantId: variant.id,
      productNameSnapshot: item.productNameSnapshot,
      variantNameSnapshot: item.variantNameSnapshot,
      skuSnapshot: item.skuSnapshot,
      quantity: item.quantity,
      unitPrice: item.unitPriceSnapshot,
      lineTotal: item.lineTotalSnapshot,
      costSnapshot: item.costSnapshot,
      createdAt: paidAt,
    })),
  );
  await tx.insert(inventoryMovements).values(
    stock.map(({ item, variant }) => ({
      variantId: variant.id,
      type: 'SALE' as const,
      referenceType: 'SALE' as const,
      referenceId: saleId,
      quantityChange: -item.quantity,
      notes: `Webstore sale ${order.orderNumber}`,
      createdAt: now,
    })),
  );
  for (const { item, variant } of stock) {
    await tx
      .update(productVariants)
      .set({
        stockQuantity: variant.stockQuantity - item.quantity,
        updatedAt: now,
      })
      .where(eq(productVariants.id, variant.id));
  }
  await insertSaleIncome(tx, {
    saleId,
    source: 'WEBSTORE',
    category: 'WEBSTORE_ORDER',
    amountRupiah: order.grandTotal,
    occurredAt: paidAt,
    notes: `Sale ${order.orderNumber}`,
  });
}
