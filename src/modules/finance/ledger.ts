import { listInput, pagination, searchPattern } from '../catalog/listing.js';
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  lt,
  lte,
  sql,
  or,
  ilike,
  count,
} from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Database } from '../../db/client.js';
import { financialTransactions, sales } from '../../db/schema/index.js';
import {
  FormError,
  choice,
  id as validId,
  money,
  textField,
  type Form,
} from '../catalog/validation.js';

// Structured categories: no free-text category strings ever reach the ledger.
export const MANUAL_CATEGORIES_BY_DIRECTION = {
  INCOME: ['PRODUCT_SALES', 'OTHER_INCOME'],
  EXPENSE: [
    'PACKAGING',
    'SUPPLIES',
    'UTILITIES',
    'RENT',
    'SALARIES',
    'MARKETING',
    'TRANSPORT',
    'MAINTENANCE',
    'OTHER_EXPENSE',
  ],
} as const;
export const INCOME_CATEGORIES = MANUAL_CATEGORIES_BY_DIRECTION.INCOME;
export const EXPENSE_CATEGORIES = MANUAL_CATEGORIES_BY_DIRECTION.EXPENSE;
export const CATEGORY_LABELS: Record<string, string> = {
  WEBSTORE_ORDER: 'Webstore order payment',
  PRODUCT_SALES: 'Product sales',
  OTHER_INCOME: 'Other income',
  PACKAGING: 'Packaging',
  SUPPLIES: 'Supplies',
  UTILITIES: 'Utilities',
  RENT: 'Rent',
  SALARIES: 'Salaries & wages',
  MARKETING: 'Marketing',
  TRANSPORT: 'Transport & delivery',
  MAINTENANCE: 'Maintenance',
  OTHER_EXPENSE: 'Other expense',
  OPENING_BALANCE: 'Opening balance',
};
export const SOURCE_LABELS: Record<string, string> = {
  POS: 'POS',
  WEBSTORE: 'Webstore',
  MARKETPLACE: 'Marketplace',
  MANUAL: 'Manual',
};

type Tx = Parameters<Parameters<Database['db']['transaction']>[0]>[0];
type Connection = Database['db'] | Tx;

export type CashFlowPeriod = {
  period: 'today' | 'month' | 'custom';
  from: Date;
  to: Date;
  fromInput: string;
  toInput: string;
};

const DAY_MS = 86_400_000;
const MIN_DATE = Date.parse('2000-01-01T00:00:00.000Z');

