import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { commercialDatabase } from './helpers/commercial-database.js';
import { createCatalog } from '../src/modules/catalog/service.js';
import { LocalCatalogImageStorage } from '../src/modules/catalog/storage.js';
import { createFinance } from '../src/modules/finance/service.js';
import {
  MANUAL_CATEGORIES_BY_DIRECTION,
  createLedger,
  resolvePeriod,
  insertSaleIncome,
} from '../src/modules/finance/ledger.js';
import { createSalesService } from '../src/modules/sales/service.js';
import {
  adminUsers,
  financialTransactions,
  overheadPeriods,
  products,
  productVariants,
  vendors,
} from '../src/db/schema/index.js';
import { buildApp } from '../src/app.js';
import { readEnv } from '../src/config/env.js';
import { hashPassword } from '../src/modules/auth/service.js';
import type { FastifyInstance } from 'fastify';

let fixture: Awaited<ReturnType<typeof commercialDatabase>>;
let ledger: ReturnType<typeof createLedger>;
let salesService: ReturnType<typeof createSalesService>;
let catalog: ReturnType<typeof createCatalog>;
let app: FastifyInstance;
let cookie = '';
let csrf = '';
let adminId = '';
let variantId = '';
let openingBalanceId = '';

const password = 'temporary-ledger-password';
const email = 'ledger@example.test';
const run = 'ledger-fixture';
const january = resolvePeriod({
  period: 'custom',
  from: '2026-01-01',
  to: '2026-01-31',
});
const february = resolvePeriod({
  period: 'custom',
  from: '2026-02-01',
  to: '2026-02-28',
});
const today = resolvePeriod({ period: 'today' });
const dayBefore = (value: Date) =>
  new Date(value.getTime() - 86_400_000).toISOString().slice(0, 10);
const at = (value: string) => `${value}T10:00`;

const post = (url: string, payload: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url,
    headers: { cookie, origin: 'http://127.0.0.1:3000' },
    payload: { csrf, ...payload },
  });

async function seedVendorAndAdmin(
  db: Awaited<ReturnType<typeof commercialDatabase>>['database']['db'],
  tag: string,
) {
  await db
    .insert(vendors)
    .values({ slug: 'lokka', name: 'LOKKA', status: 'active' })
    .onConflictDoNothing();
  const [admin] = await db
    .insert(adminUsers)
    .values({
      email,
      name: 'Ledger admin',
      passwordHash: await hashPassword(password),
      status: 'active',
    })
    .returning({ id: adminUsers.id });
  const [vendor] = await db
    .select({ id: vendors.id })
    .from(vendors)
    .where(eq(vendors.slug, 'lokka'));
  const [product] = await db
    .insert(products)
    .values({
      vendorId: vendor!.id,
      name: `Ledger product ${tag}`,
      slug: `ledger-product-${tag}`,
      status: 'active',
    })
    .returning({ id: products.id });
  const [variant] = await db
    .insert(productVariants)
    .values({
      productId: product!.id,
      sku: `LGR${tag.slice(0, 8).toUpperCase()}`,
      name: 'M',
      price: 795000n,
      weightGrams: 450,
      stockQuantity: 1000,
      status: 'active',
    })
    .returning({ id: productVariants.id });
  return { adminId: admin!.id, variantId: variant!.id };
}

