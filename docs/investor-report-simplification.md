# Investor report simplification and print consistency

## Scope and changed files

Presentation-only changes to the two view-only investor reports. No migration, import, business service, valuation formula, payment/shipping contract, Finance semantics or projection evidence threshold was changed. Owner concept documents and the official logo source are untouched.

| File                                         | Change                                                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/modules/admin/investor-routes.ts`       | Fetch one canonical report per request and pass it to EJS with presentation metadata.                 |
| `src/modules/admin/investor-presentation.ts` | Read-only product counts, status labels, unit label and bigint display percentages.                   |
| `views/admin/asset-report.ejs`               | Executive snapshot and asset/inventory summaries followed by complete appendices.                     |
| `views/admin/plan-report.ejs`                | Executive position, four roadmap phases, outlook and evidence appendices.                             |
| `views/partials/admin/report-header.ejs`     | Consistent Print Report button; existing logo and report timestamp retained.                          |
| `web/client/admin.ts`                        | Import dedicated investor presentation stylesheet; existing window.print handler retained.            |
| `web/client/styles/investor-report.css`      | Responsive screen styling, A4 portrait printing and page-break rules.                                 |
| `tests/investor-presentation.test.ts`        | Canonical values, metadata purity, EJS detail preservation and qualifying projection regression.      |
| `tests/browser/investor-print.spec.ts`       | Disposable database, screen/print identity, print handler, appendix visibility and responsive checks. |
| `tests/browser/investor-reporting.spec.ts`   | Updated button/section assertions for the new report structure.                                       |
| `docs/investor-report-simplification.md`     | Review record and verification results.                                                               |

## Before and after

The asset report previously put summary metrics, complete inventory and complete fixed assets into the main reading flow. It now has two primary sections: executive snapshot with six large KPIs and asset mix; then inventory counts, fixed acquisition summary and concise key notes. Appendix A retains every nonarchived product/variant with SKU, stock, unit, HPP, valuation, selling price, retail and unavailable-data disclosures. Appendix B retains every fixed asset including status and disposed audit context. Appendix C retains formulas, incomplete/unknown/zero treatment, owner classification and no-depreciation basis.

The plan report previously used ten successive sections, a long current-position list and a priority table. It now has three primary sections: five current-position KPIs and four status indicators; operational capabilities, commercial readiness and four planned phases; inventory sales capacity and the unchanged conditional projection. Appendices Aâ€“E contain historical performance and underlying bounded detail, cash flow, Accounting/HPP limitations, projection methodology, and risks/assumptions. Existing canonical detail limits (100 sales, 200 sold lines, 100 expenses, 200 ledger entries) are explicitly disclosed; summary totals still cover the entire qualifying period. No detail query or alternate report dataset was introduced.

Large KPIs display database-derived whole-Rupiah values. Asset shares are presentation-only, calculated with bigint and rounded to two decimal places. Product counts group product IDs; a product with any unknown-stock variant requires confirmation. Active fixed-asset counts count register records, not their quantities. Planned checkout/provider work is distinguished from operational POS, inventory/HPP, Finance, Accounting Lite, cart and unpaid orders. No unsupported in-progress status or financial forecast is asserted.

## Owner reconciliation

The same baseline as-of instant, `2026-11-14T20:25:48.505Z`, was used before and after to avoid moving reporting boundaries.

| Measure                                           |       Before |        After |
| ------------------------------------------------- | -----------: | -----------: |
| Known inventory                                   |      149 pcs |      149 pcs |
| Inventory HPP                                     | Rp25.671.000 | Rp25.671.000 |
| Inventory retail value                            | Rp76.805.000 | Rp76.805.000 |
| Potential gross spread                            | Rp51.134.000 | Rp51.134.000 |
| Active fixed acquisition value                    | Rp24.195.000 | Rp24.195.000 |
| Combined recorded assets                          | Rp49.866.000 | Rp49.866.000 |
| Recorded revenue                                  |  Rp6.450.000 |  Rp6.450.000 |
| Cash ending balance                               |  Rp6.450.000 |  Rp6.450.000 |
| Known historical COGS subtotal                    |          Rp0 |          Rp0 |
| Operating expenses                                |          Rp0 |          Rp0 |
| Total historical COGS / gross profit / net profit |   Not stated |   Not stated |
| Legacy demo-linked completed sales                |            5 |            5 |
| Financial projection                              |   Suppressed |   Suppressed |

There remain 34 catalog products, 20 fixed-asset records and six incomplete inventory rows. Shipping weights remain incomplete for 32 products; the report derives this count rather than implying that all products lack weights. Asset mix is 51.48% inventory HPP and 48.52% fixed assets. These are reconciliation observations, not hardcoded template values.

The unchanged backend still suppresses projections without consecutive documented complete months, at least 30 complete days and complete historical HPP. The qualifying-evidence test also confirms that a valid backend projection remains visible when evidence exists. Missing historical HPP never becomes zero, and current catalog costs never backfill sold-item costs.

## Shared screen and print architecture

Each GET obtains one canonical `createInvestorReports(...).report(...)` result in the existing read-only repeatable-read transaction. EJS renders the financial values and evidence once. The metadata helper does not mutate that object or copy its money/tables into a second dataset. Screen and print use the same article and the same report.asOf timestamp.

Print Report calls the existing `window.print()` handler. It does not fetch another report, recalculate totals, alter the timestamp or generate a separate PDF payload. Save as PDF uses the browser print dialog. Dedicated CSS changes presentation only; no investor section or appendix is conditionally hidden for print. Existing admin print rules hide navigation, page chrome and interactive controls.

Named A4 portrait pages use 14mm margins. Primary sections start new pages, followed by appendices; asset layout targets two primary pages and plan layout targets three. Long tables flow naturally, repeat column headers and retain total rows at their end. KPI blocks, rows and headings have break-avoidance rules. Exact pagination can vary with browser print settings and data length; the native printer dialog is not automated.

## Verification and isolation

Owner reconciliation used a PostgreSQL connection forced to read-only and in-memory EJS rendering, without owner login or business writes. Before/after row counts and SHA-256 fingerprints match for all 33 compared public tables, including products, variants, inventory-related records, fixed assets, sales, sale items, payments, ledger and import records. Transient admin/POS/customer session tables were excluded from that baseline. Baseline and after artifacts are outside the repository under the local Codex backup directory, with no owner data added to Git.

Application, production and browser integration tests use independently migrated disposable PostgreSQL databases with synthetic data. The focused browser test verifies both report routes, executive values, appendix row counts, null projection, print handler invocation and no page errors or unexpected HTTP failures. Switching to print media leaves the entire report HTML, table contents and timestamp exactly equal, makes all primary/appendix sections visible, and hides admin chrome. It verifies named-page, break avoidance and repeating-table-header computed styles and makes no extra report request during printing. Responsive checks cover 1440px, 768px and 390px. Executive screenshots were reviewed; synthetic fixture figures deliberately differ from owner figures.

| Check                                                       | Result                                   |
| ----------------------------------------------------------- | ---------------------------------------- |
| `npm run format:check`                                      | Passed                                   |
| `npm run lint`                                              | Passed                                   |
| `npm run typecheck`                                         | Passed                                   |
| `npm test`                                                  | 345 passed in 23 files                   |
| `npm run test:production`                                   | 8 passed                                 |
| `npx playwright test --list`                                | 21 tests in 17 files                     |
| `npm run test:browser`                                      | 21 passed in 3.7 minutes; disposable DBs |
| Focused EJS/presentation check after final appendix wording | 4 passed                                 |
| `npm run build`                                             | Passed                                   |
| `git diff --check`                                          | Passed                                   |

Final working-tree scope: six modified tracked files and five new files listed above. No staged diff; no commit or push. The local review server is refreshed from the final build without running migrations or logging into owner sessions. The production build and generated browser screenshots remain ignored artifacts.

Recommended commit message (not executed): `fix: simplify investor reports and align print output`.

No files staged. No commit created. No push performed.
