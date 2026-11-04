# Phase E1 owner review

Review date: 2026-11-04 (Asia/Jakarta). No deployment or owner migration is part of this work.

1. **Starting HEAD:** `6a384bc67bf1fd90c7490493106282700ccbc9f8` on `main`.
   `git status` and `git status --short` confirmed a clean tree. After
   `git fetch origin --prune`, `origin/main` matched HEAD. No prohibited Git
   mutation command was used.
2. **Sales architecture audit:** `sales` supports POS/WEBSTORE/MARKETPLACE/MANUAL
   sources and pending/completed/cancelled/refunded statuses. The current
   completion service creates historical `sale_items`, a completed cash
   `sale_payments` record, inventory movements, a stock deduction and one posted
   sale-income `financial_transactions` record in one transaction. Accounting
   Lite recognizes completed POS/WEBSTORE sales; Cash Flow reads the posted
   ledger. Existing customer auth uses independent opaque DB sessions with
   hashed tokens and session-bound CSRF. Canonical variants own price/stock;
   direct product-cost components provide known POS cost snapshots.
3. **Architecture choice:** dedicated `orders`/`order_items`, with no E1 sale
   completion. The POS cash-completion lifecycle cannot represent unpaid intent
   without false inventory/finance effects. POS, finance and accounting service
   implementations are unchanged.
4. **Cart model:** `carts` has a unique customer ID, revision UUID and timestamps.
   `cart_items` stores cart ID, canonical variant ID, positive integer quantity
   and timestamps, with a unique cart/variant pair. One durable cart is reused
   after checkout; it contains no authoritative price or provider payload.
5. **Guest decision:** login-required. Guests browse freely, then sign in before
   adding. There is no guest-session cart or merge; the guest's attempted add is
   not persisted, and they add the item after signing in.
6. **Cart ownership:** cart lookup uses authenticated customer ID. Item update
   and removal additionally require the item's cart ID. Browser cart IDs never
   select a customer's cart.
7. **Variants:** distinct canonical variants are distinct lines. Repeated adds
   merge quantities. Multiple selectable variants and one-variant defaults are
   supported independently of media presence.
8. **Stock:** add/update reject invalid quantities, inactive/archived products,
   inactive variants and insufficient stock. Cart reads expose unavailable
   items. Checkout serializes on the cart and locks products before variants,
   ordered by ID, then validates current stock within the transaction.
9. **Price:** cart reads use current catalog prices. Checkout re-reads prices
   under locks, recomputes line/subtotals with bigint, and ignores browser price
   and total fields. The UI explains this behavior before order creation.
10. **Order model:** `orders` has unique number, customer, WEBSTORE source,
    lifecycle status, unique idempotency key, IDR currency, bigint subtotal,
    shipping amount, discount amount, grand total and timestamps. Shipping and
    discount remain zero in E1; schema checks enforce monetary consistency.
11. **Lifecycle:** creates PENDING_PAYMENT; cancellation transitions it to
    CANCELLED. COMPLETED is reserved for a later deliberate completion contract.
    No completion API or payment/fulfillment status is overloaded into orders.
12. **Numbers:** `WEB-YYYYMMDD-NNNNNN`, based on Asia/Jakarta date, with a dedicated
    PostgreSQL daily upsert counter and unique order-number constraint.
13. **Item snapshots:** nullable product/variant references plus product name,
    variant name, SKU, unit price, quantity, line total, cost and creation time.
    Unique order/variant and monetary/quantity checks prevent malformed lines.
14. **Historical guarantee:** order detail reads order-item snapshots without
    joining the live catalog. Tests change product/variant name, SKU, price and
    cost after creation and compare the entire historical detail unchanged.
    Nullable catalog references preserve snapshots if a referenced row is deleted.
15. **Cost:** sums current direct product costs under the same parent lock used
    by cost writers. No components means null/unknown; explicit zero remains
    known zero. Future catalog cost never rewrites historical order cost.
16. **Stock effects:** no reservation, deduction or movement on cart/order
    creation/cancellation. Multiple unpaid orders can reference the same stock;
    these are requests, not allocations. A future payment/completion phase must
    reserve/expire or revalidate stock before accepting payment/fulfillment.
17. **Finance effects:** no sale, payment or ledger write. Tests compare sales,
    payment, inventory and finance rows and full Cash Flow/Accounting reports
    before/after creation; no revenue or income appears.
18. **Idempotency:** a cart revision becomes a unique order idempotency key.
    Every cart mutation rotates it. Checkout first returns a prior order for the
    same customer/token, including retries after cart reuse; otherwise stale
    revisions fail. Order/items insertion and cart clear/rotation are atomic.
19. **Cancellation:** conditional customer-scoped PENDING_PAYMENT update, with
    explicit updated_at. Repeated cancellation is safe. Order/items remain in
    history; no inventory or finance compensation is needed.
20. **Cart UI:** header quantity count; empty state; product/variant/SKU, unit
    price, quantity, line total, subtotal; update/remove/continue/review actions.
    Unavailable lines remain visible/removable and block order creation.
21. **Product UI:** canonical variant selection, quantity and Add to cart.
    Stockless selections disable submission with JavaScript; fully stockless
    products render a disabled button. Server validation protects all requests,
    including JavaScript-disabled clients. Missing media does not block adding.
    Keyboard variant focus is visible.