beforeAll(async () => {
  fixture = await commercialDatabase();
  const seeded = await seedVendorAndAdmin(fixture.database.db, run);
  adminId = seeded.adminId;
  variantId = seeded.variantId;
  ledger = createLedger(fixture.database.db);
  salesService = createSalesService(fixture.database.db);
  catalog = createCatalog(
    fixture.database.db,
    new LocalCatalogImageStorage('storage/tests/finance-cash-flow'),
  );
  app = await buildApp(
    readEnv({
      ...process.env,
      APP_RUNTIME: 'fastify',
      DATABASE_URL: fixture.url,
      NODE_ENV: 'test',
      APP_URL: 'http://127.0.0.1:3000',
    }),
    { database: { ...fixture.database, close: async () => {} }, logger: false },
  );
  const login = await app.inject('/admin/login');
  const loginCsrf = login.cookies.find(
    (c) => c.name === 'lokka_login_csrf',
  )!.value;
  const response = await app.inject({
    method: 'POST',
    url: '/admin/login',
    cookies: { lokka_login_csrf: loginCsrf },
    payload: { csrf: loginCsrf, email, password },
  });
  expect(response.statusCode).toBe(303);
  cookie = response.cookies
    .filter((c) => c.value)
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  csrf = response.cookies.find((c) => c.name === 'lokka_admin_csrf')!.value;
}, 60000);

afterAll(async () => {
  await app?.close();
  await fixture?.cleanup();
}, 60000);

