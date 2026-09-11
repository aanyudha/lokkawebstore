# ADR 003: Catalog pricing, global overhead and fulfillment readiness

Status: accepted for Milestone 2.5.

## Ownership and separation

Catalog retains the existing `product_variants.price`, `compare_at_price` (PostgreSQL bigint / TypeScript bigint) and `weight_grams` (integer). No duplicate money or weight columns were added. Selling prices belong to variants; compare-at is optional merchandising data and must exceed selling price. Inactive variants may leave price/weight blank, stored as zero; SKU and name remain required identities. Active variants require positive prices and integer gram weights. Publishing requires an active usable variant, and a published product cannot lose its last usable variant through variant editing. Product row locks serialize publication and variant writes. Stock remains nonnegative; zero stock is valid for publication.

Finance owns generic per-unit `product_direct_cost_components` and `product_pricing_profiles`. Categories are direct material, direct labor, packaging and other. Product ownership is checked through Catalog. Saving costs and profiles uses transactions and explicit update timestamps. Costs can be edited or removed; they are current planning data, not historical sale economics.

Business-wide VPS, domain, subscriptions, studio rent and similar expenses belong to `global_overhead_costs`, scoped to the seeded LOKKA vendor. They are never copied into product direct costs. Product analysis reads the current open overhead period dynamically. There is no marketplace or vendor selection.

## Recognition and period history

Each master has category, whole-Rupiah amount, monthly/annual/one-time frequency, recognition policy, required start date (also billing anniversary), optional end date, active flag and notes. Recognition is by whole calendar month, including the start and end months, without daily proration.

- Monthly: recognize the full amount in each eligible opened month.
- Annual, spread monthly: divide the annual amount by 12 using bigint. Assign one additional Rupiah to each of the first `amount % 12` months of the anniversary cycle. For Rp240,005 starting September, September–January recognize Rp20,001 each and February–August Rp20,000 each. The next anniversary repeats this schedule.
- Annual, charge in billing period: recognize the full amount only in the anniversary month.
- One time: recognize the full amount only in the start month. Recognition policy does not split monthly or one-time billing.

Opening creates immutable cost snapshots in `global_overhead_period_items`. Later master edits affect future opened periods only, even if the current period is still open. Explicit signed target adjustments with required reasons handle current-period corrections. Zero recognized costs need no snapshot row. Master costs have no deletion workflow; deactivate them for future periods.

Periods have a unique vendor/month, one open period per vendor, and a unique predecessor reference. Opening and all finance writes share a PostgreSQL transaction advisory lock; close/open, recovery/close and master-edit/open races cannot create partial or duplicate state. Reads of period totals use a repeatable-read snapshot. Period items and recovery entries have no edit/delete routes. Closed periods reject forecast changes, new items, recovery and repeat closing. Normal administration cannot rewrite historical balances. Correct closed history by a documented addition/credit in an open period.

## Planned allocation versus actual recovery

`target = opening carry-forward + recognized costs + signed target adjustments`

`actual recovered = sum(global_overhead_recovery_entries.amount_rupiah)`

`remaining = max(target - actual recovered, 0)`

`planned overhead / unit = ceil(remaining / forecast units remaining)`

Forecast units remaining must be a positive integer. It estimates remaining sales, not stock, orders, sales already made or accounting recovery. Changing the forecast changes the planned allocation only. Product A and B each use this same per-unit burden once when analyzing their own direct unit costs.

**Planned overhead allocation informs pricing recommendations. Actual overhead recovery represents real commercial activity.** A recommendation, a profile change, setting a selling price, creating a product or publishing it never recovers money.

Until Orders exist, only the explicitly labeled **Admin manual recovery adjustment** can record actual recovery. Entries require signed whole-Rupiah amount, a note/reason and an automatic timestamp, with optional reference. Corrections append negative reversal entries. The resulting recovered total must stay between zero and target; target credits cannot fall below recovery. Concurrent recovery attempts are serialized and cannot exceed the outstanding balance. The UI shows readable totals plus expandable entry history.

`ORDER_LINE` is a reserved future source concept, deliberately not accepted by the current schema/service. Future paid/recognized order lines should replace normal manual recovery, store historical order-line cost/allocation snapshots, and apply `min(calculated recovery, outstanding)` with idempotent order references. No order integration exists here.

## Closing and carrying forward

The close form shows target, recovered, outstanding and next-period carry-forward. It requires a checkbox confirmation and posts the reviewed target/recovery values. If recovery or target changed in another request, the server rejects stale confirmation and asks the owner to review refreshed totals. Closing atomically records status, close timestamp and `closing_unrecovered = max(target - recovered, 0)`.

The next open operation transactionally links the latest closed predecessor, copies its closing balance into opening carry-forward once, and snapshots the chosen month's eligible costs. The opening balance is stored on the period only; there is no duplicate carry-forward item.

Worked example:

| Period    | Opening |  Current costs |         Target | Recovered | Closing |
| --------- | ------: | -------------: | -------------: | --------: | ------: |
| September |       0 |        600,000 |        600,000 |   450,000 | 150,000 |
| October   | 150,000 |        500,000 |        650,000 |   650,000 |       0 |
| November  |       0 | November costs | November costs |         — |       — |

