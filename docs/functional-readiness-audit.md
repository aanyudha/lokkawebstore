# Functional readiness audit — 29 October 2026

Scope: existing LOKKA functions only. No new business module, checkout, payment
provider, tax implementation, dependency update or database migration.

## Starting state and method

Starting HEAD: `edf34545bc098b63e41aebd2dddfc6be8656f40e` on `main`, clean and equal
to the locally recorded `origin/main`. Accounting Lite was already committed.
No branch operation, staging, commit or push was performed.

Inspection combined source review, failing regression reproductions, an actual
Chrome session against a running app on port 3021, UI actions followed by SQL
checks, screenshots, Console/Network inspection, and the full automated suites.
This was agent-operated browser QA, not a claim that the owner performed human
acceptance or that a physical receipt printer was tested.

Final verification and all manual mutation workflows use independently migrated
disposable PostgreSQL databases. An existing production-suite isolation gap was
discovered and fixed during the audit, as disclosed below. The manual Chrome
session used controlled development fixtures, not the owner database. A separate
fresh Chrome session browsed the existing owner listener on port 3000 using
public GET requests only.

## Reproductions and fixes

Nine new integration regression cases failed on the starting implementation:

| Reproduction                            | Before                                | Result after fix                                                               |
| --------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------ |
| Malformed sale item (`null`)            | HTTP 500                              | Validated HTTP 422; no sale or stock change                                    |
| Cash below sale total                   | HTTP 200, completed sale              | Rejected before any factual writes                                             |
| Archived product SKU search             | Archived product returned             | Active-product filter applies to all search paths; stale carts also rejected   |
| Same variant in quantities 2 + 3        | Stock 100 became 97                   | Consolidated quantity 5, stock 95, one item/movement                           |
| Same variant in quantities 60 + 60      | Accepted despite stock 100            | Combined stock check rejects atomically                                        |
| Receipt/history amount 9007199254740993 | Rounded to 9007199254740992           | Exact bigint formatting throughout                                             |
| English category canonical URL          | `/kategori/...`; wrong alternate slug | Correct `/category/...` and translated ID slug                                 |
| Base product name edit                  | Copied storefront name stayed stale   | Fields still matching old base text follow edits; distinct translations remain |
| Missing thumbnail file                  | ENOENT / failed image                 | Other derivative, then generated WebP placeholder; private source never used   |

Additional browser/source findings addressed:

- Chrome reported CSP violations for inline scrolling styles on Media and POS
  History. Both now use external CSS and keyboard-focusable scroll regions.
- Receipt-detail printing used an inline handler incompatible with CSP. Both
  receipt surfaces now bind print through the browser asset. Print emulation
  verifies hidden payment/variant dialogs and application chrome stay hidden.
- POS History displayed placeholder item count/cashier values. It now uses SQL
  item quantities and the recorded cashier relationship.
- Screenshot inspection found POS navigation links too dark on the top bar:
  the general anchor rule overrode their light color. Selector specificity is
  corrected; the browser regression checks actual text/background contrast
  against 4.5:1, without redesigning the navigation.
- POS origin validation compared hostnames alone. Scheme and port now matter;
  the check also covers login/logout. Negative integration checks cover sales
  and logout with other ports, schemes and hosts.
- First daily transaction numbering now uses one atomic upsert instead of
  select-then-insert. The concurrent independent-product regression passes;
  the old race was identified by inspection, not claimed as a deterministic
  reproduction in this run.
- Production test isolation previously relied on creating and deleting
  temporary records in the configured development database. It now creates a
  fresh migrated `lokka_production_*` database, seeds only its LOKKA vendor,
  passes that URL to the source-free release, and drops the fixture afterward.
- Language switching retains the product/category destination and translated
  slug. `/id/collections` redirects to the existing `/id/koleksi` route.
- Invalid sale-detail UUIDs resolve as controlled 404s. Sale validation errors
  do not expose raw driver error messages.

One old POS test supplied Rp600.000 for a Rp700.000 sale; its valid-sale fixture
was corrected to Rp700.000. The accounting fixture likewise supplies sufficient
cash when testing very large prices. An old catalog assertion expecting stale
copied text was updated to assert the edited fallback name. Separate coverage
protects distinct owner translations.

## Controlled browser mutations

