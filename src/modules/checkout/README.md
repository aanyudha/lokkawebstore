# Webstore checkout

The customer opens `/cart/review` or `/id/keranjang/review`, saves or selects an
Indonesian delivery address, selects a shipping method, and reviews the order
before placing it. Address writes use the existing customer session and CSRF
protection. Checkout and order pages are private and excluded from indexing.

Cart owns availability and revision. Customer owns saved addresses and
ownership checks. Shipping supplies active flat rates from **Settings →
Fulfillment**. The owner configures an active default LOKKA origin and at
least one active method. Method codes stay stable when editing a rate. A zero
flat rate must be configured explicitly.

Orders locks the cart, products and variants using the existing lock order.
Checkout reads the selected customer address, origin and method under shared
row locks and recalculates delivery facts. A review token detects changes to
the address, configuration, prices, quantities or weights. Customers review
changed facts before placing their order.

New orders snapshot the address, method, item unit weights and aggregate
shipment grams. Money uses bigint whole rupiah. The grand total is merchandise
subtotal + shipping charge − discount. Discount is zero in this phase.
Existing E1 orders retain their original display and totals.

A successful submission consumes the cart revision and creates one
`PENDING_PAYMENT` order. Retries using the same customer and revision return
that order. Pending orders leave stock, inventory movements, completed sales,
Cash Flow and Accounting Lite untouched.

Migration `0013_webstore_checkout.sql` adds `customer_addresses`,
`shipping_methods` and delivery fields on orders and items. Verification uses
disposable databases through `node scripts/verify-isolated.mjs unit` and
`node scripts/verify-isolated.mjs webbrowser`.
