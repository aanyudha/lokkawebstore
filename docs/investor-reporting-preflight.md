# Investor reporting preflight and stock-unknown design

Status: design only; implementation and owner import stopped at the explicit
section 6 gate in the owner request. No application, migration, seed or database
writes were performed. This is not a completed investor-reporting milestone.

Audit date: 2026-11-15, Asia/Jakarta. Starting HEAD:
`4665cd264fc7c0b57941e7c8fe2d737e9a708994`. The starting working tree was clean.

## Why implementation stopped

The owner request states:

> If current schema makes this impossible without a schema change:
> STOP and design the smallest explicit stock-known/unknown solution.

`product_variants.stock_quantity` is an integer, `NOT NULL DEFAULT 0`, with a
nonnegative constraint. There is no stock-known flag or quantity provenance field.
`variantInput` and the inventory write require a nonnegative integer. The product
editor defaults absent stock to zero, and inventory/POS/storefront/cart consumers
interpret the integer directly. A note alone would not preserve canonical unknown
stock across these consumers.

Consequently, importing blank quantities as zero with the current model would
misstate six owner records. The smallest explicit solution is one boolean on the
existing variant, described below. It has not been applied.

## Workbook verification

Source found at `C:/Users/aan/Downloads/Aktiva_Lancar_dan_Aktiva_Tetap.xlsx`.
SHA-256:
`c87e436b3563b0f6c250acf949c82309fce9131422fa1e436cf4dba480c126b4`.

Both worksheets were read directly from the XLSX ZIP/XML, including cached HPP
results. Integer arithmetic independently recomputed every HPP as material plus
sewing cost: 34 matches, zero mismatches. No dependency was installed and the
workbook was not changed.

| Source fact                                   | Recomputed result |
| --------------------------------------------- | ----------------: |
| Aktiva Lancar product rows                    |                34 |
| Rows with known stock                         |                28 |
| Rows with unspecified stock                   |                 6 |
| Known stock, pcs                              |               149 |
| Inventory at HPP                              |      Rp25.671.000 |
| Inventory at retail                           |      Rp76.805.000 |
| Potential gross value spread                  |      Rp51.134.000 |
| Aktiva Tetap rows                             |                20 |
| Fixed asset acquisition value                 |      Rp24.195.000 |
| Combined recorded value, HPP plus acquisition |      Rp49.866.000 |

These are source reconciliation results, not imported database/report totals.
Fixed asset acquisition totals use quantity times Harga Beli per unit/pack,
as directed by the owner. The owner's fixed-asset classification is retained.
Retail value is not added to recorded assets.

The six unspecified-stock products are exactly:

- binanti Top dobby
- set arum
- iris top
- Top jangan polos
- top panjang
- top mis lace

All product units are `pcs`. Product spelling and capitalization match the request.
The workbook has no SKU, size, color, shipping weight, media references, asset
acquisition dates or depreciation facts.

## Read-only owner database audit

Catalog/history inspection used `REPEATABLE READ READ ONLY`; service report reads
used a PostgreSQL pool with `default_transaction_read_only=on`. No admin login,
seed, automated QA mutation, schema migration or cleanup targeted the owner DB.

| Catalog entity   | Variants | Translations | Media | Sale lines | Completed sale references | Inventory movements |
| ---------------- | -------: | -----------: | ----: | ---------: | ------------------------: | ------------------: |
| LOKKA Demo Shirt |        1 |            2 |     1 |          3 |                         3 |                   3 |
| LOKKA Demo Outer |        1 |            2 |     0 |          3 |                         3 |                   3 |
| LOKKA Demo Dress |        1 |            2 |     0 |          3 |                         3 |                   3 |

All three are active and belong to LOKKA. Their slugs, deterministic
`LOKKA-DEMO-*-M` SKUs, development-only descriptions and EN/ID translations match
`src/db/seed-dev-data.ts`, providing evidence beyond product names. Stock reflects
sales: Shirt 8, Outer 5, Dress 3. Each product references six ledger rows through
three sales; references overlap across products and must not be summed as unique
transactions. One Ready to Wear category has two translations. There is one
product showcase and no showcase images. Existing media must not be copied to
new workbook products or removed merely because the catalog entity is archived.

