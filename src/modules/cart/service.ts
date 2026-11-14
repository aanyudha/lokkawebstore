import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  carts,
  cartItems,
  products,
  productVariants,
} from '../../db/schema/index.js';
import { FormError, id } from '../catalog/validation.js';
import { MAX_RUPIAH } from '../finance/calculations.js';

export type Transaction = Parameters<
  Parameters<Database['db']['transaction']>[0]
>[0];
export function quantity(value: unknown): number {
  if (typeof value === 'string' && /^\d{1,10}$/.test(value))
    value = Number(value);
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 2147483647
  )
    throw new FormError('quantity', 'shop.error.quantity');
  return value;
}

// Serialize mutations and checkout for this customer's one durable cart.
export async function lockCart(tx: Transaction, customerId: string) {
  await tx
    .insert(carts)
    .values({ customerId })
    .onConflictDoNothing({ target: carts.customerId });
  const [cart] = await tx
    .select()
    .from(carts)
    .where(eq(carts.customerId, customerId))
    .for('update');
  return cart!;
}
export async function touchCart(tx: Transaction, cartId: string) {
  await tx
    .update(carts)
    .set({ revision: randomUUID(), updatedAt: new Date() })
    .where(eq(carts.id, cartId));
}

// Match POS/catalog lock order: products first, variants second, ordered IDs.
export async function lockCatalog(tx: Transaction, variantIds: string[]) {
  const parents = await tx
    .select({ productId: productVariants.productId })
    .from(productVariants)
    .where(inArray(productVariants.id, variantIds));
  const productIds = [...new Set(parents.map((v) => v.productId))].sort();
  const productRows = productIds.length
    ? await tx
        .select()
        .from(products)
        .where(inArray(products.id, productIds))
        .orderBy(products.id)
        .for('update')
    : [];
  const variantRows = await tx
    .select()
    .from(productVariants)
    .where(inArray(productVariants.id, variantIds))
    .orderBy(productVariants.id)
    .for('update');
  return { productRows, variantRows, productIds };
}
export function validateVariant(
  product: { status: string } | undefined,
  variant:
    | {
        status: string;
        stockQuantity: number;
        stockKnown: boolean;
        price: bigint;
      }
    | undefined,
  qty: number,
) {
  quantity(qty);
  if (
    !product ||
    product.status !== 'active' ||
    !variant ||
    variant.status !== 'active' ||
    !variant.stockKnown
  )
    throw new FormError('items', 'shop.error.unavailable');
  if (variant.stockQuantity < qty)
    throw new FormError('items', 'shop.error.stock');
}

export function createCartService(db: Database['db']) {
  async function get(customerId: string) {
    const [cart] = await db
      .select()
      .from(carts)
      .where(eq(carts.customerId, customerId));
    const rows = cart
      ? await db
          .select({
            item: cartItems,
            variant: productVariants,
            product: products,
          })
          .from(cartItems)
          .innerJoin(
            productVariants,
            eq(cartItems.variantId, productVariants.id),
          )
          .innerJoin(products, eq(productVariants.productId, products.id))
          .where(eq(cartItems.cartId, cart.id))
          .orderBy(cartItems.createdAt, cartItems.id)
      : [];
    const items = rows.map((row) => ({
      ...row,
      available:
        row.product.status === 'active' &&
        row.variant.status === 'active' &&
        row.variant.stockKnown &&
        row.variant.stockQuantity >= row.item.quantity,
      lineTotal: row.variant.price * BigInt(row.item.quantity),
    }));
    const subtotal = items.reduce((sum, row) => sum + row.lineTotal, 0n);
    return {
      cart,
      items,
      subtotal,
      canOrder:
        items.length > 0 &&
        items.every((i) => i.available) &&
        subtotal <= MAX_RUPIAH,
    };
  }
  async function mutate(
    customerId: string,
    action: 'add' | 'update' | 'remove',
    reference: string,
    value?: unknown,
  ) {
    id(customerId, 'customerId');
    id(reference, 'items');
    const qty = action === 'remove' ? 1 : quantity(value);
    await db.transaction(async (tx) => {
      const cart = await lockCart(tx, customerId);
      const [existing] = await tx
        .select()
        .from(cartItems)
        .where(
          and(
            eq(cartItems.cartId, cart.id),
            action === 'add'
              ? eq(cartItems.variantId, reference)
              : eq(cartItems.id, reference),
          ),
        );
      if (action !== 'add' && !existing)
        throw new FormError('items', 'shop.error.item');
      if (action === 'remove') {
        await tx
          .delete(cartItems)
          .where(
            and(eq(cartItems.id, reference), eq(cartItems.cartId, cart.id)),
          );
      } else {
        const variantId = action === 'add' ? reference : existing!.variantId;
        const { productRows, variantRows } = await lockCatalog(tx, [variantId]);
        const variant = variantRows[0];
        const next = action === 'add' ? qty + (existing?.quantity ?? 0) : qty;
        validateVariant(
          productRows.find((p) => p.id === variant?.productId),
          variant,
          next,
        );
        if (existing)
          await tx
            .update(cartItems)
            .set({ quantity: next, updatedAt: new Date() })
            .where(eq(cartItems.id, existing.id));
        else
          await tx
            .insert(cartItems)
            .values({ cartId: cart.id, variantId, quantity: next });
      }
      await touchCart(tx, cart.id);
    });
  }
  async function count(customerId: string) {
    const [row] = await db
      .select({
        count: sql<string>`coalesce(sum(${cartItems.quantity}::numeric), 0)::text`,
      })
      .from(carts)
      .innerJoin(cartItems, eq(carts.id, cartItems.cartId))
      .where(eq(carts.customerId, customerId));
    return row?.count ?? '0';
  }
  return { get, mutate, count };
}
