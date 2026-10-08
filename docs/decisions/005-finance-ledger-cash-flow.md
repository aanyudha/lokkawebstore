# 005. Financial transaction foundation and Cash Flow

Status: accepted, Phase D1.

## Context

POS completion already wrote `financial_transactions` rows, but each sale wrote
two of them (`REVENUE` for the sale total and `CASH_INFLOW` for cash tendered).
Summing the table therefore counted one sale twice — Rp795.000 became
Rp1.590.000. There was no expense direction, no manual entry, no opening
balance and no Cash Flow view, while Global Overhead already existed as a
costing/planning model that must not be mistaken for money spent.

## Decision

1. **One canonical ledger.** `financial_transactions` is extended, never
   duplicated. Cash Flow, Accounting Lite and Tax Readiness are all derived
   from it. Cash Flow is never a second transaction table.
2. **Semantics per row.** `direction` (INCOME | EXPENSE), `source`
   (POS | WEBSTORE | MARKETPLACE | MANUAL), `type`
   (REVENUE | CASH_INFLOW | MANUAL | OPENING_BALANCE), `category` (structured
   pgEnum), `occurred_at`, `period_month`, `status` (POSTED | VOIDED),
   `created_by`, `void_reason` / `voided_at` / `voided_by_id`, optional
   `sale_id`.
3. **Exactly one income per sale.** POS completion posts a single
   `REVENUE` row inside the sale transaction via `insertSaleIncome`, with
   `ON CONFLICT DO NOTHING` on top of a partial unique index
   (`POSTED` + `INCOME` + `sale_id IS NOT NULL`). Cash tendered and change
   remain in `sale_payments`; they never become a second ledger row.
   Legacy `CASH_INFLOW` rows were voided with a reason, not deleted.
4. **Audit-safe history.** Nothing is hard-deleted. Wrong manual entries are
   voided with a required reason; voided rows stay visible and are excluded
   from every total. POS rows are read-only in the Finance UI.
5. **Opening balance is a ledger event.** One `OPENING_BALANCE` entry records
   the cash actually held before tracking began. Opening Balance for a period
   = sum of valid posted movements before the period start; Ending Balance =
   Opening Balance + Income − Expenses. No display-only setting stores it.
6. **Global Overhead stays out of Cash Flow.** Overhead periods are pricing
   assumptions and recovery planning. Only posted ledger rows move cash.
7. **Manual categories are structured.** Income: PRODUCT_SALES, OTHER_INCOME.
   Expense: PACKAGING, SUPPLIES, UTILITIES, RENT, SALARIES, MARKETING,
   TRANSPORT, MAINTENANCE, OTHER_EXPENSE. No free-text category strings.

## Cash Flow is not profit and loss

Cash Flow counts money that moved (cash basis). Profit and Loss counts
accruals, cost recognition and allocations. Accounting Lite is deliberately
deferred; no P&L, COGS or tax figure is computed here.

## Tax readiness contract (not implemented)

Factual fields are preserved for later: `source`, `occurred_at`, income
amount, business reference (`sale_id` → `sales.transaction_number`) and
`status`. No tax rate is stored or calculated.

## WEBSTORE compatibility

`source = WEBSTORE` already exists in the `sale_source` enum and requires no
cashier, tender or change columns. Checkout is not implemented; a future
webstore payment posts into this same ledger.

## Consequences

- `/admin/finance/cash-flow` and `/admin/finance/income-expense` are
  admin-only, session/CSRF/origin protected, no-store and noindex like the
  rest of the back office.
- Aggregation happens in SQL (opening/income/expense sums plus grouped
  breakdowns) with a bounded transaction list; history is not shipped whole
  to the browser.
- Migration `0008_finance_cash_flow.sql` is additive for data: it renames
  `sale_date` → `occurred_at`, adds columns, backfills, voids legacy
  duplicates and then adds constraints/indexes. The legacy type check
  constraint is widened in place.
