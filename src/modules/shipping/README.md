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

J&T lookup requires an active default LOKKA origin. Active flat rates in
**Settings → Fulfillment** are available independently of the origin. Checkout
uses them directly when J&T is disabled or its configuration is incomplete, and
falls back to them when lookup yields no usable tariff. If both sources are
unavailable, checkout asks the customer to contact LOKKA or use another
address. Settings shows the configured provider, origin and active flat-rate
count. J&T diagnostics record a reason code without address or credential data.

In **Sales → Shipments**, staff use the recent paid queue or exact order-number
lookup. The courier, service and tracking number describe the physical shipment.
Marking an order shipped finalizes the optional actual cost. A positive amount
posts one `SHIPPING_EXPENSE` under the existing `TRANSPORT` operating expense
category in `financial_transactions`. Blank preserves an unrecorded cost and
zero records a zero-cost shipment. Tracking corrections record both numbers,
the staff identity and timestamp. Staff mark delivery when confirmed manually.
See the [checkout contract](../checkout/README.md) for the historical quote.