describe('financial transaction foundation', () => {
  it('records the initial cash balance as an auditable ledger event', async () => {
    const row = await ledger.setOpeningBalance(
      {
        amountRupiah: '1000000',
        occurredAt: '2025-12-31T09:00',
        notes: 'Cash on hand before tracking',
      },
      adminId,
    );
    openingBalanceId = row.id;
    const [stored] = await fixture.database.db
      .select()
      .from(financialTransactions)
      .where(eq(financialTransactions.id, openingBalanceId));
    expect(stored!.type).toBe('OPENING_BALANCE');
    expect(stored!.direction).toBe('INCOME');
    expect(stored!.source).toBe('MANUAL');
    expect(stored!.status).toBe('POSTED');
    expect(stored!.amountRupiah).toBe(1000000n);
    expect(stored!.createdBy).toBe(adminId);
    expect(stored!.saleId).toBeNull();
    expect(typeof stored!.amountRupiah).toBe('bigint');

    // One live opening balance only: a second must be refused.
    await expect(
      ledger.setOpeningBalance(
        { amountRupiah: '2000000', occurredAt: '2025-12-31T09:00' },
        adminId,
      ),
    ).rejects.toThrow('already recorded');
  });

  it('records manual income and manual expense with structured categories', async () => {
    const expense = await ledger.recordManual(
      {
        direction: 'EXPENSE',
        category: 'PACKAGING',
        amountRupiah: '50000',
        occurredAt: at('2026-01-15'),
        notes: 'Packaging restock',
      },
      adminId,
    );
    const income = await ledger.recordManual(
      {
        direction: 'INCOME',
        category: 'OTHER_INCOME',
        amountRupiah: '25000',
        occurredAt: at('2026-01-15'),
        notes: 'Offline service fee',
      },
      adminId,
    );
    const rows = await fixture.database.db
      .select()
      .from(financialTransactions)
      .where(eq(financialTransactions.type, 'MANUAL'));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.status).toBe('POSTED');
      expect(row.source).toBe('MANUAL');
      expect(row.saleId).toBeNull();
      expect(row.createdBy).toBe(adminId);
      expect(typeof row.amountRupiah).toBe('bigint');
      expect(row.periodMonth).toBe('2026-01-01');
    }
    expect(rows.find((r) => r.id === expense.id)!.amountRupiah).toBe(50000n);
    expect(rows.find((r) => r.id === income.id)!.amountRupiah).toBe(25000n);
  });

  it('rejects inconsistent direction, category, amount and date input', async () => {
    const base = {
      direction: 'EXPENSE',
      amountRupiah: '50000',
      occurredAt: at('2026-01-16'),
    };
    await expect(
      ledger.recordManual({ ...base, category: 'PRODUCT_SALES' }, adminId),
    ).rejects.toThrow('Pilihan tidak valid');
    await expect(
      ledger.recordManual(
        { ...base, direction: 'INCOME', category: 'PACKAGING' },
        adminId,
      ),
    ).rejects.toThrow('Pilihan tidak valid');
    await expect(
      ledger.recordManual(
        { ...base, category: 'PACKAGING', amountRupiah: '12.5' },
        adminId,
      ),
    ).rejects.toThrow('Masukkan Rupiah bulat lebih dari nol.');
    await expect(
      ledger.recordManual(
        { ...base, category: 'PACKAGING', amountRupiah: '0' },
        adminId,
      ),
    ).rejects.toThrow('Masukkan Rupiah bulat lebih dari nol.');
    await expect(
      ledger.recordManual(
        { ...base, category: 'PACKAGING', occurredAt: 'not-a-date' },
        adminId,
      ),
    ).rejects.toThrow('valid date and time');
    await expect(
      ledger.recordManual(
        { ...base, category: 'PACKAGING', occurredAt: '2026-02-30T10:00' },
        adminId,
      ),
    ).rejects.toThrow('valid date and time');
  });

  it('keeps money in bigint whole Rupiah (no floating point)', async () => {
    const amount = '9007199254740993'; // 2^53 + 1: a float would round this.
    const row = await ledger.recordManual(
      {
        direction: 'INCOME',
        category: 'PRODUCT_SALES',
        amountRupiah: amount,
        occurredAt: at('2026-01-20'),
        notes: 'Large marketplace settlement',
      },
      adminId,
    );
    const [stored] = await fixture.database.db
      .select({ amount: financialTransactions.amountRupiah })
      .from(financialTransactions)
      .where(eq(financialTransactions.id, row.id));
    expect(stored!.amount).toBe(9007199254740993n);
    expect(stored!.amount).not.toBe(BigInt(Number(amount)));
    const summary = await ledger.cashFlow(january);
    expect(typeof summary.income).toBe('bigint');
    expect(summary.income).toBe(9007199254740993n + 25000n);
    expect(summary.expenses).toBe(50000n);
    expect(summary.openingBalance).toBe(1000000n);
    expect(summary.net).toBe(summary.income - summary.expenses);
    expect(summary.endingBalance).toBe(summary.openingBalance + summary.net);
  });

  it('derives opening balance, income, expenses, net and ending balance per period', async () => {
    const summary = await ledger.cashFlow(january);
    expect(summary.openingBalance).toBe(1000000n);
    expect(summary.income).toBe(9007199254740993n + 25000n);
    expect(summary.expenses).toBe(50000n);
    expect(summary.net).toBe(summary.income - 50000n);
    expect(summary.endingBalance).toBe(summary.openingBalance + summary.net);
    // Income by source, expenses by category.
    expect(summary.bySource.map((r) => [r.key, r.total])).toEqual([
      ['MANUAL', 9007199254740993n + 25000n],
    ]);
    expect(summary.byCategory.map((r) => [r.key, r.total])).toEqual([
      ['PACKAGING', 50000n],
    ]);
    // The transaction list must reconcile with the totals.
    const posted = summary.transactions.filter((t) => t.status === 'POSTED');
    const income = posted
      .filter((t) => t.direction === 'INCOME')
      .reduce((sum, t) => sum + t.amountRupiah, 0n);
    const expenses = posted
      .filter((t) => t.direction === 'EXPENSE')
      .reduce((sum, t) => sum + t.amountRupiah, 0n);
    expect(income).toBe(summary.income);
    expect(expenses).toBe(summary.expenses);
    expect(summary.transactionCount).toBe(summary.transactions.length);
  });

  it('filters periods: custom range, this month and opening balance before the range', async () => {
    const empty = await ledger.cashFlow(
      resolvePeriod({ period: 'custom', from: '2024-01-01', to: '2024-12-31' }),
    );
    expect(empty.openingBalance).toBe(0n);
    expect(empty.income).toBe(0n);
    expect(empty.expenses).toBe(0n);
    expect(empty.endingBalance).toBe(0n);
    expect(empty.transactions).toHaveLength(0);

    const januaryBefore = await ledger.cashFlow(january);
    const februarySummary = await ledger.cashFlow(february);
    expect(februarySummary.openingBalance).toBe(januaryBefore.endingBalance);
    expect(februarySummary.income).toBe(0n);

    const month = await ledger.cashFlow(resolvePeriod({ period: 'month' }));
    expect(month.period.period).toBe('month');
    expect(month.period.from.getUTCDate()).toBe(1);
    expect(month.period.from.getTime()).toBeLessThan(month.period.to.getTime());
    expect(month.openingBalance).toBe(januaryBefore.endingBalance);
    expect(month.income).toBe(0n);
    expect(month.expenses).toBe(0n);
    expect(month.bySource).toEqual([]);
    expect(month.endingBalance).toBe(month.openingBalance);
  });

  it('posts exactly one finance income for a completed POS sale', async () => {
    const result = await salesService.completeSale({
      source: 'POS',
      cashierId: adminId,
      items: [{ variantId, quantity: 1 }],
      cashTendered: 800000n,
    });
    expect(result.total).toBe(795000n);
    const rows = await fixture.database.db
      .select()
      .from(financialTransactions)
      .where(eq(financialTransactions.saleId, result.saleId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.direction).toBe('INCOME');
    expect(rows[0]!.type).toBe('REVENUE');
    expect(rows[0]!.source).toBe('POS');
    expect(rows[0]!.status).toBe('POSTED');
    expect(rows[0]!.amountRupiah).toBe(795000n);
    expect(rows[0]!.occurredAt).toBeInstanceOf(Date);
    // Cash tendered (800.000) and change never become a second ledger row.
    const postedSum = rows
      .filter((r) => r.status === 'POSTED')
      .reduce((sum, r) => sum + r.amountRupiah, 0n);
    expect(postedSum).toBe(795000n);

    const summary = await ledger.cashFlow(today);
    expect(summary.bySource.find((r) => r.key === 'POS')?.total).toBe(795000n);
    const listed = summary.transactions.find((t) => t.saleId === result.saleId);
    expect(listed?.transactionNumber).toBe(result.transactionNumber);
    expect(listed?.source).toBe('POS');
  }, 30000);

  it('never duplicates POS income on retry and blocks a second posted row', async () => {
    const [entry] = await fixture.database.db
      .select()
      .from(financialTransactions)
      .where(eq(financialTransactions.type, 'REVENUE'))
      .orderBy(sql`created_at`)
      .limit(1);
    expect(entry).toBeTruthy();
    // Idempotent retry of the same sale income.
    await insertSaleIncome(fixture.database.db, {
      saleId: entry!.saleId!,
      source: 'POS',
      amountRupiah: entry!.amountRupiah,
      occurredAt: entry!.occurredAt,
      notes: entry!.notes ?? undefined,
    });
    const rows = await fixture.database.db
      .select()
      .from(financialTransactions)
      .where(eq(financialTransactions.saleId, entry!.saleId!));
    expect(rows).toHaveLength(1);

    // Database-level protection: a second posted income row is impossible.
    await expect(
      fixture.database.db.insert(financialTransactions).values({
        saleId: entry!.saleId!,
        source: 'POS',
        direction: 'INCOME',
        type: 'MANUAL',
        category: 'PRODUCT_SALES',
        amountRupiah: 795000n,
        occurredAt: new Date(),
        periodMonth: '2026-10-01',
        status: 'POSTED',
      }),
    ).rejects.toThrow();
    expect(
      (
        await fixture.database.db
          .select()
          .from(financialTransactions)
          .where(eq(financialTransactions.saleId, entry!.saleId!))
      ).length,
    ).toBe(1);
  });

  it('treats POS-generated finance entries as read-only in the Finance UI', async () => {
    const [posEntry] = await fixture.database.db
      .select({ id: financialTransactions.id })
      .from(financialTransactions)
      .where(eq(financialTransactions.type, 'REVENUE'));
    const rejected = await post(
      `/admin/finance/income-expense/${posEntry!.id}/void`,
      { reason: 'Trying to void system income' },
    );
    expect(rejected.statusCode).toBe(422);
    expect(rejected.body).toContain('read-only');
    const [stillPosted] = await fixture.database.db
      .select({ status: financialTransactions.status })
      .from(financialTransactions)
      .where(eq(financialTransactions.id, posEntry!.id));
    expect(stillPosted!.status).toBe('POSTED');
  });

  it('keeps Global Overhead out of Cash Flow', async () => {
    const before = await ledger.cashFlow(january);
    const finance = createFinance(fixture.database.db, catalog);
    await finance.saveOverhead({
      name: 'Electricity allocation',
      category: 'FACILITY',
      amountRupiah: '1500000',
      billingFrequency: 'MONTHLY',
      recognitionMethod: 'SPREAD_MONTHLY',
      startDate: '2026-01-01',
      active: 'on',
      notes: 'Planned allocation, not a payment',
    });
    await finance.openPeriod({
      periodMonth: '2026-03',
      forecastUnitsRemaining: '100',
    });
    const periods = await fixture.database.db
      .select()
      .from(overheadPeriods)
      .where(eq(overheadPeriods.periodMonth, '2026-03-01'));
    expect(periods).toHaveLength(1);
    const after = await ledger.cashFlow(january);
    expect(after.openingBalance).toBe(before.openingBalance);
    expect(after.income).toBe(before.income);
    expect(after.expenses).toBe(before.expenses);
    expect(after.endingBalance).toBe(before.endingBalance);
    expect(after.byCategory).toEqual(before.byCategory);
  }, 30000);

  it('voids a wrong manual entry with a reason and excludes it from totals', async () => {
    const rent = await ledger.recordManual(
      {
        direction: 'EXPENSE',
        category: 'RENT',
        amountRupiah: '75000',
        occurredAt: at('2026-01-22'),
        notes: 'Warehouse rent',
      },
      adminId,
    );
    expect((await ledger.cashFlow(january)).expenses).toBe(125000n);
    await ledger.voidTransaction(
      { reason: 'Entered twice by mistake' },
      rent.id,
      adminId,
    );
    const [voided] = await fixture.database.db
      .select()
      .from(financialTransactions)
      .where(eq(financialTransactions.id, rent.id));
    expect(voided!.status).toBe('VOIDED');
    expect(voided!.voidReason).toBe('Entered twice by mistake');
    expect(voided!.voidedAt).toBeInstanceOf(Date);
    expect(voided!.voidedById).toBe(adminId);
    const summary = await ledger.cashFlow(january);
    expect(summary.expenses).toBe(50000n);
    expect(summary.byCategory.map((r) => [r.key, r.total])).toEqual([
      ['PACKAGING', 50000n],
    ]);
    // The voided row stays visible in the list, marked and excluded.
    const listed = summary.transactions.find((t) => t.id === rent.id);
    expect(listed?.status).toBe('VOIDED');
    await expect(
      ledger.voidTransaction({ reason: 'Again' }, rent.id, adminId),
    ).rejects.toThrow('already voided');
  });

  it('supports WEBSTORE as a future source without cashier or tender fields', async () => {
    const [row] = await fixture.database.db
      .insert(financialTransactions)
      .values({
        source: 'WEBSTORE',
        direction: 'INCOME',
        type: 'MANUAL',
        category: 'PRODUCT_SALES',
        amountRupiah: 300000n,
        occurredAt: new Date('2026-02-10T12:00:00.000Z'),
        periodMonth: '2026-02-01',
        status: 'POSTED',
        notes: 'Future webstore settlement',
        createdBy: adminId,
      })
      .returning({ id: financialTransactions.id });
    expect(row).toBeTruthy();
    const summary = await ledger.cashFlow(february);
    expect(summary.income).toBe(300000n);
    expect(summary.bySource.map((r) => [r.key, r.total])).toEqual([
      ['WEBSTORE', 300000n],
    ]);
    expect(summary.endingBalance).toBe(
      (await ledger.cashFlow(january)).endingBalance + 300000n,
    );
  });
});