22. **Order UI:** customer list/detail and pending cancellation. Displays
    historical items/totals, date, number, status and factual unconfigured payment
    and shipping text. No Back Office Orders interface was introduced.
23. **Locales:** EN `/cart`, `/account/orders`; ID `/id/keranjang`,
    `/id/akun/pesanan`. Review/create/item/cancel routes follow those prefixes.
    EN/ID labels and language switching preserve the current cart/order page.
    Business data is shared; historical names follow canonical POS-style facts.
    Existing category navigation and customer name presentation are retained.
24. **Security:** active customer DB session, session-bound CSRF cookie/form
    tokens, global origin validation and server ownership predicates. Real valid
    admin/POS sessions, revoked customer sessions, foreign item/order/revision
    access and forged tokens/origins are tested. Personalized HTML is private,
    no-store; cart/order pages are noindex, nofollow and absent from the sitemap.
25. **Automated totals:** PASS, 313 tests in 20 Vitest files, including 32 E1
    integration tests. PASS, 8 production tests. The initial default parallel
    Vitest attempt had one customer timeout and three cleanup-hook timeouts;
    the complete rerun with `npm test -- --maxWorkers=1` passed. The isolated
    verification wrapper uses that one-worker setting for reliable local runs.
26. **Playwright run 1:** PASS, all 18 tests in 14 files (4.3 minutes), with no
    skipped tests. An earlier diagnostic full run passed 17/18: its existing
    localhost origin test raced a lazy preview against its own image deletion.
    The test now waits for previews to load before deletion; no response errors
    are ignored and no production media behavior was changed.
27. **Playwright run 2:** PASS, all 18 tests in 14 files (4.3 minutes), with no
    skipped tests. Both acceptance runs include the full POS, inventory,
    finance/accounting, media, origin, customer, navigation and E1 workflows.
    The E1 flow asserts no pageerror or unexpected 4xx/5xx response.
28. **Owner isolation:** every database-backed verification runs through
    `scripts/verify-isolated.mjs`, substituting fresh migrated database URLs for
    test subprocesses. Fixture helpers and browser/production setup create
    further disposable databases. Read-only repeatable-read fingerprints of all
    27 owner public/Drizzle tables are compared before/after; completed runs
    report PASS. Owner migration and permanent owner QA orders were not created.
    Demo Shirt QA is synthetic disposable data. User-managed runtimes were not
    restarted or stopped. Production port 3000 was unavailable; all 8 production
    tests passed using the supported `PRODUCTION_TEST_PORT=3054` override.
29. **POS regression:** PASS, unit/integration suite and both full browser runs,
    including bigint arithmetic, single/multiple items and failure retry.
30. **Finance/accounting regression:** unit/integration suite and production
    routes passed; both full browser runs passed Cash Flow, Income & Expense,
    Accounting Lite and commercial administration checks.
31. **Build:** PASS, including the final production build after both browser runs.
    Formatting, lint and strict TypeScript checks passed.
32. **Changed/new files:** listed below. Migration adds five tables and one enum;
    no existing sales/payment/finance schema is changed. No dependencies added.
    Official logo and owner concept files are untouched.
33. **git diff --check:** PASS, including the final report and all source changes.
34. **Git status:** main, with unstaged modified/new E1 files. HEAD is unchanged.
    Nothing staged, committed or pushed.
35. **Recommended commit:** `feat: add webstore cart and order foundation`.
    This command has not been executed. Payment integration, shipping provider,
    Tax Readiness, refunds, marketplace and Back Office Orders remain out of scope.

## Changed/new files

- `README.md`
- `docs/architecture.md`
- `docs/phase-e1-review.md`
- `drizzle/0010_webstore_orders.sql`
- `drizzle/meta/_journal.json`
- `scripts/verify-isolated.mjs`
- `src/app.ts`
- `src/db/schema/index.ts`
- `src/i18n/resources/en.json`
- `src/i18n/resources/id.json`
- `src/modules/cart/README.md`
- `src/modules/cart/routes.ts`
- `src/modules/cart/service.ts`
- `src/modules/customer/routes.ts`
- `src/modules/customer/validation.ts`
- `src/modules/orders/README.md`
- `src/modules/orders/service.ts`
- `src/modules/storefront/navigation.ts`
- `tests/browser/webstore.spec.ts`
- `tests/browser/origin-actions.spec.ts`
- `tests/webstore.test.ts`
- `views/account/home.ejs`
- `views/cart/cart.ejs`
- `views/cart/order.ejs`
- `views/cart/orders.ejs`
- `views/pages/product.ejs`
- `views/partials/header.ejs`
- `web/client/main.ts`
- `web/client/styles/components.css`

## Reproduction

```powershell
npm.cmd run format:check
npm.cmd run lint
npm.cmd run typecheck
node scripts/verify-isolated.mjs unit
npm.cmd run build
$env:PRODUCTION_TEST_PORT='3054'
node scripts/verify-isolated.mjs production
npx.cmd playwright test --list
node scripts/verify-isolated.mjs browser
node scripts/verify-isolated.mjs browser
npm.cmd run build
git diff --check
git status --short
```

The wrapper invokes the requested npm suites internally with disposable DB
environment variables. It never prints credentials or owner row contents.
Apply the new migration before an owner-approved runtime upgrade. Owner DB
migration and live payment/shipping acceptance were not performed in E1.