Every entry below was confined to the disposable manual QA database, which was
dropped after the session. No existing owner product was deleted or edited.

- Seeded the same three intentional demo products and Ready to Wear / Siap
  Pakai category; created one temporary QA admin for the isolated app.
- Registered three temporary customer accounts across exploratory reruns;
  exercised login, invalid login, reload persistence, ID account page, logout
  and customer/admin/POS session boundaries. Exploratory retries corrected
  harness assumptions about return URLs and retained CDP cookies.
- Created one product through Admin, assigned the existing category, added
  variant `OWNER-QA-M`, price Rp795.000, weight 300 g and stock 10. Published
  without an image and added direct unit cost Rp300.000 through Pricing UI.
- Uploaded one synthetic PNG and one synthetic JPEG through the upload UI.
  Verified retained original bytes and authenticated download. Removed only a
  generated QA thumbnail to exercise fallback, then tried one invalid upload
  (422). Private source identifiers were absent from public product HTML.
- Changed the QA stock 10 → 12 using Inventory UI and confirmed reload state.
- Saved planned monthly overhead Rp100.000, opened the current period with
  forecast 10 units, and verified pricing full cost Rp310.000. Finance rows
  remained zero. Saved and reloaded one QA fulfillment origin through the UI.
- Added, increased, decreased, removed and cancelled cart items. Cancellation
  left zero sales. Insufficient cash disabled completion in the UI.
- Completed exactly two UI cash sales: Rp795.000 exact cash; then Rp1.000.000
  tendered with Rp205.000 change. Each produced one sale, item, payment,
  quantity −1 movement and posted POS income row. Final stock was 10, consistent
  across POS, Admin and PostgreSQL. Receipt/history and print invocation passed.
- Recorded opening cash Rp1.000.000 dated before today and an actual packaging
  expense Rp50.000. Accounting showed revenue Rp1.590.000, HPP Rp600.000, gross
  profit Rp990.000, expense Rp50.000 and net profit Rp940.000. Cash Flow counted
  income once and included opening cash. Today/month/custom filters worked.
- Changed current direct unit cost to Rp600.000; historical total HPP stayed
  Rp600.000 for the two sold units. Voided the expense with a reason: audit
  history remained, accounting expense became zero, net profit Rp990.000 and
  Cash Flow ending balance Rp2.590.000.
- Edited the QA product name and current price to Rp895.000 through Admin;
  storefront reflected the change while the receipts retained original name,
  Rp795.000 price and historical HPP. Archived the product; SKU search excluded
  it, while historical receipts remained accessible.

Final manual QA counts before dropping the database: 4 products, 3 customers,
2 sales, 2 sale items, 2 payments, 2 sale movements and 4 finance rows (two sale
income rows, opening cash, and the retained voided expense).

A second, separately disposable browser QA database exercised error states:
missing product fields and fractional Rupiah produced useful 422 pages;
tampered form CSRF produced 403; stock changed to zero after adding a cart item
produced 422 with the cart retained; null items and malformed tender produced
422 through real browser fetches. Expired admin sessions redirected to login,
and a fresh anonymous context could not access protected pages, private
originals or the sale API. No sale, payment, movement or finance rows were
written by those rejected requests; no uncaught browser exception occurred.
The zero-stock mutation was confined to that QA fixture and its DB was dropped.

Screenshots and exploratory evidence are local ignored artifacts under
`storage/verification/`. Automated screenshots are under `test-results/`.
The source logo and `docs/basic_concept` were untouched.

## Functional results

