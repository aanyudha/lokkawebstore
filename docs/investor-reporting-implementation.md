# Investor reporting implementation

The approved preflight remains in `investor-reporting-preflight.md`. This document
records its implementation; it does not replace the approved domain decisions.
Starting HEAD: `4665cd264fc7c0b57941e7c8fe2d737e9a708994`.

## Operational model

Migration `0011_investor_reporting.sql` adds `stock_known NOT NULL DEFAULT true`
and nullable variant unit metadata. Existing quantities and timestamps are not
rewritten. Unknown quantities use the constrained zero placeholder; confirmed
zero remains a distinct known state. Inventory and variant forms display unknown
as blank and explicitly distinguish Known quantity / Unspecified quantity.
Legacy writes omitting the flag preserve it. Explicit confirmation records a
stock correction; unknown imports create no inventory movement. Stock writes use
product/variant locks and explicitly update timestamps.

POS search/completion, storefront selection/SEO, cart validation/display, order
creation and fulfillment readiness all respect the flag. Unknown stock is not
sellable. Source unit is stored on the variant. No duplicate inventory or HPP
model is introduced.

Fixed assets belong to LOKKA through `vendor_id`, carry `created_by` and timestamps,
and support name, positive integer quantity, unit, whole-Rupiah unit acquisition
cost, optional date/notes, and ACTIVE/DISPOSED status. Input is under Finance at
`/admin/finance/fixed-assets`, with add/edit/status changes. Disposed rows are
retained and excluded from active acquisition value. Existing active DB admin
sessions, CSRF/origin protection, owner checks and server validation apply.

## Import operations

`python scripts/prepare-owner-workbook.py INPUT.xlsx OUTPUT.json` produces a
controlled operational payload from XLSX ZIP/XML with decimal-string money and
null stock. No additional dependency is needed. The payload is kept under ignored
`storage/owner-imports/`, separate from generic dev/test seed and outside source
control. The source workbook is not modified or required by CI.

`npm run owner:import -- --payload PATH --admin-id UUID` runs a read-only dry run.
Adding `--apply --backup-dir OUTSIDE_REPOSITORY` first captures a PostgreSQL custom
backup and verifies its restore catalog, saves history fingerprints outside the
repository, rechecks history, then executes the transaction-safe import. It
compares every pre-existing protected row after apply. The initial import also
reconciles every product and fixed asset against the source and import policy.

The 54 source entities are identified in `owner_imports` by workbook identity,
sheet and source row, with canonical ID, workbook/payload SHA-256 and admin
attribution. Exact replays skip existing entities, preserving live stock, price,
asset disposition and owner edits. Source changes and identifier conflicts are
rejected for explicit review. This phase does not provide an automatic changed-
source overwrite path. Partial imports are atomic; source identity is not an
editable product name or slug.

Product import uses the existing catalog and costing services inside the import
transaction. Each source row becomes a draft product, a Default inactive variant,
a clearly generated LOKKA-SYS-OWNER SKU, source unit/price and two direct cost
components: DIRECT_MATERIAL and DIRECT_LABOR. Explicit zero sewing cost is retained.
Their sum must equal source HPP. Shipping weight stays at the existing unpublished
zero placeholder because the workbook contains no weight. Publication rules are
unchanged. No source size/color or product photograph is invented.

The first two rows (Bross/Gelang) use Accessories; remaining rows use Ready to Wear,
as explicitly approved operational classification. Fallback EN/ID product names
retain source spelling/capitalization. Newly created categories get fallback
translations; existing category translations are preserved.

The three legacy seed products are rechecked using vendor ownership, exact slugs,
SKUs, development descriptions and translations. They are archived through the
catalog service. Variants, translations, media and every historical sale/payment/
ledger/movement record remain. No demo media is copied. No historical cost snapshot
is backfilled. Fixed asset source classification remains the owner's; acquisition
value does not generate an inferred historical cash expense.

## View-only reporting

Reports navigation contains `/admin/reports/assets` and
`/admin/reports/12-month-plan`. Both are EJS reports with semantic tables, basis
notes, WIB as-of/generated timestamp, existing official optimized LOKKA branding,
print button and A4 landscape print rules. The owner-supplied PNG is preserved
unchanged; no logo processing was added. Print hides admin chrome and controls.
Report articles contain no mutation forms.

