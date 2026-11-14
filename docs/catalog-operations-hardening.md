# Product / inventory / sellability hardening

Starting HEAD: `5038c1a6fac5e03cd05b0a985d730886180de5a9`.
The starting working tree was clean. This change follows the owner's approved
channel-specific operational rules. It does not activate the imported catalog.

## Audit: original coupling

- Products already owned product/variant creation, SKU, price, HPP, category,
  media and status. Variants are FK-backed children; Inventory did not create
  master entities and continues not to do so.
- Inventory edited only quantity and stock-known state through the owned catalog
  service, with correction movements for factual confirmations/changes.
- Weight is a non-null nonnegative integer in PostgreSQL, using zero for an
  unconfirmed/unset value. The editor exposed it, but generic active-variant
  validation required positive weight. Product activation and the last-active-
  variant guard also required weight, coupling operational activation to shipping.
- POS queries/completion already did not directly require weight. The generic
  activation coupling prevented official activation of no-weight inventory.
- Storefront displayed active catalog and used stock for its purchase control;
  cart/order validation checked status/stock but did not require weight. Thus
  removing the activation coupling required explicit online readiness protection.
- Products, Inventory, Fixed Assets and Media lists were unbounded. Manual finance
  history was capped at 100 and automated context at 20; POS History at 100, without
  navigable pagination. Cash Flow and Accounting Lite contributing lists were
  already bounded and explicitly label their limits; financial aggregate queries
  are separate from those presentation tables.

## Final master and channel contracts

Products remains the sole master-data editor. Inventory uses only existing owned
variant IDs and changes stock-known/quantity. Extra product/price/HPP/category/
weight fields in a stock request never become master writes. Product/variant
creation remains in Products. Existing archived products/variants and all
historical snapshots are retained.

Weight (gram) is visibly labeled optional. Blank/null is allowed. Positive integer
weights are accepted; negative/fractional/unit-bearing/boolean/array values are
rejected. The existing zero placeholder is accepted for legacy callers and renders
blank in the editor. No schema migration or historical weight backfill is needed.

`sellability.ts` is the shared domain contract:

- `isOperationalVariant` requires active status, valid SKU and positive price.
- `canSellInPos` requires active product and operational variant, confirmed stock,
  and enough positive stock for the requested positive integer quantity. It has
  no shipping weight, method, origin or Webstore-publication dependency.
- `canSellInWebstore` additionally requires canonical product name/slug and a
  confirmed positive integer shipping weight. Category and media remain optional
  under the existing catalog contract.
- `readinessBadges` derives POS Ready/Incomplete, Webstore Ready/Incomplete,
  Stock Unknown, Out of Stock and Weight Missing as applicable. Product status
  separately distinguishes active, draft and archived. Inventory also shows
  parent product context; these indicators are not a new persisted workflow.

Generic activation requires usable active variants and valid master fields,
without forcing shipping weight. Draft deactivation retains variants. Active
no-weight products may appear editorially online, with purchase disabled until
Webstore readiness passes. The same helper protects cart mutations/availability,
order creation under locks, fulfillment readiness and direct WEBSTORE sale
completion. POS API emits its own derived readiness for the browser. Storefront
SSR/data attributes, JavaScript purchase controls and structured offers follow
Webstore readiness. No payment or shipping integration was started.

Unknown stock stays unavailable in both channels, never factual zero. Confirmed
zero remains known and out of stock. Neither channel can sell either state.

## Bulk operations and security

Products offers explicit selection, select-all for the current page, Activate
selected for operations, Deactivate selected (Draft), and Archive selected.
Activation enables eligible variants on explicitly selected products: known,
positive stock, valid SKU and positive price. Shipping weight is not required.
Other variants are unchanged and their count is disclosed; no eligible variant
means a factual failure reason. Archived rows are skipped, never automatically
restored. Existing requested status is skipped. Archive is a status change, never
a delete, including for historically referenced products.

Inventory keeps each individual Save form and adds explicit Save Selected values.
JavaScript copies only the selected rows' current stock fields into the bulk POST;
without JavaScript individual Save remains available. Mark selected stock unknown
is allowed for zero/unknown rows, but cannot discard a positive recorded count.
This restriction applies to both bulk actions; positive counts require deliberate
individual review/correction first. Missing per-row inputs and invalid counts fail
without overwriting the row. Values never reload from the owner import workbook.

Both services validate 1–50 distinct UUIDs, ownership and all action/data fields.
All routes are under existing active DB admin sessions, CSRF and central origin
checks; mutations are POST-only. Product locks precede variant locks, in sorted
order compatible with sale/stock/cost writers. Product actions use per-row savepoints
inside the enclosing transaction: a failed parent activation rolls back its variant
changes. Unexpected database errors roll back the request; expected row validation
failures are reported while valid rows succeed. Inventory rechecks locked state
and uses the canonical stock service. UI displays updated/skipped/failed counts
and per-row text reasons, with no color-only errors or hidden partial failures.

Stock changes create real CORRECTION / MANUAL movements for the quantity delta or
an explicit previously-unknown confirmation, with a bulk owner correction note.
An unchanged row is skipped. Marking a zero row unknown changes only the state;
no fictitious numeric movement is inserted. Historical sale/payment/ledger rows
and snapshot costs are never rewritten by either bulk operation.

## Search and pagination

All search is server-side, trimmed and case-insensitive, with parameterized literal
substring matching (percent, underscore and backslash are escaped). A shared
search/clear/empty-result/pagination pattern is used. Changing the search resets
the page. Next/previous links preserve the query and Inventory stock filter.
No full catalog is shipped to the browser for filtering; dashboard cards now use
SQL counts instead of loading the complete catalog.