| Requested area             | Result and evidence                                                                                                                                                                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public storefront          | Existing owner listener: 12 EN/ID home, collection, category and demo-product URLs returned 200; no broken images or uncaught exceptions. Isolated app additionally verified `/id/collections` redirect.                                                                     |
| Product detail             | Every current demo product opened in both languages, including ID `dress-demo-lokka`; optional images do not determine sellability.                                                                                                                                          |
| Customer auth              | UI registration, valid/invalid login, reload, EN/ID account, logout and role separation passed; integration suite covers CSRF and invalid/expired sessions.                                                                                                                  |
| Admin auth                 | Valid/invalid UI login, protected redirects, session/CSRF/origin checks and logout coverage passed.                                                                                                                                                                          |
| Dashboard/navigation       | Every visible implemented sidebar destination resolved; POS link leads to its separate login/session surface.                                                                                                                                                                |
| Products                   | UI create, variant, category, publish, costs, edit, archive and historical snapshots passed.                                                                                                                                                                                 |
| Categories                 | Actual category is Ready to Wear / Siap Pakai; Collections remains a collection route. No fake category was added to owner or manual QA data.                                                                                                                                |
| Inventory                  | Controlled UI adjustment, post-sale stock and reload matched canonical variant stock; duplicate-line overselling is rejected.                                                                                                                                                |
| Media                      | JPG/PNG upload, private original retention/download, public WebP, thumbnail, invalid upload, ownership/auth boundaries and absent-derivative fallback passed.                                                                                                                |
| Pricing/costing            | Known bigint unit cost and overhead allocation matched UI; recommendations do not change prices or create expenses.                                                                                                                                                          |
| Global Overhead            | Save/reload/period allocation passed; no automatic cash/accounting expense.                                                                                                                                                                                                  |
| Fulfillment                | Current fields save/reload and validation covered; no provider request or implementation added.                                                                                                                                                                              |
| POS auth                   | Valid/invalid UI login and logout; separate POS cookie, shared admin identity, Back Office navigation and session separation passed.                                                                                                                                         |
| POS catalog                | Fresh load, name/partial/SKU/clear search, stock display, missing-image safety and archive exclusion passed.                                                                                                                                                                 |
| POS cart                   | Add/multiple products, quantity controls, remove and cancel covered; cancellation has no factual writes.                                                                                                                                                                     |
| POS payment                | Exact cash, overpayment/change, insufficient cash, malformed payload and out-of-stock rejection covered; no partial rejected-sale writes.                                                                                                                                    |
| POS receipt/print          | Item snapshots, money, cashier, transaction references and print invocation passed on register and detail; print CSS hides chrome/dialogs. Physical printer output not tested.                                                                                               |
| POS history                | Sale references, actual quantities/cashier and exact bigint totals; historical names/prices retained after catalog changes.                                                                                                                                                  |
| Inventory movements        | Each controlled sale has exactly one matching −1 movement; final stock 10 after starting stock 12.                                                                                                                                                                           |
| Financial ledger           | Exactly one posted POS / INCOME row per sale, with matching amount and sale reference.                                                                                                                                                                                       |
| Cash Flow                  | Today/month/custom, opening/income/expense/net/ending totals, expense and void covered.                                                                                                                                                                                      |
| Income & Expense           | Controlled expense persisted once, affected both reports once, then remained auditable after void.                                                                                                                                                                           |
| Accounting Lite            | Revenue, HPP, gross/operating/net profit, filters, contributing references, empty state and incomplete-cost handling passed.                                                                                                                                                 |
| Historical HPP             | Existing snapshot A retained after current cost B; missing snapshots do not use current costs or display fabricated profit.                                                                                                                                                  |
| Cash/accounting separation | Opening cash and manual cash income do not create revenue; tender/change are not extra revenue; overhead planning does not create expense.                                                                                                                                   |
| Security smoke             | Customer cannot access admin/POS; POS-only session cannot access finance/private original; unauthenticated access rejected; CSRF/origin/invalid-session tests pass.                                                                                                          |
| Responsive                 | Direct QA at 1440, 768 and 390 px; automated broader viewport checks, mobile POS payment and keyboard scroll/drawer checks pass.                                                                                                                                             |
| Console/Network            | No remaining uncaught exceptions, CSP errors, failed core fetches or media/JS/CSS requests in the final readiness browser flow. Initial manual CSP findings fixed. Expected invalid-login/upload responses are retained in exploratory logs. Favicon-only noise is cosmetic. |

An exploratory URL guessed as `/id/produk/gaun-demo-lokka` returned 404. The
actual seeded Indonesian slug is `dress-demo-lokka`; its route and the language
switch were subsequently verified. This was a QA-input correction, not an
application failure or a reason to introduce a new product alias.

## Verification and database isolation

- `npm run format:check`, `npm run lint`, `npm run typecheck`: PASS.
- `npm test`: 226 tests / 14 files, PASS.
- Playwright discovery: 11 tests / 9 files. The readiness-specific browser
  workflow also passed independently before the two full-suite runs.