Asset valuation includes nonarchived products, including draft/inactive source
inventory awaiting publication details. It excludes archived demo catalog.
Known units and retail require known stock. HPP requires known stock and cost.
Comparative potential gross value uses the same complete stock-and-cost cohort
for HPP and retail, avoiding an inflated spread when HPP is missing. Unknown rows
render unavailable and incomplete counts are disclosed. Active fixed assets are
quantity times acquisition cost. Combined recorded value adds inventory HPP to
active acquisition value, excluding retail. All money uses bigint; SQL aggregates
cast to numeric before multiplication/summing where needed. Disposed assets remain
visible. No depreciation or book-value inference exists.

The plan report contains all ten requested sections and uses existing Accounting
Lite and Cash Flow readers inside a repeatable-read, read-only snapshot. The
accounting reader was extracted without changing formulas. Manual income remains
cash-only. Historical missing HPP keeps COGS/profit unavailable. Legacy demo-linked
sales are disclosed, not relabeled as workbook-catalog trading. Actual/current
position, prospective indicators and insufficient evidence are distinct.

`reporting_coverage` stores documented month-level sales/expense completeness,
evidence, confirming admin and timestamps. This is the minimum durable evidence
needed for the approved projection gate; no forecasting input UI or fabricated
owner evidence is added. Consecutive documented sales-complete months immediately
preceding the current UTC month must cover at least 30 complete days, with complete
sale HPP and no itemless completed sales. The rate is actual total times 12 divided
by full months, truncated toward zero to whole Rupiah. Expenses/net additionally
require complete expense evidence for each included month. No owner coverage is
inferred from elapsed time; current legacy one-day history is suppressed.

Inventory opportunity is grounded in current stock and explicitly excludes
operating expenses, discounts, unsold risk, fees, tax, returns and shipping/payment
costs. It is not projected profit or guaranteed revenue. Existing POS, catalog,
ledger, Cash Flow, Accounting Lite, customer cart and unpaid orders are described
as implemented capabilities. Payment completion and shipping integrations remain
planned; no provider or tax-readiness work was started.

## Verification and owner reconciliation

Final verification and import results follow.
Automated fixtures are synthetic in fresh migrated `lokka_verify_*`,
`lokka_browser_*` and `lokka_production_*` PostgreSQL databases. Owner business-table
fingerprints are captured immediately before and after automated verification.
The owner import is a separate, explicitly authorized operational action.
No tests load the owner's original workbook at runtime.

### Completed owner operations — 2026-11-15 WIB

- All 13 captured owner catalog/history table fingerprints were identical before
  and after automated verification. No owner source rows were created by tests.
- A pre-migration PostgreSQL custom backup was captured outside the repository:
  `C:/Users/aan/.codex/lokka-backups/lokka-before-investor-migration-2026-11-15.dump`
  (102424 bytes); `pg_restore --list` verified the restore catalog. Migration
  0011 then applied successfully.
- Fresh owner dry run planned 54 source entity creations, six incomplete products
  and exactly three seed-identity-matched product archives. No source update or
  history deletion was planned.
- Apply captured a second restorable backup and per-row protected-history
  fingerprints at
  `C:/Users/aan/.codex/lokka-backups/lokka-owner-before-import-2026-11-14T19-17-41-734Z.dump`.
  The timestamp in the filename is UTC. The import used the existing active
  LOKKA Admin for attribution, in one serializable transaction.
- Created 34 draft products, 34 inactive Default variants, 68 material/labor cost
  components, 20 ACTIVE fixed assets and 54 import ledger entries. Source spelling,
  prices, quantities, units and every cost/asset row reconciled. No source image
  or shipping weight was invented. All imported weights remain unpublished zero
  placeholders. No active demo product remains.
- Source quantities: 28 known rows totaling 149 pcs, plus six unknown rows with
  technical zero placeholders. Unknown rows are binanti Top dobby, set arum,
  iris top, Top jangan polos, top panjang and top mis lace. All 34 units are pcs.
- Existing variants retain known=true, quantities Shirt 8 / Outer 5 / Dress 3 and
  their original update timestamps. Existing five sales, nine sale items, five
  payments, ten ledger rows, original nine inventory movements, translations
  and media all passed preservation comparison. Twenty-eight clearly noted
  owner import stock initialization movements were added for known source rows;
  no unknown-stock zero movement was inserted. Total movements are now 37.
- Post-apply exact replay dry run reported created 0 / updated 0 / skipped 54,
  six incomplete source rows and no further archives. Synthetic integration
  tests also apply replays after live edits and verify stock is not reset.

| Canonical owner DB valuation              | Recomputed value |
| ----------------------------------------- | ---------------: |
| Known inventory units                     |          149 pcs |
| Inventory HPP value                       |     Rp25.671.000 |
| Inventory retail value                    |     Rp76.805.000 |
| Potential gross value, complete cohort    |     Rp51.134.000 |
| Active fixed asset acquisition value      |     Rp24.195.000 |
| Combined recorded asset value             |     Rp49.866.000 |
| Incomplete stock rows / unknown-cost rows |            6 / 0 |

