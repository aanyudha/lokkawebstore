# Webstore checkout

The customer opens `/cart/review` or `/id/keranjang/review`, saves or selects an
Indonesian delivery address, selects a shipping method, and reviews the order
before placing it. Address writes use the existing customer session and CSRF
protection. Checkout and order pages are private and excluded from indexing.

Cart owns availability and revision. Customer owns saved addresses and
ownership checks. With J&T rates enabled, customers select a saved address,
request tariff options, choose a service, and confirm the price at review.
J&T requires an active default LOKKA origin. Checkout can fall back to active
flat rates from **Settings → Fulfillment** even before an origin is configured.
New and edited addresses require a district (kecamatan). Existing addresses
without a district remain selectable for flat-rate checkout. Kelurahan remains
optional. A zero flat rate must be configured explicitly.

Orders locks the cart, products and variants using the existing lock order.
Checkout reads the selected customer address and origin under shared row locks,
recalculates the weight from validated item facts, and revalidates the selected
tariff or flat rate. A review token detects changes to the address, shipping
option, prices, quantities or weights. Customers review changed facts before
placing their order.

New orders snapshot the address, quoted courier and service, source, optional
ETA text, shipping charge, item unit weights and aggregate shipment grams.
Generic flat-rate methods have no quoted courier. Staff fulfillment records
the actual courier and cost separately. Money uses bigint whole rupiah. The
grand total is merchandise subtotal + shipping charge − discount. Discount is
zero in this phase.
Existing E1 orders retain their original display and totals.

A successful submission consumes the cart revision and creates one
`PENDING_PAYMENT` order. Retries using the same customer and revision return
that order. Pending orders leave stock, inventory movements, completed sales,
Cash Flow and Accounting Lite untouched.

Migration `0013_webstore_checkout.sql` adds `customer_addresses`,
`shipping_methods` and delivery fields on orders and items. Verification uses
disposable databases through `node scripts/verify-isolated.mjs unit` and
`node scripts/verify-isolated.mjs webbrowser`.