Skipped-month rule: if September closes and November is next opened, carry September's unresolved balance once. Recognize November costs only. Do not synthesize October expenses, annual billing charges or missed one-time charges. The owner can deliberately open intervening periods in chronological order, or document a missed cost as an adjustment. Backdating before the latest period is rejected.

## Pricing calculation

`C = direct unit costs + current planned overhead / unit`

The owner explicitly selects **Target margin on revenue** (default) or **Markup on cost**. Profile percentages are parsed exactly into integer basis points; no money uses Number arithmetic.

- Target margin: `P = ceil(C × 10000 / (10000 - marginBps - taxBps))`. Margin plus reserve must be below 100%.
- Markup: `P = ceil(C × (10000 + markupBps) / (10000 - taxBps))`. The rational markup profit is retained without intermediate rounding.
- Recommendation rounds upward to Rp1, Rp1,000 (default), Rp5,000 or Rp10,000. The implementation rounds the rational result directly to the increment, so it never reduces the economic target.
- Example: C=200,000, 50% margin and zero reserve recommends 400,000; 50% markup recommends 300,000. Rp401,010 rounded to Rp1,000 becomes Rp402,000.

Estimated tax reserve defaults to **0%** and is an internal pricing simulation. No legal tax rate is assumed. It does not collect tax, determine legal liabilities, generate invoices or affect storefront tax labels. Actual tax belongs to a future TaxService.

The variant analysis table shows actual selling price, full unit cost, reserve, estimated profit and actual margin. The reserve rounds upward to whole Rupiah. Profit is price minus full cost minus reserve; actual margin is profit/revenue, displayed to two decimal places truncated toward zero. Zero selling price displays no margin. Negative profit is allowed and displayed. Bigint intermediates allow exact analysis even above Number's safe-integer range; persisted money is bounded by PostgreSQL signed bigint. An advisory recommendation may exceed that storage limit; setting an actual variant price still enforces the bound.

Without an open period the page explicitly reports missing overhead, withholds a complete recommendation, and labels economics as excluding unconfigured overhead. No Apply button silently changes actual prices; use the existing variant editor explicitly. All costing, reserve, margin, overhead and recommendation data remain private to authenticated admin pages and are absent from public HTML, metadata, JSON-LD and APIs.

Public formatting uses Intl.NumberFormat on bigint with English comma grouping and Indonesian dot grouping. Collections show From/Mulai only when active variant prices differ. PDP SSR selects the first ordered active variant with its price, compare-at and stock; small browser TypeScript updates these fields when selection changes. JSON-LD retains actual per-variant decimal-string prices.

## Fulfillment boundary

Shipping owns provider-independent `fulfillment_origins` and `createFulfillment`. Origins contain LOKKA ownership, name, contact, phone, address lines, district/city/province, five-digit Indonesian postal code, ID country code, optional paired decimal coordinates, status and default flag. No real address is seeded. The empty UI says “Fulfillment origin not configured.” Setting a default is transactional and a partial unique index permits only one active default per vendor. Inactive origins cannot be default.

The internal resolver takes product ID, variant ID and positive integer quantity, checks active publication/variant, positive weight/price, stock availability and a configured default origin, then returns product ID, variant ID, SKU, quantity, decimal-string actual price, unit weight grams, available stock and origin. It performs no external calls, stock reservation, quote, shipment booking or sale. Its output is a readiness snapshot; future checkout must revalidate stock and prices transactionally.

Future boundary: Checkout → ShippingService → provider adapter (BiteshipProvider or RajaOngkirProvider inside shipping). PaymentService → DokuProvider remains inside payments. TaxService remains separate. These services/providers, cart, checkout, orders, payments and customer accounts are not implemented in this milestone.

## Migration and verification

`0003_noisy_jane_foster.sql` adds seven tables and relevant foreign keys, checks and indexes; previous migrations, catalog, translations and media are preserved. The existing compare-at constraint is tightened using `NOT VALID`: existing equal-price legacy rows remain untouched, but all subsequent inserts/updates must obey `compare_at_price > price`. Such legacy merchandising values are hidden publicly; the owner can correct them in the variant editor. Before validating the constraint across historical rows, review `SELECT count(*) FROM product_variants WHERE compare_at_price <= price`. This avoids either a failed migration or an unrequested catalog rewrite.

The migrated integration suite and commercial Playwright fixture create uniquely named disposable PostgreSQL databases, so global finance tests never mutate the owner's periods or origin. The test connection role needs CREATEDB; only each fixture's own generated database is dropped at cleanup. Existing catalog/browser tests continue cleaning their uniquely identified catalog/admin fixtures. There are no real provider calls.

Admin commercial routes are registered inside existing DB-session, active-user, origin and CSRF hooks; all mutations use POST and validate server-side, with ownership checks. Failed form input is retained. Visual screenshots and overflow checks cover 1440, 1024, 768, 430 and 375 pixels. Financial unit/integration tests cover recognition, snapshots, adjustment/reversal/caps, concurrent close/open/recovery, carry-forward, skipped periods, formulas, publication, public privacy and fulfillment readiness.
