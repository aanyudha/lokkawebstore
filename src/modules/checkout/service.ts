import { createHash } from 'node:crypto';
import type { Database } from '../../db/client.js';
import { createCartService, validateVariant } from '../cart/service.js';
import { FormError, id, type Form } from '../catalog/validation.js';
import {
  addressSnapshot,
  createCustomerAddresses,
} from '../customer/addresses.js';
import { MAX_RUPIAH } from '../finance/calculations.js';
import { createOrderService } from '../orders/service.js';
import { createShippingMethods } from '../shipping/methods.js';

type OrderService = ReturnType<typeof createOrderService>;
type QuoteItems = Parameters<Parameters<OrderService['create']>[2]>[1];

function selectionId(value: unknown, error: string) {
  try {
    return id(value);
  } catch (cause) {
    if (!(cause instanceof FormError)) throw cause;
    throw new FormError('delivery', error);
  }
}

async function delivery(
  db: Pick<Database['db'], 'select' | 'insert' | 'update' | 'transaction'>,
  customerId: string,
  selection: Form,
  items: QuoteItems,
  subtotal: bigint,
  lock = false,
) {
  const addresses = createCustomerAddresses(db);
  const methods = createShippingMethods(db);
  const address = await addresses.selected(
    customerId,
    selectionId(selection.addressId, 'shop.error.address'),
    lock,
  );
  if (!address) throw new FormError('address', 'shop.error.address');
  const origin = await methods.origin(lock);
  if (!origin) throw new FormError('shipping', 'shop.error.noShipping');
  const method = await methods.selected(
    selectionId(selection.methodId, 'shop.error.shipping'),
    lock,
  );
  if (!method) throw new FormError('shipping', 'shop.error.shipping');

  const shipmentWeightGrams = items.reduce(
    (sum, item) => sum + BigInt(item.unitWeightGrams) * BigInt(item.quantity),
    0n,
  );
  const grandTotal = subtotal + method.amountRupiah;
  if (
    shipmentWeightGrams <= 0n ||
    shipmentWeightGrams > MAX_RUPIAH ||
    grandTotal > MAX_RUPIAH
  )
    throw new FormError('cart', 'shop.error.total');
  const facts = {
    shippingAddressSnapshot: addressSnapshot(address),
    shippingMethodSnapshot: {
      code: method.code,
      name: method.name,
      description: method.description,
    },
    shipmentWeightGrams,
    shippingAmount: method.amountRupiah,
    discountAmount: 0n,
    grandTotal,
  };
  // The quote is a change detector. Every fact is read again before order creation.
  const reviewed = items
    .map((item) => [
      item.variantId,
      item.quantity,
      item.unitWeightGrams,
      item.unitPriceSnapshot.toString(),
      item.productNameSnapshot,
      item.variantNameSnapshot,
      item.skuSnapshot,
    ])
    .sort(([left], [right]) => String(left).localeCompare(String(right)));
  const token = createHash('sha256')
    .update(
      JSON.stringify([
        address.id,
        facts.shippingAddressSnapshot,
        origin.id,
        origin.updatedAt.toISOString(),
        method.id,
        facts.shippingMethodSnapshot,
        facts.shippingAmount.toString(),
        reviewed,
      ]),
    )
    .digest('hex');
  return { facts, token };
}

export function createCheckout(db: Database['db']) {
  const cart = createCartService(db);
  const addresses = createCustomerAddresses(db);
  const shipping = createShippingMethods(db);
  const orders = createOrderService(db);

  return {
    async options(customerId: string) {
      const [state, ownedAddresses, methods, origin] = await Promise.all([
        cart.get(customerId),
        addresses.list(customerId),
        shipping.list(true),
        shipping.origin(),
      ]);
      return {
        ...state,
        addresses: ownedAddresses,
        methods: origin ? methods : [],
      };
    },
    async review(customerId: string, selection: Form) {
      const state = await cart.get(customerId);
      if (!state.items.length) throw new FormError('cart', 'shop.error.empty');
      for (const { product, variant, item } of state.items)
        validateVariant(product, variant, item.quantity);
      const items = state.items.map(({ item, product, variant }) => ({
        variantId: variant.id,
        quantity: item.quantity,
        unitWeightGrams: variant.weightGrams,
        unitPriceSnapshot: variant.price,
        productNameSnapshot: product.name,
        variantNameSnapshot: variant.name,
        skuSnapshot: variant.sku,
      }));
      return {
        ...state,
        ...(await delivery(db, customerId, selection, items, state.subtotal)),
      };
    },
    async place(customerId: string, selection: Form) {
      return orders.create(
        customerId,
        id(selection.revision, 'revision'),
        async (tx, items, subtotal) => {
          const { facts, token } = await delivery(
            tx,
            customerId,
            selection,
            items,
            subtotal,
            true,
          );
          if (token !== selection.quote)
            throw new FormError('checkout', 'shop.error.reviewChanged');
          return facts;
        },
      );
    },
  };
}