There are zero current direct cost components, pricing profiles, cart items,
orders, order items and global overhead records. The development seed adds missing
demo entries; it must remain confined to disposable development/test databases
and must not be rerun to repopulate the owner catalog after import. Real owner
imports must remain separate from `seed-dev-data.ts`.

Historical business facts:

- Five completed POS sales on 2026-09-21, nine sale lines, five sale payments,
  nine sale inventory movements and ten financial transaction rows.
- Posted sale revenue: five rows totaling Rp6.450.000. Five legacy CASH_INFLOW
  rows totaling Rp6.480.000 are already voided. Preserve their void history.
- Accounting Lite returns revenue Rp6.450.000 and operating expenses Rp0.
  All nine historical sale lines lack cost snapshots: known COGS subtotal is
  zero from no known costs, while total COGS, gross profit and net profit are
  unavailable. They must not be presented as zero cost or a profit figure.
- Cash Flow returns income/ending balance Rp6.450.000 and expenses Rp0 for the
  audited all-record period 2000-01-01 through 2026-11-14 UTC. Date boundaries
  retain the existing report semantics; the local audit date is 2026-11-15.
- All existing sales reference demo catalog entities. Preserve the records and
  disclose their legacy/demo context rather than claiming workbook trading
  history. One recorded sales day with missing HPP cannot support a forecast,
  regardless of elapsed calendar time since that day.

Cleanup performed: none. No entity qualifies as unreferenced dummy catalog in
this database. Do not delete these products or their historical dependencies.
After implementation resumes, archive these three exact seed-matched products
through the owned catalog service, updating `updated_at`. Preserve variants,
translations, media, sales, payments, snapshots and movements. No historical sale
has been positively identified as disposable automated QA, so no sale cleanup is
proposed. Recheck all references and identity evidence in the import dry run.

Snapshot fingerprints were computed as SHA-256 of JSON arrays of `to_jsonb(row)`
ordered by `to_jsonb(row)::text`, fetched through node-postgres. These detect
changes; they are not a restorable backup. No database dump is added to Git.

| Table                  | Rows | SHA-256                                                            |
| ---------------------- | ---: | ------------------------------------------------------------------ |
| products               |    3 | `59fad063363f4e9dbf02c9f3e7615ac13716b926473611fb3de1ef870794a94f` |
| product_variants       |    3 | `5c70ccf611ec5dc8b01b2f1cd517bac5fa5ccd764d49145a94250f96f26e43d0` |
| product_translations   |    6 | `fa1efbf8d6ebda6bf2c3d95b3ed34d27b427a4cd2448464877f0a8c65f808201` |
| product_images         |    1 | `2e28aae7da27865c71cf354e66bab9a929c5c066b07796666c73cd2033987191` |
| sales                  |    5 | `d2e710610698f8d4fdff3670d1cb620aab6319e95b4967be84410a4785ffc162` |
| sale_items             |    9 | `bdd2dae7d0d74a69700d208a01f0622b23ef98f7c4408eb87dca9162075d3bff` |
| sale_payments          |    5 | `9dcef776161252195e3d796a1347e0523b0a31beadfd75c813ce0edde0f07f66` |
| inventory_movements    |    9 | `1980ed646a532066d5139c7802768f2567ab325047b16bfd859c051b05b0e027` |
| financial_transactions |   10 | `f2ee552e9f2c5027d29ff5b312a2b0ae076374aaa2e457ef3a0cba744a07e6c0` |

## Minimum proposed stock model

Add one column to `product_variants`:

```sql
-- Design only. Not an executed migration.
ALTER TABLE product_variants
  ADD COLUMN stock_known boolean NOT NULL DEFAULT true;
ALTER TABLE product_variants
  ADD CONSTRAINT variants_unknown_stock_placeholder
  CHECK (stock_known OR stock_quantity = 0);
```