| Page             | Search fields                                                         | Pagination                                                            |
| ---------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Products         | Product name, variant SKU/name, category name                         | 25 products                                                           |
| Inventory        | Product name, SKU, variant name; optional unknown/out/in filter       | 25 variants                                                           |
| Fixed Assets     | Asset name, unit, status                                              | 25 assets                                                             |
| Income & Expense | Description, transaction reference/UUID, enum or human category label | 25 ledger entries shared across manual and read-only automatic tables |
| POS History      | Transaction number                                                    | 25 sales                                                              |
| Media            | Same product/SKU/variant/category search as Products                  | 25 products and their related images                                  |

Fixed Assets' active acquisition total always covers the entire register, not the
filtered page. Investor asset valuation, Cash Flow and Accounting Lite formulas
are unchanged. Search applies to navigation lists, never silently to summary
cards or financial totals. Cash Flow's 200-row and Accounting Lite's 100/200-row
contributing lists retain their stated bounds and period navigation; they do not
get arbitrary client-side searches. The growing manual/POS histories now have
server-side search and pagination for transaction navigation.

## Verification

Both full browser runs and the owner isolation comparison are complete.
All synthetic fixtures use migrated disposable PostgreSQL. No test loads or writes
the owner workbook/catalog, and no automatic activation is applied to the 34 owner
products. Owner business-table fingerprints were captured before verification
outside the repository for the final isolation comparison.

Recommended commit message, not executed:
`fix: separate POS and webstore sellability and improve catalog operations`.

### Completed verification — 2026-11-15 WIB

- Format, lint and strict typecheck passed. `npm test` passed 341/341 tests in
  22 files. Eleven new integration tests cover selected activation/deactivation/
  archive, row rollback, no-weight POS sale, missing-weight online cart/order and
  direct completion rejection, confirmed-weight readiness, unknown/zero,
  stock movement auditability, search/pagination, master ownership and security.
  Existing weight tests now assert optional unset weights and reject invalid types.
- Production verification passed 8/8 tests against a migrated disposable database.
- Playwright discovery lists 20 tests in 16 files. Browser run #1 passed 20/20
  in 3.6 minutes; independent full run #2 passed 20/20 in 3.6 minutes.
- The new browser flow searches Products, activates selected known-stock products,
  saves blank Weight, verifies POS Ready / Webstore Incomplete, confirms stock via
  Save Selected, completes a real synthetic POS sale without weight, proves the
  storefront purchase control is disabled, confirms 300g and observes online
  readiness. It also exercises Fixed Asset, Income & Expense and POS History
  searches, responsive overflow and no page errors/unexpected 4xx/5xx responses.
- The existing investor browser now searches its SKU in the paginated Inventory
  list before editing that fixture. Its report, print and stock-zero checks pass.
- Browser processes use HOST=0.0.0.0 only for test loopback/LAN compatibility; no
  environment file is changed. All business fixtures are synthetic in migrated
  disposable databases. No owner product was used for a live sale or QA mutation.
- All 16 owner business-table fingerprints exactly match before/after verification:
  catalog, variants, translations/media/categories, costs, assets/import ledger,
  sales/items/payments, movements, finance ledger and orders/items. Fingerprints
  are outside the repository at `C:/Users/aan/.codex/lokka-backups/operations-before-tests.json`
  and `operations-after-tests.json`.
- All 34 imported owner products remain draft with inactive variants: 28 known-
  stock rows totaling 149 pcs and six unknown rows. Recorded weights are unchanged,
  including pre-existing confirmed values.
  No product was automatically activated, archived again, reimported or reset.
  No database migration is required by this change.
- Build and `git diff --check` pass. The local compiled application is refreshed
  for owner review with its existing configuration; no owner login/session or
  controlled owner product mutation is required for this read-only QA.
- Official logo and concept sources are unchanged. No dependencies, payment/
  shipping adapters, tax work or new catalog workflow engine were introduced.
  No `npm audit fix`, staging, commit or push was performed.

### Changed/new files

- `src/modules/admin/finance-routes.ts`
- `src/modules/admin/investor-routes.ts`
- `src/modules/admin/routes.ts`
- `src/modules/cart/service.ts`
- `src/modules/catalog/routes.ts`
- `src/modules/catalog/service.ts`
- `src/modules/catalog/validation.ts`
- `src/modules/finance/fixed-assets.ts`
- `src/modules/finance/ledger.ts`
- `src/modules/pos/routes.ts`
- `src/modules/sales/service.ts`
- `src/modules/shipping/service.ts`
- `tests/browser/investor-reporting.spec.ts`
- `tests/commercial-calculations.test.ts`
- `views/admin/fixed-assets.ejs`
- `views/admin/income-expense.ejs`
- `views/admin/inventory.ejs`
- `views/admin/media.ejs`
- `views/admin/product-form.ejs`
- `views/admin/products.ejs`
- `views/pages/product.ejs`
- `views/partials/variant-form.ejs`
- `views/pos/history.ejs`
- `web/client/admin.ts`
- `web/client/main.ts`
- `web/client/pos.ts`
- `web/client/styles/admin.css`
- `docs/catalog-operations-hardening.md`
- `src/modules/catalog/listing.ts`
- `src/modules/catalog/operations.ts`
- `src/modules/catalog/sellability.ts`
- `tests/browser/catalog-operations.spec.ts`
- `tests/catalog-operations.test.ts`
- `views/partials/admin/bulk-result.ejs`
- `views/partials/admin/list-pagination.ejs`
- `views/partials/admin/list-search.ejs`
