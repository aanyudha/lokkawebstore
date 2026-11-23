# orders

Canonical webstore order intent, separate from completed sales, payments and
fulfillment. `createSalesService.completeSale` completes cash payment, deducts
stock, creates inventory movements and posts income together. Reusing that POS
lifecycle for unpaid orders would create false revenue and stock deductions.
E1 therefore adds dedicated `orders` and `order_items` tables.

Webstore checkout creates `PENDING_PAYMENT` orders and permits `CANCELLED`
from that state. `COMPLETED` is reserved for a later completion contract.
Cancellation retains order and item history and updates
`updated_at`. Order status never represents payment or fulfillment state.

Creation locks the customer cart, then products in ID order, then variants in ID
order (matching POS/catalog lock order). It rechecks active products/variants,
stock, latest price and bigint limits inside the transaction. A concurrent stock
writer is observed after its row lock releases. It snapshots canonical product
name, variant name, SKU, unit price, quantity, line total and direct unit cost.
No direct cost components means null/unknown; an explicit zero component means
known zero. Catalog edits never rewrite snapshots, and detail reads snapshots
without joining the live catalog. Product/variant references may become null
if catalog data is deleted; historical facts remain.

Order numbers use a separate atomic daily PostgreSQL upsert counter, formatted
`WEB-YYYYMMDD-NNNNNN` using Asia/Jakarta dates. Database uniqueness is the final
guard. The cart revision is a durable, globally unique order idempotency key.
Cart mutations rotate it. Checkout checks an existing customer-scoped order for
the token before checking the current cart revision, so concurrent clicks and
later retries return the same order even after the cart is reused. Stale review
forms are rejected. Creating the order, its items, clearing the cart and rotating
the revision commit atomically.

Pending orders do not reserve/deduct stock, create a sale/payment, or post any
financial transaction. Several unpaid orders may refer to the same available
stock: they are requests, not allocations. A later payment/completion phase must
implement reservation/expiry or revalidate stock again before accepting payment
and fulfillment. Current Cash Flow and Accounting Lite only consume their
existing ledger/completed-sales sources; pending orders cannot enter revenue.

Webstore orders use IDR. E2 stores delivery address and method snapshots,
integer shipment grams and unit item weights. Shipping is stored apart from
merchandise subtotal, and discounts remain zero. Historical E1 orders retain
their original totals and show shipping as uncalculated.
The service takes explicit customer scope and has no HTTP/session dependency;
future admin application services can use the schema and transaction helpers
with their own authorization. No Back Office Orders interface is added.

Customer list/detail routes: `/account/orders[/:orderNumber]` and
`/id/akun/pesanan[/:orderNumber]`; POST `/:orderNumber/cancel` cancels pending
orders. Every read/write applies the authenticated customer's ID server-side.

Migrations `0010_webstore_orders.sql` and `0012_webstore_checkout.sql` supply
the underlying cart, order and delivery tables and snapshots.
`node scripts/verify-isolated.mjs unit`, `production` or `browser` wraps verification in a
fresh migrated database and compares read-only fingerprints of every public
and Drizzle table in the owner database before/after. The browser suite creates
its own further disposable database. `focused` and `webbrowser` run the webstore
regression and checkout tests.