Existing quantities remain known as previously recorded. Do not alter existing
quantity values, history or timestamps merely to introduce the flag. Existing
nonnegative stock constraints remain. These two canonical states are distinct:

| State                                      | stock_known | stock_quantity                | Display                   | Valuation            |
| ------------------------------------------ | ----------- | ----------------------------- | ------------------------- | -------------------- |
| Known quantity, including a confirmed zero | true        | Source/confirmed integer      | Quantity                  | Include if HPP known |
| Source quantity unspecified                | false       | 0, technical placeholder only | Unavailable / Belum diisi | Exclude              |

No second inventory table or Aktiva Lancar input module is introduced. Keep this
separate from variant status: inactive can mean many things and is not evidence
that stock is unknown. A free-text description is also not a stock-state flag.

Required consumer and write behavior in the same implementation:

1. `Catalog.saveVariant` and `Catalog.stock` validate the pair server-side and
   update `updated_at` explicitly. A legacy edit omitting the new field preserves
   the existing flag, avoiding accidental conversion of unknown to known zero.
2. Inventory and variant forms offer an explicit known/unspecified state. Unknown
   quantity fields render blank, with a text explanation. Confirming an integer
   deliberately switches to known; a confirmed zero is valid. Stock form submits
   use the existing active admin DB session, CSRF, owner checks and validation.
3. POS, cart, order creation and fulfillment resolution require `stock_known`
   before accepting stock-dependent actions. Revalidate under existing locks.
   Unknown stock must never be offered as available or displayed as factual zero.
   POS and storefront views display unavailable; existing cart lines remain
   removable and block checkout if their quantities become unknown.
4. Sale completion requires known stock before subtracting quantity; it must not
   change an unknown placeholder into a known fact. Existing historical movement
   and sale snapshots remain untouched.
5. Asset reports read nonarchived catalog inventory, including imported drafts
   and inactive variants. Drafts remain operational inventory even before web
   publication. Archived legacy demo products are excluded from current asset
   totals without affecting sales/accounting history. Report the inclusion policy.
6. Quantity unknown excludes the row from all stock-derived totals. Known units
   can be counted independently of HPP completeness. HPP unknown is represented
   by absence of direct cost components; explicit zero components are known zero.
   A common complete stock-and-cost cohort supplies HPP, retail and gross-spread
   comparison totals, with incomplete item counts/disclosures.
7. Keep quantity integer and money bigint. Convert quantity to bigint before
   money multiplication; serialize amounts as decimal strings. Never coalesce
   unavailable valuations or missing historical profit to zero.

The importer maps the 28 source quantities to known and the six blanks to unknown
with a zero technical placeholder. It never fabricates inventory movements for
unknown stock. First-time known inventory initialization should use the existing
movement model with a clearly identified owner import reference; exact replays
must not repeat movements. A later confirmed stocktake should be recorded as a
stock confirmation/correction, not a sale. Product locks prevent racing with sales.

## Other source/model gaps and import design

Shipping weight is absent from the workbook. Current `variantInput`,
`Catalog.saveProduct` publication and fulfillment readiness require positive
weight for active variants. Initial real products can be drafts with inactive
variants and weight 0 as the existing unpublished placeholder. This allows
inventory/cost reporting without inventing shipping weights. Publishing/selling
requires confirmed weights under the current architecture. Do not bypass the
catalog service or silently relax publication rules to make imports active.

The current product/variant schema has no unit field. Preserve source units in a
small canonical unit metadata field introduced by migration when implementation
resumes; do not hide units solely in names. The stock proposal above remains
one boolean; unit metadata is a separate source-mapping requirement.

Proposed import mapping:

- One canonical product per source row, preserving commercial names, plus one
  default variant named Default. Stable internal SKU, for example
  `LOKKA-SYS-OWNER-001`, is generated and explicitly identified as system data.
- Current price goes to the existing variant price. Material and sewing costs go
  to DIRECT_MATERIAL and DIRECT_LABOR components; their sum must equal workbook
  HPP. Retain explicit zero sewing cost. No duplicate authoritative HPP column.
