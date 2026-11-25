# Shipping and manual fulfillment

`service.ts` owns provider-independent LOKKA origins and resolves product/variant/quantity into actual price (decimal string), unit grams, available stock and default origin. No address is seeded and no stock is reserved. The admin settings route uses existing DB sessions and CSRF protection.

`rates.ts` collects options from `ShippingRateProvider` implementations and
sorts them by whole-Rupiah price. `JntRateProvider` uses the official [J&T
Tariff Checking contract](https://developer.jet.co.id/documentation). It sends
only mapped origin and destination codes, total package weight expressed in
decimal kilograms, the merchant name and product `EZ`.

Set `SHIPPING_RATE_PROVIDER=jnt` to opt in. Obtain the HTTPS `JNT_TARIFF_URL`,
`JNT_TARIFF_CUSTOMER_NAME` and `JNT_TARIFF_KEY` from the merchant dashboard.
Configure `JNT_TARIFF_ORIGIN_CODES` and `JNT_TARIFF_DESTINATION_CODES` as JSON
objects using the mapping agreed with J&T. Keys are case-insensitive and
whitespace is normalized. Values use the assigned uppercase J&T codes.

```text
JNT_TARIFF_ORIGIN_CODES={"Province|City":"ORIGIN_CODE"}
JNT_TARIFF_DESTINATION_CODES={"Province|City|District|PostalCode":"DISTRICT_CODE"}
```

The active default LOKKA origin is required in both modes. When the location
is unmapped, a tariff request fails or no usable service is returned, checkout
offers the active flat rates configured in **Settings → Fulfillment** and
identifies them as LOKKA rates. Checkout blocks if that list is empty.
`SHIPPING_RATE_PROVIDER=disabled` uses those configured rates directly.

In **Sales → Shipments**, staff use the recent paid queue or exact order-number
lookup. The courier, service and tracking number describe the physical shipment.
Marking an order shipped finalizes the optional actual cost. A positive amount
posts one `SHIPPING_EXPENSE` under the existing `TRANSPORT` operating expense
category in `financial_transactions`. Blank preserves an unrecorded cost and
zero records a zero-cost shipment. Tracking corrections record both numbers,
the staff identity and timestamp. Staff mark delivery when confirmed manually.
See the [checkout contract](../checkout/README.md) for the historical quote.
