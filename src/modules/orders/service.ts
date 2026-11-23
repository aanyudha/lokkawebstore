import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  cartItems,
  directCosts,
  orderCounters,
  orderItems,
  orders,
  type ShippingAddressSnapshot,
  type ShippingMethodSnapshot,
} from '../../db/schema/index.js';
import {
  lockCart,
  lockCatalog,
  touchCart,
  validateVariant,
  type Transaction,
} from '../cart/service.js';
import { FormError, id } from '../catalog/validation.js';
import { MAX_RUPIAH } from '../finance/calculations.js';

type ReviewedItem = Pick<
  typeof orderItems.$inferInsert,
  | 'quantity'
  | 'unitPriceSnapshot'
  | 'productNameSnapshot'
  | 'variantNameSnapshot'
  | 'skuSnapshot'
> & { variantId: string; unitWeightGrams: number };
type Delivery = {
  shippingAddressSnapshot: ShippingAddressSnapshot;
  shippingMethodSnapshot: ShippingMethodSnapshot;
  shipmentWeightGrams: bigint;
  shippingAmount: bigint;
  discountAmount: bigint;
  grandTotal: bigint;
};

export function createOrderService(db: Database['db']) {
  async function create(
    customerId: string,
    revision: string,
    resolveDelivery: (
      tx: Transaction,
      items: ReviewedItem[],
      subtotal: bigint,
    ) => Promise<Delivery>,
  ) {
    id(customerId, 'customerId');
    id(revision, 'revision');
    return db.transaction(async (tx) => {
      const cart = await lockCart(tx, customerId);
      const [prior] = await tx
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.customerId, customerId),
            eq(orders.idempotencyKey, revision),
          ),
        );
      if (prior) return prior;
      if (cart.revision !== revision)
        throw new FormError('cart', 'shop.error.changed');
      const items = await tx
        .select()
        .from(cartItems)
        .where(eq(cartItems.cartId, cart.id))
        .orderBy(cartItems.variantId);
      if (!items.length) throw new FormError('cart', 'shop.error.empty');
      const { productRows, variantRows, productIds } = await lockCatalog(
        tx,
        items.map((i) => i.variantId),
      );
      const snapshots = items.map((item) => {
        const variant = variantRows.find((v) => v.id === item.variantId);
        const product = productRows.find((p) => p.id === variant?.productId);
        validateVariant(product, variant, item.quantity);
        return {
          productId: product!.id,
          variantId: variant!.id,
          productNameSnapshot: product!.name,
          variantNameSnapshot: variant!.name,
          skuSnapshot: variant!.sku,
          unitPriceSnapshot: variant!.price,
          quantity: item.quantity,
          unitWeightGrams: variant!.weightGrams,
          lineTotalSnapshot: variant!.price * BigInt(item.quantity),
        };
      });
      const subtotal = snapshots.reduce(
        (sum, i) => sum + i.lineTotalSnapshot,
        0n,
      );
      if (subtotal > MAX_RUPIAH)
        throw new FormError('cart', 'shop.error.total');
      const delivery = await resolveDelivery(tx, snapshots, subtotal);
      const costs = await tx
        .select({
          productId: directCosts.productId,
          cost: sql<string>`sum(${directCosts.amountRupiah}::numeric)::text`,
        })
        .from(directCosts)
        .where(inArray(directCosts.productId, productIds))
        .groupBy(directCosts.productId);
      const costMap = new Map(costs.map((c) => [c.productId, BigInt(c.cost)]));
      if ([...costMap.values()].some((c) => c > MAX_RUPIAH))
        throw new FormError('cart', 'shop.error.total');
      const date = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      const [counter] = await tx
        .insert(orderCounters)
        .values({ date, nextSequence: 2 })
        .onConflictDoUpdate({
          target: orderCounters.date,
          set: { nextSequence: sql`${orderCounters.nextSequence} + 1` },
        })
        .returning();
      const orderNumber = `WEB-${date.replaceAll('-', '')}-${String(counter!.nextSequence - 1).padStart(6, '0')}`;
      const [order] = await tx
        .insert(orders)
        .values({
          orderNumber,
          customerId,
          idempotencyKey: revision,
          subtotal,
          ...delivery,
        })
        .returning();
      await tx.insert(orderItems).values(
        snapshots.map((i) => ({
          ...i,
          orderId: order!.id,
          costSnapshot: costMap.get(i.productId) ?? null,
        })),
      );
      await tx.delete(cartItems).where(eq(cartItems.cartId, cart.id));
      await touchCart(tx, cart.id);
      return order!;
    });
  }
  async function list(customerId: string) {
    return db
      .select()
      .from(orders)
      .where(eq(orders.customerId, customerId))
      .orderBy(desc(orders.createdAt), desc(orders.id));
  }
  async function get(customerId: string, orderNumber: string) {
    const [order] = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.customerId, customerId),
          eq(orders.orderNumber, orderNumber),
        ),
      );
    if (!order) return null;
    return {
      ...order,
      items: await db
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, order.id))
        .orderBy(orderItems.id),
    };
  }
  async function cancel(customerId: string, orderNumber: string) {
    // Conditional write is safe for concurrent cancellations; no completion API in E1.
    const [order] = await db
      .update(orders)
      .set({ status: 'CANCELLED', updatedAt: new Date() })
      .where(
        and(
          eq(orders.customerId, customerId),
          eq(orders.orderNumber, orderNumber),
          eq(orders.status, 'PENDING_PAYMENT'),
        ),
      )
      .returning();
    if (!order) {
      const prior = await get(customerId, orderNumber);
      if (!prior || prior.status !== 'CANCELLED')
        throw new FormError('order', 'shop.error.cancel');
    }
  }
  return { create, list, get, cancel };
}