- Full browser runs: 11/11 PASS on each of two complete runs; the full suite
  was repeated after isolation and accessibility corrections as well.
- Production suite: default invocation correctly refused the pre-existing Node
  listener on port 3000 (EACCES) without stopping it. The same complete suite
  with supported `PRODUCTION_TEST_PORT=3025` passed 8/8, including source-free
  runtime, occupied-port rejection, restart and Windows IPC signal handling.
  This does not claim the port-3000 run passed.
  The final successful run explicitly reports its fresh migrated
  `lokka_production_*` database.
- Production build: PASS.
- `npm audit` observation only: 12 findings (1 low, 8 moderate, 1 high,
  2 critical). No install, audit fix, forced fix or dependency change performed.
- `git diff --check`: PASS; no staged files, commit or push.

Owner DB fingerprint before automated suites and after QA: 26 tables, 28 rows,
including all application tables and sequence state, unchanged. SHA-256:
`3b7fed404de204ffb89c2aaa38e4b2caa58b8b3afb68076c54b868f0ebaa241f`.
Two earlier successful production-suite invocations, before the isolation gap
was identified, did briefly create temporary admin/product/category/session
records in the owner database and clean them up. This did not satisfy the
requested isolation rule, despite the unchanged fingerprint and absence of
leftover records. That test fixture is now fixed. A fresh fingerprint was taken
before repeating final verification with isolated production fixtures. An
unchanged fingerprint is not presented as proof that those earlier temporary
writes never happened.

Disposable fixtures were created/migrated before final tests; the browser global
setup supplied a `lokka_browser_*` DB and individual fixtures used
`lokka_verify_*` DBs, with `lokka_production_*` for production. No QA record from
this audit was left in owner data. Public owner-browser checks were
GET-only and used no authenticated session.

## Owner usability matrix

| Area                                          | Gate                                                                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public Storefront                             | READY WITH MINOR ISSUE — favicon-only noise                                                                                                       |
| Customer authentication                       | READY                                                                                                                                             |
| Admin login/navigation                        | READY                                                                                                                                             |
| Admin Product Operations                      | READY                                                                                                                                             |
| Inventory                                     | READY                                                                                                                                             |
| Media                                         | READY                                                                                                                                             |
| Pricing / Global Overhead                     | READY                                                                                                                                             |
| Fulfillment                                   | READY                                                                                                                                             |
| POS login/search/cart/payment/receipt/history | READY                                                                                                                                             |
| Cash Flow                                     | READY                                                                                                                                             |
| Income & Expense                              | READY                                                                                                                                             |
| Accounting Lite                               | READY WITH MINOR ISSUE — a sale lacking configured historical cost correctly has unavailable HPP/profit; configure direct costs before real sales |

Overall functional gate: **READY FOR DAILY USE** for the implemented local
application scope, with the stated cost-data and cosmetic limitations. This is
not production deployment approval or a clean dependency-security audit.
The existing owner Node listener was left running. The fixes are in the rebuilt
checkout; load them through the normal application restart workflow if that
listener does not hot-reload.

Tax Readiness, webstore checkout, DOKU/QRIS and other deferred modules were not
started. No files staged. No commit created. No push performed.

## Changed files and final Git state

Fifteen existing files changed:

- `src/modules/catalog/routes.ts`
- `src/modules/catalog/service.ts`
- `src/modules/catalog/storage.ts`
- `src/modules/pos/routes.ts`
- `src/modules/sales/service.ts`
- `src/routes/index.ts`
- `tests/catalog.test.ts`
- `tests/helpers/accounting-fixture.ts`
- `tests/pos.test.ts`
- `tests/production/server.test.mjs`
- `views/admin/media.ejs`
- `views/pos/history.ejs`
- `views/pos/sale-detail.ejs`
- `web/client/pos.ts`
- `web/client/styles/pos.css`

Three new files:

- `tests/readiness-regressions.test.ts`
- `tests/browser/readiness.spec.ts`
- `docs/functional-readiness-audit.md`

Final status: `main`, same starting HEAD, 15 modified and 3 untracked files.
Staging is empty. No dependency lockfile, environment, owner concept source,
official logo, migration or schema changed. Ignored QA logs, screenshots and
local harnesses are not staged.
