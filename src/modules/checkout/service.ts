import { createHash } from 'node:crypto';
import type { Database } from '../../db/client.js';
import {
  createCartService,
  validateVariant,
  type Transaction,
} from '../cart/service.js';
import { FormError, id, type Form } from '../catalog/validation.js';
import {
  addressSnapshot,
  createCustomerAddresses,
} from '../customer/addresses.js';
import { MAX_RUPIAH } from '../finance/calculations.js';
import { createOrderService } from '../orders/service.js';
import { createShippingMethods } from '../shipping/methods.js';
import {
  createShippingRateService,
  type ShippingRate,
} from '../shipping/rates.js';

type OrderService = ReturnType<typeof createOrderService>;
type QuoteItems = Parameters<Parameters<OrderService['create']>[2]>[1];

export class ShippingSelectionChanged extends FormError {
  constructor(public rates: ShippingRate[]) {
    super('shipping', 'shop.error.shipping');
  }
}

function addressId(value: unknown) {
  try {
    return id(value);
  } catch (cause) {
    if (!(cause instanceof FormError)) throw cause;
    throw new FormError('address', 'shop.error.address');
  }
}

export function createCheckout(
  db: Database['db'],
  rateService = createShippingRateService([]),
) {
  const cart = createCartService(db);
  const addresses = createCustomerAddresses(db);
  const shipping = createShippingMethods(db);
  const orders = createOrderService(db);

  async function offers(
    connection: Database['db'] | Transaction,
    customerId: string,
    selection: Form,
    items: QuoteItems,
    subtotal: bigint,
    lock = false,
  ) {
    const address = await createCustomerAddresses(connection).selected(
      customerId,
      addressId(selection.addressId),
      lock,
    );
    if (!address) throw new FormError('address', 'shop.error.address');
    const methods = createShippingMethods(connection);
    const origin = await methods.origin(lock);

    const weightGrams = items.reduce(
      (sum, item) => sum + BigInt(item.unitWeightGrams) * BigInt(item.quantity),
      0n,
    );
    if (weightGrams <= 0n || weightGrams > MAX_RUPIAH)
      throw new FormError('cart', 'shop.error.total');

    const manual = async () =>
      (await methods.list(true, lock)).map((method): ShippingRate => ({
        id: method.id,
        quoteSource: 'MANUAL',
        courierCode: null,
        courierName: null,
        serviceCode: method.code,
        serviceName: method.name,
        etaText: method.description,
        amountRupiah: method.amountRupiah,
      }));
    // Keep a selected, active staff-configured rate usable when J&T recovers.
    const manualRates = selection.methodId ? await manual() : null;
    const selectedManual = manualRates?.find(
      (rate) => rate.id === selection.methodId,
    );
    const live =
      !selectedManual && rateService.enabled && origin
        ? await rateService.rates({ origin, destination: address, weightGrams })
        : [];
    const rates = live.length ? live : (manualRates ?? (await manual()));
    if (!rates.length) throw new FormError('shipping', 'shop.error.noShipping');

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
    const shippingAddressSnapshot = addressSnapshot(address);
    return {
      quotes: rates.map((rate) => {
        const facts = {
          shippingAddressSnapshot,
          shippingMethodSnapshot: {
            code: rate.serviceCode,
            name: rate.serviceName,
            description: rate.etaText,
            quoteSource: rate.quoteSource,
            courierCode: rate.courierCode,
            courierName: rate.courierName,
            serviceCode: rate.serviceCode,
            serviceName: rate.serviceName,
            etaText: rate.etaText,
          },
          shipmentWeightGrams: weightGrams,
          shippingAmount: rate.amountRupiah,
          discountAmount: 0n,
          grandTotal: subtotal + rate.amountRupiah,
        };
        // Compare the displayed price and shipment facts against server data at placement.
        const token = createHash('sha256')
          .update(
            JSON.stringify([
              address.id,
              shippingAddressSnapshot,
              origin?.id ?? null,
              origin?.updatedAt.toISOString() ?? null,
              rate.id,
              facts.shippingMethodSnapshot,
              rate.amountRupiah.toString(),
              reviewed,
            ]),
          )
          .digest('hex');
        return { rate, facts, token };
      }),
    };
  }
  function selected(
    result: Awaited<ReturnType<typeof offers>>,
    selection: Form,
  ) {
    const quote = result.quotes.find(
      ({ rate }) => rate.id === selection.methodId,
    );
    if (!quote)
      throw new ShippingSelectionChanged(result.quotes.map(({ rate }) => rate));
    if (quote.facts.grandTotal > MAX_RUPIAH)
      throw new FormError('cart', 'shop.error.total');
    return quote;
  }
  async function reviewOffers(customerId: string, selection: Form) {
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
      state,
      result: await offers(db, customerId, selection, items, state.subtotal),
    };
  }

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
        methods,
        rateLookup: Boolean(origin && rateService.enabled),
      };
    },
    async rates(customerId: string, selection: Form) {
      const { result } = await reviewOffers(customerId, selection);
      return { rates: result.quotes.map(({ rate }) => rate) };
    },
    async review(customerId: string, selection: Form) {
      const { state, result } = await reviewOffers(customerId, selection);
      return {
        ...state,
        ...selected(result, selection),
      };
    },
    async place(customerId: string, selection: Form) {
      return orders.create(
        customerId,
        id(selection.revision, 'revision'),
        async (tx, items, subtotal) => {
          const result = await offers(
            tx,
            customerId,
            selection,
            items,
            subtotal,
            true,
          );
          const { facts, token } = selected(result, selection);
          if (token !== selection.quote)
            throw new FormError('checkout', 'shop.error.reviewChanged');
          return facts;
        },
      );
    },
  };
}