describe('finance admin routes', () => {
  it('serves Cash Flow and Income & Expense only to signed-in admins', async () => {
    const anonymous = await app.inject('/admin/finance/cash-flow');
    expect(anonymous.statusCode).toBe(303);
    expect(anonymous.headers.location).toBe('/admin/login');
    for (const path of [
      '/admin/finance/cash-flow',
      '/admin/finance/income-expense',
    ]) {
      const response = await app.inject({
        url: path,
        headers: { cookie },
      });
      expect(response.statusCode, path).toBe(200);
      expect(response.headers['cache-control']).toContain('no-store');
      expect(response.headers['x-robots-tag']).toContain('noindex');
      expect(response.body).toContain('data-admin-layout="backoffice"');
      expect(response.body.match(/<h1\b/g)).toHaveLength(1);
    }
    const blocked = await app.inject({
      method: 'POST',
      url: '/admin/finance/income-expense',
      headers: { cookie, origin: 'http://127.0.0.1:3000' },
      payload: {
        direction: 'EXPENSE',
        category: 'PACKAGING',
        amountRupiah: '1000',
        occurredAt: '2026-03-01T10:00',
      },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.body).toContain('Access denied');
  });

  it('renders only categories for the selected direction and rejects every incompatible pair without a write', async () => {
    const count = async () => {
      const [row] = await fixture.database.db
        .select({ count: sql<string>`count(*)::text` })
        .from(financialTransactions);
      return row!.count;
    };
    const before = await count();
    const initial = await app.inject({
      url: '/admin/finance/income-expense',
      headers: { cookie },
    });
    const categories = (html: string) =>
      [
        ...html.matchAll(
          /<select name="category" required>([\s\S]*?)<\/select>/g,
        ),
      ][0]![1]!;
    const optionValues = (html: string) =>
      [...categories(html).matchAll(/<option value="([^"]+)"/g)].map(
        (match) => match[1],
      );
    expect(optionValues(initial.body)).toEqual(
      MANUAL_CATEGORIES_BY_DIRECTION.INCOME,
    );
    for (const direction of ['INCOME', 'EXPENSE'] as const) {
      const incompatible =
        MANUAL_CATEGORIES_BY_DIRECTION[
          direction === 'INCOME' ? 'EXPENSE' : 'INCOME'
        ];
      for (const category of incompatible) {
        const response = await post('/admin/finance/income-expense', {
          direction,
          category,
          amountRupiah: '1000',
          occurredAt: '2026-02-11T09:00',
        });
        expect(response.statusCode, `${direction} + ${category}`).toBe(422);
        expect(response.body).toContain('role="alert"');
        expect(optionValues(response.body)).toEqual(
          MANUAL_CATEGORIES_BY_DIRECTION[direction],
        );
        expect(categories(response.body)).not.toContain('selected');
      }
    }
    expect(await count()).toBe(before);
  });

  it('adds a manual expense through the admin form and reflects it in Cash Flow', async () => {
    const created = await post('/admin/finance/income-expense', {
      direction: 'EXPENSE',
      category: 'TRANSPORT',
      amountRupiah: '30000',
      occurredAt: '2026-02-11T09:00',
      notes: 'Delivery fuel',
    });
    expect(created.statusCode).toBe(303);
    expect(created.headers.location).toBe('/admin/finance/income-expense');
    const februarySummary = await ledger.cashFlow(february);
    expect(februarySummary.expenses).toBe(30000n);
    expect(februarySummary.byCategory.map((r) => [r.key, r.total])).toEqual([
      ['TRANSPORT', 30000n],
    ]);
    expect(februarySummary.endingBalance).toBe(
      februarySummary.openingBalance + 270000n,
    );

    const page = await app.inject({
      url: '/admin/finance/cash-flow?period=custom&from=2026-02-01&to=2026-02-28',
      headers: { cookie },
    });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('data-cash-income');
    expect(page.body).toContain('Rp300.000');
    expect(page.body).toContain('Rp30.000');
    expect(page.body).toContain('Delivery fuel');
    expect(page.body).toContain('data-source="WEBSTORE"');
    expect(page.body).toContain('data-category="TRANSPORT"');
    expect(page.body).toContain('Opening Balance');
    expect(page.body).toContain('Ending Balance');
    expect(page.body).toMatch(/not profit and loss/i);
    // Invalid form data is preserved with an error.
    const invalid = await post('/admin/finance/income-expense', {
      direction: 'EXPENSE',
      category: 'PACKAGING',
      amountRupiah: '15.75',
      occurredAt: '2026-02-11T09:00',
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.body).toContain('role="alert"');
    expect(invalid.body).toContain('15.75');
  });

  it('shows manual history and read-only POS income in Income & Expense', async () => {
    const page = await app.inject({
      url: '/admin/finance/income-expense',
      headers: { cookie },
    });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Add transaction');
    expect(page.body).toContain('Packaging restock');
    expect(page.body).toContain('Delivery fuel');
    expect(page.body).toContain('POS income — system generated, read-only');
    expect(page.body).toContain('data-pos-income');
    expect(page.body).toContain('VOIDED');
    expect(page.body).toContain('Entered twice by mistake');
    // The sidebar now exposes the finance section.
    expect(page.body).toContain('href="/admin/finance/cash-flow"');
    expect(page.body).toContain('href="/admin/finance/income-expense"');
    expect(page.body).toContain('href="/admin/finance/overhead"');
    expect(page.body).toContain('href="/admin/finance/accounting"');
  });
});

describe('critical cash flow example', () => {
  it('ends at Rp1.745.000 from Rp1.000.000 opening, Rp795.000 POS income and Rp50.000 expense', async () => {
    const isolated = await commercialDatabase();
    try {
      const seeded = await seedVendorAndAdmin(isolated.database.db, 'qa00001');
      const isolatedLedger = createLedger(isolated.database.db);
      const isolatedSales = createSalesService(isolated.database.db);
      await isolatedLedger.setOpeningBalance(
        {
          amountRupiah: '1000000',
          occurredAt: `${dayBefore(today.from)}T00:00`,
          notes: 'Initial cash',
        },
        seeded.adminId,
      );
      const sale = await isolatedSales.completeSale({
        source: 'POS',
        cashierId: seeded.adminId,
        items: [{ variantId: seeded.variantId, quantity: 1 }],
        cashTendered: 795000n,
      });
      await isolatedLedger.recordManual(
        {
          direction: 'EXPENSE',
          category: 'PACKAGING',
          amountRupiah: '50000',
          occurredAt: new Date().toISOString().slice(0, 16),
          notes: 'Packaging',
        },
        seeded.adminId,
      );
      const summary = await isolatedLedger.cashFlow(
        resolvePeriod({ period: 'today' }),
      );
      expect(summary.openingBalance).toBe(1000000n);
      expect(summary.income).toBe(795000n);
      expect(summary.expenses).toBe(50000n);
      expect(summary.net).toBe(745000n);
      expect(summary.endingBalance).toBe(1745000n);
      expect(summary.bySource.map((r) => [r.key, r.total])).toEqual([
        ['POS', 795000n],
      ]);
      expect(summary.byCategory.map((r) => [r.key, r.total])).toEqual([
        ['PACKAGING', 50000n],
      ]);
      expect(summary.transactionCount).toBe(2);
      const posRows = await isolated.database.db
        .select()
        .from(financialTransactions)
        .where(eq(financialTransactions.saleId, sale.saleId));
      expect(posRows).toHaveLength(1);
      const posted = summary.transactions.filter((t) => t.status === 'POSTED');
      expect(
        posted.reduce(
          (sum, t) =>
            sum + (t.direction === 'INCOME' ? t.amountRupiah : -t.amountRupiah),
          0n,
        ),
      ).toBe(summary.net);
    } finally {
      await isolated.cleanup();
    }
  }, 60000);
});