export function startOfDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}
export function endOfDay(value: Date): Date {
  return new Date(startOfDay(value).getTime() + DAY_MS - 1);
}
export function dayInput(value: Date): string {
  return value.toISOString().slice(0, 10);
}
export function periodMonthOf(value: Date): string {
  return `${value.toISOString().slice(0, 7)}-01`;
}
function parseDay(value: unknown, field: string): Date {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || !Number.isFinite(Date.parse(raw)))
    throw new FormError(field, 'Choose a valid date.');
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (parsed.toISOString().slice(0, 10) !== raw || parsed < new Date(MIN_DATE))
    throw new FormError(field, 'Choose a valid date.');
  return parsed;
}
/** datetime-local value, interpreted and stored as UTC. */
function dateTimeInput(form: Form, field: string): Date {
  const raw = textField(form, field, 16, true);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw))
    throw new FormError(field, 'Enter a valid date and time.');
  const parsed = new Date(`${raw}:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 16) !== raw ||
    parsed.getTime() < MIN_DATE
  )
    throw new FormError(field, 'Enter a valid date and time.');
  return parsed;
}
function dateTimeInputValue(value: Date): string {
  return value.toISOString().slice(0, 16);
}
/** Today, this month or a custom range. All boundaries are whole UTC days. */
export function resolvePeriod(query: {
  period?: unknown;
  from?: unknown;
  to?: unknown;
}): CashFlowPeriod {
  const kind =
    query.period === 'month'
      ? 'month'
      : query.period === 'custom'
        ? 'custom'
        : 'today';
  if (kind === 'today') {
    const from = startOfDay(new Date());
    return {
      period: 'today',
      from,
      to: endOfDay(from),
      fromInput: dayInput(from),
      toInput: dayInput(from),
    };
  }
  if (kind === 'month') {
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const to = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) - 1,
    );
    return {
      period: 'month',
      from,
      to,
      fromInput: dayInput(from),
      toInput: dayInput(to),
    };
  }
  const from = startOfDay(parseDay(query.from, 'from'));
  const to = endOfDay(parseDay(query.to, 'to'));
  if (from > to)
    throw new FormError('from', 'The start date must not follow the end date.');
  return {
    period: 'custom',
    from,
    to,
    fromInput: dayInput(from),
    toInput: dayInput(to),
  };
}

const signedAmount = sql`case when ${financialTransactions.direction} = 'INCOME' then ${financialTransactions.amountRupiah} else -${financialTransactions.amountRupiah} end`;

async function sumSigned(
  connection: Connection,
  where: ReturnType<typeof and>,
): Promise<bigint> {
  const rows = await connection
    .select({ value: sql<string>`coalesce(sum(${signedAmount}), 0)::text` })
    .from(financialTransactions)
    .where(where);
  return BigInt(rows[0]?.value ?? '0');
}
async function sumAmounts(
  connection: Connection,
  where: ReturnType<typeof and>,
): Promise<bigint> {
  const rows = await connection
    .select({
      value: sql<string>`coalesce(sum(${financialTransactions.amountRupiah}), 0)::text`,
    })
    .from(financialTransactions)
    .where(where);
  return BigInt(rows[0]?.value ?? '0');
}
async function breakdown(
  connection: Connection,
  column: AnyPgColumn,
  where: ReturnType<typeof and>,
): Promise<{ key: string; total: bigint }[]> {
  const rows = await connection
    .select({
      key: column,
      total: sql<string>`coalesce(sum(${financialTransactions.amountRupiah}), 0)::text`,
    })
    .from(financialTransactions)
    .where(where)
    .groupBy(column);
  return rows.map((row) => ({
    key: row.key as string,
    total: BigInt(row.total),
  }));
}

/**
 * Canonical cash ledger. Cash Flow is always derived from these rows —
 * it is never a second transaction table. Global Overhead never lands here:
 * only real posted transactions move cash.
 */
export function createLedger(db: Connection) {
  const posted = eq(financialTransactions.status, 'POSTED');
  const income = eq(financialTransactions.direction, 'INCOME');
  const expense = eq(financialTransactions.direction, 'EXPENSE');

  async function cashFlow(period: CashFlowPeriod) {
    const openingBalance = await sumSigned(
      db,
      and(posted, lt(financialTransactions.occurredAt, period.from)),
    );
    const within = and(
      posted,
      gte(financialTransactions.occurredAt, period.from),
      lte(financialTransactions.occurredAt, period.to),
    );
    const [periodIncome, periodExpenses, bySource, byCategory] =
      await Promise.all([
        sumAmounts(db, and(within, income)),
        sumAmounts(db, and(within, expense)),
        breakdown(db, financialTransactions.source, and(within, income)),
        breakdown(db, financialTransactions.category, and(within, expense)),
      ]);
    const inPeriod = and(
      gte(financialTransactions.occurredAt, period.from),
      lte(financialTransactions.occurredAt, period.to),
    );
    const [transactions, counted] = await Promise.all([
      db
        .select({
          id: financialTransactions.id,
          direction: financialTransactions.direction,
          source: financialTransactions.source,
          type: financialTransactions.type,
          category: financialTransactions.category,
          amountRupiah: financialTransactions.amountRupiah,
          occurredAt: financialTransactions.occurredAt,
          status: financialTransactions.status,
          voidReason: financialTransactions.voidReason,
          notes: financialTransactions.notes,
          saleId: financialTransactions.saleId,
          transactionNumber: sales.transactionNumber,
        })
        .from(financialTransactions)
        .leftJoin(sales, eq(financialTransactions.saleId, sales.id))
        .where(inPeriod)
        .orderBy(
          desc(financialTransactions.occurredAt),
          desc(financialTransactions.createdAt),
        )
        .limit(200),
      db
        .select({ count: sql<string>`count(*)::int` })
        .from(financialTransactions)
        .where(inPeriod),
    ]);
    const net = periodIncome - periodExpenses;
    return {
      period,
      openingBalance,
      income: periodIncome,
      expenses: periodExpenses,
      net,
      endingBalance: openingBalance + net,
      bySource: bySource.sort((a, b) => (a.key < b.key ? -1 : 1)),
      byCategory: byCategory.sort((a, b) => (a.key < b.key ? -1 : 1)),
      transactions,
      transactionCount: counted[0]?.count ?? 0,
    };
  }

  async function openingBalances() {
    return db
      .select({
        id: financialTransactions.id,
        amountRupiah: financialTransactions.amountRupiah,
        occurredAt: financialTransactions.occurredAt,
        status: financialTransactions.status,
        voidReason: financialTransactions.voidReason,
        notes: financialTransactions.notes,
      })
      .from(financialTransactions)
      .where(eq(financialTransactions.type, 'OPENING_BALANCE'))
      .orderBy(desc(financialTransactions.occurredAt));
  }

  /** Manual history plus read-only automated POS context. */
  async function history(query: Record<string, unknown> = {}) {
    const input = listInput(query);
    const pattern = searchPattern(input.q);
    const categoryKeys = Object.entries(CATEGORY_LABELS)
      .filter(
        ([key, label]) =>
          key.toLowerCase().includes(input.q.toLowerCase()) ||
          label.toLowerCase().includes(input.q.toLowerCase()),
      )
      .map(([key]) => key);
    const condition = and(
      inArray(financialTransactions.type, [
        'MANUAL',
        'OPENING_BALANCE',
        'REVENUE',
        'SHIPPING_EXPENSE',
      ]),
      input.q
        ? or(
            ilike(financialTransactions.notes, pattern),
            ilike(sales.transactionNumber, pattern),
            sql`${financialTransactions.id}::text ILIKE ${pattern}`,
            sql`${financialTransactions.category}::text ILIKE ${pattern}`,
            categoryKeys.length
              ? sql`${financialTransactions.category}::text IN (${sql.join(
                  categoryKeys.map((key) => sql`${key}`),
                  sql`, `,
                )})`
              : undefined,
          )
        : undefined,
    );
    const rows = await db
      .select({
        id: financialTransactions.id,
        direction: financialTransactions.direction,
        source: financialTransactions.source,
        type: financialTransactions.type,
        category: financialTransactions.category,
        amountRupiah: financialTransactions.amountRupiah,
        occurredAt: financialTransactions.occurredAt,
        status: financialTransactions.status,
        voidReason: financialTransactions.voidReason,
        notes: financialTransactions.notes,
        transactionNumber: sales.transactionNumber,
      })
      .from(financialTransactions)
      .leftJoin(sales, eq(financialTransactions.saleId, sales.id))
      .where(condition)
      .orderBy(
        desc(financialTransactions.occurredAt),
        desc(financialTransactions.id),
      )
      .limit(input.limit)
      .offset(input.offset);
    const [total] = await db
      .select({ value: count() })
      .from(financialTransactions)
      .leftJoin(sales, eq(financialTransactions.saleId, sales.id))
      .where(condition);
    return {
      manual: rows.filter((row) => row.type !== 'REVENUE'),
      automated: rows.filter((row) => row.type === 'REVENUE'),
      listing: pagination(total!.value, input, '/admin/finance/income-expense'),
    };
  }

  async function recordManual(form: Form, adminId: string) {
    const direction = choice(form, 'direction', ['INCOME', 'EXPENSE']);
    const requestedCategory = textField(form, 'category');
    const category = MANUAL_CATEGORIES_BY_DIRECTION[direction].find(
      (value) => value === requestedCategory,
    );
    if (!category)
      throw new FormError(
        'category',
        'Pilihan tidak valid. Pilih kategori yang sesuai dengan tipe transaksi (Income/Expense).',
      );
    const amountRupiah = money(form, 'amountRupiah')!;
    const occurredAt = dateTimeInput(form, 'occurredAt');
    const notes = textField(form, 'notes', 2000) || null;
    const [row] = await db
      .insert(financialTransactions)
      .values({
        source: 'MANUAL',
        direction,
        type: 'MANUAL',
        category,
        amountRupiah,
        occurredAt,
        periodMonth: periodMonthOf(occurredAt),
        status: 'POSTED',
        createdBy: adminId,
        notes,
      })
      .returning({ id: financialTransactions.id });
    if (!row) throw new FormError('amountRupiah', 'Transaction was not saved.');
    return row;
  }

  async function voidTransaction(
    form: Form,
    transactionId: string,
    adminId: string,
  ) {
    const reason = textField(form, 'reason', 2000, true);
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(financialTransactions)
        .where(eq(financialTransactions.id, validId(transactionId)))
        .for('update');
      if (!row) throw new FormError('id', 'Transaction not found.');
      if (row.status === 'VOIDED')
        throw new FormError('id', 'This transaction is already voided.');
      if (row.type === 'REVENUE' || row.type === 'CASH_INFLOW')
        throw new FormError(
          'id',
          'POS-generated income is read-only. Correct the sale instead.',
        );
      if (row.type === 'SHIPPING_EXPENSE')
        throw new FormError(
          'id',
          'This expense was finalized with its shipment.',
        );
      await tx
        .update(financialTransactions)
        .set({
          status: 'VOIDED',
          voidReason: reason,
          voidedAt: new Date(),
          voidedById: adminId,
        })
        .where(eq(financialTransactions.id, row.id));
      return row;
    });
  }

  async function setOpeningBalance(form: Form, adminId: string) {
    const amountRupiah = money(form, 'amountRupiah')!;
    const occurredAt = dateTimeInput(form, 'occurredAt');
    const notes = textField(form, 'notes', 2000) || 'Initial cash balance';
    return db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: financialTransactions.id })
        .from(financialTransactions)
        .where(
          and(
            eq(financialTransactions.type, 'OPENING_BALANCE'),
            eq(financialTransactions.status, 'POSTED'),
          ),
        )
        .limit(1);
      if (existing)
        throw new FormError(
          'amountRupiah',
          'An opening balance is already recorded. Void it first to record a corrected balance.',
        );
      const [row] = await tx
        .insert(financialTransactions)
        .values({
          source: 'MANUAL',
          direction: 'INCOME',
          type: 'OPENING_BALANCE',
          category: 'OPENING_BALANCE',
          amountRupiah,
          occurredAt,
          periodMonth: periodMonthOf(occurredAt),
          status: 'POSTED',
          createdBy: adminId,
          notes,
        })
        .returning({ id: financialTransactions.id });
      if (!row) throw new FormError('amountRupiah', 'Balance was not saved.');
      return row;
    });
  }

  return {
    cashFlow,
    openingBalances,
    history,
    recordManual,
    voidTransaction,
    setOpeningBalance,
    dateTimeInputValue,
  };
}
export type Ledger = ReturnType<typeof createLedger>;

/**
 * One POS/webstore sale records income exactly once, inside the sale
 * transaction. ON CONFLICT DO NOTHING keeps an idempotent retry silent while
 * the partial unique index blocks a second posted income row per sale.
 */
export async function insertSaleIncome(
  connection: Connection,
  input: {
    saleId: string;
    // Only automated sale sources may carry a sale reference; manual rows
    // never do (enforced by financial_transactions_sale_reference).
    source: 'POS' | 'WEBSTORE' | 'MARKETPLACE';
    category?: 'PRODUCT_SALES' | 'WEBSTORE_ORDER';
    amountRupiah: bigint;
    occurredAt: Date;
    notes?: string;
  },
): Promise<void> {
  await connection
    .insert(financialTransactions)
    .values({
      saleId: input.saleId,
      source: input.source,
      direction: 'INCOME',
      type: 'REVENUE',
      category: input.category ?? 'PRODUCT_SALES',
      amountRupiah: input.amountRupiah,
      occurredAt: input.occurredAt,
      periodMonth: periodMonthOf(input.occurredAt),
      status: 'POSTED',
      notes: input.notes ?? null,
      createdAt: input.occurredAt,
    })
    .onConflictDoNothing();
}
