# 006. Accounting Lite

Status: accepted, Phase D2.

Cash Flow measures cash movements; accounting profit measures completed sales,
their historical direct costs and actual operating expenses. These reports are
separate derived views of canonical facts, with no second revenue ledger.

- Revenue is `sales.total` for completed POS and WEBSTORE sales, dated by
  `sales.created_at` (the current completion path inserts the completed sale).
  Tendered cash, change, opening balances and finance income rows never add
  revenue again. A future flow that creates pending sales before completion
  must introduce an authoritative completion timestamp before using that flow
  for accounting periods.
- HPP is quantity × `sale_items.cost_snapshot`, a whole-Rupiah unit direct cost.
  The existing nullable column was present but unused by sale completion. New
  sales now snapshot the sum of configured product direct-cost components in
  the sale transaction, under the product lock shared by cost writers. There
  is no variant-specific cost model. No new table or migration is needed.
  Catalog cost changes never recalculate sold-line snapshots.
- Missing historical snapshots remain unknown; old sales are never backfilled
  from today's costs. If any included line lacks a snapshot, or a completed
  sale has no items, total HPP and both profit figures are unavailable. Known
  HPP and missing counts remain visible. No configured components also means
  unknown; a configured zero component is a valid zero unit cost.
- Operating expenses are posted MANUAL / EXPENSE transactions in the existing
  structured operating expense categories. VOIDED rows, opening balances,
  automatic sale income and future transfer types do not contribute. Void audit
  history remains in Income & Expense. Record only actual operating expenses;
  costs already recognized in sold-item HPP must not be entered again as
  operating expenses.
- Both existing manual income categories, PRODUCT_SALES and OTHER_INCOME, are
  explicitly cash-only for accounting. Their category names do not establish
  accounting revenue. Capital, loans and reimbursements must not be inferred
  as sales. Recognizing any future non-sales accounting revenue requires an
  explicit classification and policy; no automatic inclusion is provided.
- Gross Profit = Revenue − HPP. Net Profit = Gross Profit − Operating Expenses.
  PostgreSQL aggregates numeric integers (including quantity multiplication);
  service amounts are bigint. Any future JSON money must be decimal strings.
- Today, This month and Custom range reuse Cash Flow's whole UTC day boundaries
  and validation. The UI explicitly labels UTC. This preserves existing period
  behavior rather than introducing another timezone convention.
- Global Overhead is pricing and recovery planning. It is never automatically
  deducted from HPP or profit. Actual rent, utilities etc. affect accounting
  only after posting an expense.
- `/admin/finance/accounting` is a read-only EJS Back Office page under existing
  active database admin sessions, no-store and noindex. It displays all-period
  SQL totals, source/category breakdowns and bounded recent sale, item and
  expense references, with the display limits stated beside each table.
  The report uses one repeatable-read snapshot. Existing date and relationship
  indexes support these queries; no speculative indexes were added.

WEBSTORE sales use the same source-independent HPP and revenue rules; checkout
is deferred. Tax Readiness, tax calculations, double-entry journals, balance
sheets, receivables and payables are deferred. No new tax navigation is exposed.

Verification uses fresh migrated `lokka_verify_*` PostgreSQL databases. The
browser suite first creates its own `lokka_browser_*` database and hands that
URL to all workers; Accounting Lite additionally uses its own disposable
fixture. Neither seeding nor sale/expense mutations target the owner database.
