import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { accountingFixture } from './helpers/accounting-fixture.js';
import { resolvePeriod } from '../src/modules/finance/ledger.js';
import { MANUAL_INCOME_ACCOUNTING } from '../src/modules/finance/accounting.js';
import {
  adminUsers,
  directCosts,
  financialTransactions,
  overheadCosts,
  products,
  productVariants,
  saleItems,
  sales,
} from '../src/db/schema/index.js';
import { createFinance } from '../src/modules/finance/service.js';
import { createCatalog } from '../src/modules/catalog/service.js';
import { LocalCatalogImageStorage } from '../src/modules/catalog/storage.js';
import { buildApp } from '../src/app.js';
import { readEnv } from '../src/config/env.js';

let f: Awaited<ReturnType<typeof accountingFixture>>;
const today = () => resolvePeriod({ period: 'today' });
beforeEach(async () => {
  f = await accountingFixture();
}, 60000);
afterEach(async () => {
  await f?.cleanup();
}, 60000);

describe('derived Accounting Lite', () => {
  it('supports an empty database with zero totals and no invented facts', async () => {
    const report = await f.accounting.report(today());
    expect([
      report.revenue,
      report.cogs,
      report.grossProfit,
      report.operatingExpenses,
      report.netProfit,
    ]).toEqual([0n, 0n, 0n, 0n, 0n]);
    expect(report.bySource).toEqual([]);
    expect(report.byCategory).toEqual([]);
  });

  it('separates cash from profit, counts sale/expense once, and traces every fact', async () => {
    await f.ledger.setOpeningBalance(
      {
        amountRupiah: '1000000',
        occurredAt: new Date(today().from.getTime() - 86400000)
          .toISOString()
          .slice(0, 16),
      },
      f.admin.id,
    );
    const sale = await f.sell();
    const expense = await f.expense();
    const report = await f.accounting.report(today());
    expect([
      report.revenue,
      report.cogs,
      report.grossProfit,
      report.operatingExpenses,
      report.netProfit,
    ]).toEqual([795000n, 300000n, 495000n, 50000n, 445000n]);
    expect(report.bySource).toEqual([
      { key: 'POS', revenue: 795000n, count: 1n },
    ]);
    expect(report.byCategory).toEqual([{ key: 'PACKAGING', total: 50000n }]);
    expect(report.recentSales[0]?.reference).toBe(sale.transactionNumber);
    expect(report.recentItems[0]).toMatchObject({
      reference: sale.transactionNumber,
      unitCost: 300000n,
      cogs: '300000',
    });
    expect(report.recentExpenses[0]?.id).toBe(expense.id);
    expect(sale.cashReceived).toBe(1000000n);
    expect(sale.changeAmount).toBe(205000n);
    const cash = await f.ledger.cashFlow(today());
    expect([
      cash.openingBalance,
      cash.income,
      cash.expenses,
      cash.endingBalance,
    ]).toEqual([1000000n, 795000n, 50000n, 1745000n]);
    expect(
      await f.db
        .select()
        .from(financialTransactions)
        .where(eq(financialTransactions.saleId, sale.saleId)),
    ).toHaveLength(1);
  });

  it('keeps historical HPP stable after catalog cost changes through the real finance writer', async () => {
    await f.sell('POS', 2);
    const finance = createFinance(
      f.db,
      createCatalog(
        f.db,
        new LocalCatalogImageStorage('storage/tests/accounting'),
      ),
    );
    await finance.saveProductCost(
      f.product.id,
      {
        name: 'Changed cost',
        category: 'DIRECT_MATERIAL',
        amountRupiah: '600000',
      },
      f.cost.id,
    );
    const beforeNextSale = await f.accounting.report(today());
    expect(beforeNextSale.cogs).toBe(600000n);
    expect(beforeNextSale.recentItems[0]?.unitCost).toBe(300000n);
    await f.sell('WEBSTORE');
    const afterNextSale = await f.accounting.report(today());
    expect(afterNextSale.cogs).toBe(1200000n);
    expect(afterNextSale.bySource).toEqual([
      { key: 'POS', revenue: 1590000n, count: 1n },
      { key: 'WEBSTORE', revenue: 795000n, count: 1n },
    ]);
  });

  it('excludes voided expenses but preserves their audit fields and cash correction', async () => {
    const expense = await f.expense();
    expect((await f.accounting.report(today())).operatingExpenses).toBe(50000n);
    await f.ledger.voidTransaction(
      { reason: 'Duplicate receipt' },
      expense.id,
      f.admin.id,
    );
    const report = await f.accounting.report(today());
    expect(report.operatingExpenses).toBe(0n);
    expect(report.netProfit).toBe(0n);
    expect(report.recentExpenses).toEqual([]);
    expect((await f.ledger.cashFlow(today())).expenses).toBe(0n);
    const [audit] = await f.db
      .select()
      .from(financialTransactions)
      .where(eq(financialTransactions.id, expense.id));
    expect(audit).toMatchObject({
      status: 'VOIDED',
      voidReason: 'Duplicate receipt',
      voidedById: f.admin.id,
    });
    expect(audit!.voidedAt).toBeInstanceOf(Date);
  });

  it('never treats manual income, opening balance or overhead planning as revenue or expense', async () => {
    for (const category of ['PRODUCT_SALES', 'OTHER_INCOME']) {
      await f.ledger.recordManual(
        {
          direction: 'INCOME',
          category,
          amountRupiah: '123456',
          occurredAt: new Date().toISOString().slice(0, 16),
        },
        f.admin.id,
      );
    }
    await f.ledger.setOpeningBalance(
      {
        amountRupiah: '1000000',
        occurredAt: new Date().toISOString().slice(0, 16),
      },
      f.admin.id,
    );
    await f.db.insert(overheadCosts).values({
      vendorId: f.product.vendorId,
      name: 'Planning rent',
      category: 'FACILITY',
      amountRupiah: 999999n,
      billingFrequency: 'MONTHLY',
      recognitionMethod: 'SPREAD_MONTHLY',
      startDate: today().fromInput,
    });
    expect(MANUAL_INCOME_ACCOUNTING).toBe('CASH_ONLY');
    const report = await f.accounting.report(today());
    expect([
      report.revenue,
      report.cogs,
      report.operatingExpenses,
      report.netProfit,
    ]).toEqual([0n, 0n, 0n, 0n]);
    expect((await f.ledger.cashFlow(today())).income).toBe(1246912n);
  });

  it('uses whole UTC day boundaries consistently with Cash Flow for sales and expenses', async () => {
    const sale = await f.sell();
    await f.db
      .update(sales)
      .set({
        createdAt: new Date('2026-01-31T23:59:59.999Z'),
        updatedAt: new Date(),
      })
      .where(eq(sales.id, sale.saleId));
    await f.expense('50000', '2026-01-31T23:59');
    await f.expense('10000', '2026-02-01T00:00');
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
    expect(await f.accounting.report(january)).toMatchObject({
      revenue: 795000n,
      cogs: 300000n,
      operatingExpenses: 50000n,
    });
    expect(await f.accounting.report(february)).toMatchObject({
      revenue: 0n,
      cogs: 0n,
      operatingExpenses: 10000n,
    });
    expect((await f.ledger.cashFlow(january)).expenses).toBe(50000n);
    expect((await f.ledger.cashFlow(february)).expenses).toBe(10000n);
    expect(resolvePeriod({ period: 'month' }).from.getUTCDate()).toBe(1);
  });

  it('excludes pending, cancelled and refunded sales from Revenue and HPP', async () => {
    const sale = await f.sell();
    for (const status of ['pending', 'cancelled', 'refunded'] as const) {
      await f.db
        .update(sales)
        .set({ status, updatedAt: new Date() })
        .where(eq(sales.id, sale.saleId));
      expect(await f.accounting.report(today())).toMatchObject({
        revenue: 0n,
        cogs: 0n,
        saleCount: 0n,
      });
    }
  });

  it('does not invent legacy HPP or report false profit when snapshots or items are missing', async () => {
    const sale = await f.sell();
    await f.db
      .update(saleItems)
      .set({ costSnapshot: null })
      .where(eq(saleItems.saleId, sale.saleId));
    expect(await f.accounting.report(today())).toMatchObject({
      revenue: 795000n,
      cogs: null,
      grossProfit: null,
      netProfit: null,
      missingItemCount: 1n,
    });
    await f.db.delete(saleItems).where(eq(saleItems.saleId, sale.saleId));
    expect(await f.accounting.report(today())).toMatchObject({
      cogs: null,
      missingSaleCount: 1n,
    });
  });

  it('distinguishes unconfigured cost from an explicitly configured zero unit cost', async () => {
    await f.db.delete(directCosts).where(eq(directCosts.id, f.cost.id));
    const sale = await f.sell();
    expect((await f.accounting.report(today())).cogs).toBeNull();
    await f.db
      .update(sales)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(sales.id, sale.saleId));
    await f.db.insert(directCosts).values({
      productId: f.product.id,
      name: 'Explicit zero',
      category: 'OTHER',
      amountRupiah: 0n,
    });
    await f.sell();
    expect(await f.accounting.report(today())).toMatchObject({
      cogs: 0n,
      netProfit: 795000n,
    });
  });

  it('aggregates exact Rupiah beyond JS safe integers and PostgreSQL bigint multiplication', async () => {
    const huge = 9007199254740993n;
    await f.db
      .update(productVariants)
      .set({ price: huge, updatedAt: new Date() })
      .where(eq(productVariants.id, f.variant.id));
    await f.db
      .update(directCosts)
      .set({ amountRupiah: huge - 1n, updatedAt: new Date() })
      .where(eq(directCosts.id, f.cost.id));
    const sale = await f.sell('POS', 2);
    expect(await f.accounting.report(today())).toMatchObject({
      revenue: huge * 2n,
      cogs: (huge - 1n) * 2n,
      grossProfit: 2n,
    });
    // Existing historical facts may legitimately aggregate beyond pg bigint.
    await f.db
      .update(saleItems)
      .set({ costSnapshot: 9223372036854775807n })
      .where(eq(saleItems.saleId, sale.saleId));
    expect((await f.accounting.report(today())).cogs).toBe(
      18446744073709551614n,
    );
  });

  it('keeps totals complete with bounded detail queries', async () => {
    await f.db
      .execute(sql`insert into financial_transactions (source, direction, type, category, amount_rupiah, occurred_at, period_month, status)
      select 'MANUAL', 'EXPENSE', 'MANUAL', 'SUPPLIES', 1, ${new Date().toISOString()}::timestamptz, ${today().fromInput}::date, 'POSTED' from generate_series(1, 205)`);
    const report = await f.accounting.report(today());
    expect(report.operatingExpenses).toBe(205n);
    expect(report.byCategory).toEqual([{ key: 'SUPPLIES', total: 205n }]);
    expect(report.recentExpenses).toHaveLength(100);
  });

  it('requires an active admin session and renders protected read-only reports and validation', async () => {
    const app = await buildApp(
      readEnv({
        ...process.env,
        APP_RUNTIME: 'fastify',
        DATABASE_URL: f.url,
        NODE_ENV: 'test',
        APP_URL: 'http://127.0.0.1:3000',
      }),
      { database: { ...f.database, close: async () => {} }, logger: false },
    );
    try {
      expect((await app.inject('/admin/finance/accounting')).statusCode).toBe(
        303,
      );
      const login = await app.inject('/admin/login');
      const csrf = login.cookies.find(
        (c) => c.name === 'lokka_login_csrf',
      )!.value;
      const signedIn = await app.inject({
        method: 'POST',
        url: '/admin/login',
        cookies: { lokka_login_csrf: csrf },
        payload: {
          csrf,
          email: f.admin.email,
          password: 'temporary-accounting-password',
        },
      });
      expect(signedIn.statusCode).toBe(303);
      const cookie = signedIn.cookies
        .filter((c) => c.value)
        .map((c) => `${c.name}=${c.value}`)
        .join('; ');
      const response = await app.inject({
        url: '/admin/finance/accounting',
        headers: { cookie },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toContain('no-store');
      expect(response.headers['x-robots-tag']).toContain('noindex');
      expect(response.body).toContain('Accounting Lite');
      expect(response.body).not.toContain(
        'method="post" action="/admin/finance/accounting',
      );
      const invalid = await app.inject({
        url: '/admin/finance/accounting?period=custom&from=bad&to=2026-01-01',
        headers: { cookie },
      });
      expect(invalid.statusCode).toBe(422);
      expect(invalid.body).toContain('Choose a valid date');
      await f.db
        .update(products)
        .set({ name: '<script>bad</script>', updatedAt: new Date() })
        .where(eq(products.id, f.product.id));
      await f.sell();
      await f.db
        .update(directCosts)
        .set({ amountRupiah: 800000n, updatedAt: new Date() })
        .where(eq(directCosts.id, f.cost.id));
      const escaped = await app.inject({
        url: '/admin/finance/accounting',
        headers: { cookie },
      });
      expect(escaped.body).toContain('&lt;script&gt;bad&lt;/script&gt;');
      await f.db
        .update(adminUsers)
        .set({ status: 'disabled', updatedAt: new Date() })
        .where(eq(adminUsers.id, f.admin.id));
      expect(
        (
          await app.inject({
            url: '/admin/finance/accounting',
            headers: { cookie },
          })
        ).statusCode,
      ).toBe(303);
    } finally {
      await app.close();
    }
  });
});