- Minimal disclosed taxonomy: Accessories for Bross and Gelang; Ready to Wear for
  the remaining apparel rows. Categories are operational classification, not
  workbook-supplied investor classifications. Do not attach accessories to the
  existing apparel category. Avoid any further inferred taxonomy.
- Use existing EN/ID fallback translation behavior, retaining the same source
  product names. No borrowed demo image; the existing safe placeholder remains.
- Fixed assets use a new owned register with name, integer quantity, unit,
  bigint unit acquisition cost, nullable acquisition date/notes, ACTIVE/DISPOSED,
  created_by and timestamps. No hard-delete operation or depreciation inference.
- A separate owner import ledger maps workbook identity, sheet and source row to
  canonical entity IDs and applied payload hashes. Do not key idempotency on
  editable product names or silently claim existing catalog rows by slug.
  Exact reruns skip existing rows, including after live sales or owner edits;
  changed source or conflicting live state requires an explicit reviewed update
  plan. Never reset sold stock from the original workbook on a rerun.
- Import parser/payload preserves stock nulls and money decimal strings, verifies
  source digest and row counts, validates all rows before any mutation and emits
  created/updated/skipped/incomplete counts. Keep operational owner payloads
  separate from synthetic automated-test fixtures and generic development seed.
- A future apply step needs a fresh dry run, restorable backup stored outside the
  repository, history fingerprints, an active owner admin identity, and one
  transactional import/cleanup plan. Fingerprints must be rechecked immediately
  around apply. Reconcile every row, not just aggregate totals.

## Reporting implementation remaining after the gate

No Fixed Assets schema/UI, reporting route, navigation item, importer or seed has
been implemented in this preflight. No source row has been imported.

The remaining implementation is the requested operational Fixed Assets UI and two
view-only EJS reports under `/admin/reports/assets` and
`/admin/reports/12-month-plan`, with official logo, formal sections, generation
and as-of dates, A4 print CSS, print button, basis notes and hidden admin chrome
on print. Fixed Assets stays under Finance; report pages contain no mutation form.

The asset report must dynamically reconcile inventory HPP/retail/spread, active
fixed acquisition value and combined HPP-plus-acquisition total. DISPOSED assets
remain visible with their status and are excluded from active totals. Incomplete
quantity/cost disclosures are mandatory. No book value or depreciation is implied.

The 12-month report must preserve current Accounting Lite and Cash Flow semantics.
Its actual/current/projection/insufficient-data labels must be explicit. Web cart
and unpaid order creation/cancellation exist; completed webstore checkout,
payment provider processing and shipping quotes/bookings do not. Do not describe
them as operational completed-sale channels or start provider integration here.

Projection design: use only complete calendar months after a documented reliable
operational-history start, requiring at least 30 complete days in those months,
complete sale-item HPP coverage, no itemless completed sales, and adequate expense
coverage for expense/net projection. Elapsed time since a first sale is not
proof of reliable coverage. Missing reliability evidence suppresses the
projection. For qualifying history, run-rate revenue is included completed
POS/WEBSTORE revenue times 12 divided by included complete months; use bigint
integer arithmetic and state whole-Rupiah rounding explicitly. Apply equivalent
coverage gates separately to COGS, gross profit, expense and net profit.
Synthetic fixtures must prove both qualifying and insufficient cases. Current
legacy data does not qualify. Inventory opportunity may still be shown, clearly
excluding operating expenses, discounts, unsold inventory risk, fees, tax and
returns; it is neither guaranteed revenue nor projected profit.

## Verification status

This preflight performed read-only workbook reconciliation and owner database/
service inspection. It did not run automated application/browser suites or claim
new feature regression coverage: the implementation is intentionally stopped.
The required full format/lint/typecheck/unit/production/build checks, browser
listing and two disposable-DB Playwright runs remain part of implementation.
For this documentation change, run Prettier and `git diff --check` only. No files
are staged; no commit or push is performed.