Actual/current plan metrics remain five completed legacy POS sales, revenue
Rp6.450.000, recorded operating expense Rp0 and Cash Flow ending balance
Rp6.450.000. Known COGS subtotal is Rp0 from no known historical costs; all nine
historical lines lack cost snapshots, so total COGS, gross profit and net profit
are unavailable. Legacy demo context is disclosed. No reliable monthly coverage
was fabricated; the 12-month financial projection is suppressed.

### Automated verification

- `npm run format:check`, lint and typecheck passed.
- `npm test`: 325/325 tests passed in 21 files, including 11 new investor
  integration tests. An earlier concurrent run passed all assertions but hit an
  existing 10-second database teardown timeout; a full rerun passed unchanged.
- `npm run test:production`: 8/8 passed on a fresh migrated PostgreSQL fixture.
- `npx playwright test --list`: 19 tests in 15 files.
- Full browser run #1 after the selector correction: 19/19, 3.5 minutes.
- Full browser run #2: 19/19, 3.5 minutes, new disposable DB.
- Earlier investor browser selector attempt targeted an intentionally
  pointer-inert radio input. The test now exercises native keyboard navigation,
  confirms unknown selection, and verifies the storefront action is disabled.
- New browser coverage includes fixed asset list/add/edit/dispose, inventory
  unknown/confirmed-zero controls, both report values and disclosures, print
  trigger/media rules, responsive overflow, and no page errors or unexpected
  4xx/5xx responses. Synthetic report screenshots are in ignored `test-results/`.
- Browser commands set HOST=0.0.0.0 for their own process to support both loopback
  and LAN test origins. The project environment file is unchanged.
- The existing lockfile dependencies were restored with `npm ci` after stopping
  the local application that held a Sharp DLL lock. No dependency was added,
  no lockfile was changed and no `npm audit fix` was run.

Recommended commit message, not executed:
`feat: add investor asset and prospective reports`.

No files are staged. No commit or push is performed. Owner source payloads,
backups, logs, database contents, dependencies and generated build/test files
remain outside version control. The official PNG and concept sources are
unchanged.

### Owner report and runtime QA

Both report templates rendered successfully with actual owner records using a
read-only PostgreSQL connection: 34 inventory rows and 20 fixed asset rows, no
mutation form in either report article, matching Rp49.866.000 recorded assets and
suppressed projection. The owner application was restarted from the verified
compiled build with its existing environment configuration. No automated owner
login or database session was created. Final production build and whitespace
checks passed; the staging area remains empty.

The original public/images/lokka_logo.png SHA-256 remains
`34db7bd020deca8ca7995f6a882684de4cd123ff2aab91a8e413ea342ed50d18`.

### Changed/new files

- `drizzle/meta/_journal.json`
- `package.json`
- `src/db/schema/index.ts`
- `src/modules/admin/presentation.ts`
- `src/modules/admin/routes.ts`
- `src/modules/cart/service.ts`
- `src/modules/catalog/routes.ts`
- `src/modules/catalog/service.ts`
- `src/modules/catalog/validation.ts`
- `src/modules/finance/accounting.ts`
- `src/modules/finance/ledger.ts`
- `src/modules/finance/service.ts`
- `src/modules/sales/service.ts`
- `src/modules/shipping/service.ts`
- `tests/admin-foundation.test.ts`
- `views/admin/inventory.ejs`
- `views/cart/cart.ejs`
- `views/pages/product.ejs`
- `views/partials/variant-form.ejs`
- `web/client/admin.ts`
- `web/client/main.ts`
- `web/client/pos.ts`
- `web/client/styles/admin.css`
- `docs/investor-reporting-implementation.md`
- `docs/investor-reporting-preflight.md`
- `drizzle/0011_investor_reporting.sql`
- `scripts/prepare-owner-workbook.py`
- `src/db/import-owner.ts`
- `src/modules/admin/investor-routes.ts`
- `src/modules/finance/fixed-assets.ts`
- `src/modules/finance/investor-reports.ts`
- `src/modules/finance/owner-import.ts`
- `src/modules/finance/owner-reconciliation.ts`
- `tests/browser/investor-reporting.spec.ts`
- `tests/helpers/investor-fixture.ts`
- `tests/investor-reporting.test.ts`
- `views/admin/asset-report.ejs`
- `views/admin/fixed-assets.ejs`
- `views/admin/plan-report.ejs`
- `views/partials/admin/report-header.ejs`
