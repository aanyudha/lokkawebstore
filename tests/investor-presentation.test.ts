import { beforeAll, afterAll, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import ejs from 'ejs';
import { investorFixture } from './helpers/investor-fixture.js';
import { accountingFixture } from './helpers/accounting-fixture.js';
import { importOwnerData } from '../src/modules/finance/owner-import.js';
import { createInvestorReports } from '../src/modules/finance/investor-reports.js';
import {
  presentInvestorReport,
  recordedAssetShare,
} from '../src/modules/admin/investor-presentation.js';
import { formatIdr } from '../src/modules/catalog/validation.js';
import { sales, vendors, reportingCoverage } from '../src/db/schema/index.js';
let f: Awaited<ReturnType<typeof investorFixture>>;
beforeAll(async () => {
  f = await investorFixture();
  await importOwnerData(f.db, f.storage, f.payload, f.admin.id, true);
}, 60000);
afterAll(async () => {
  await f?.cleanup();
}, 60000);
it('derives executive counts from canonical product IDs without changing the report model or amounts', async () => {
  const report = await createInvestorReports(f.db).report(new Date(), true);
  const before = structuredClone(report);
  const view = presentInvestorReport(report);
  expect(view).toMatchObject({
    productCount: 34,
    knownStockProducts: 28,
    unknownStockProducts: 6,
    missingWeightProducts: 34,
    activeFixedCount: 20,
    unitLabel: 'pcs',
    projectionStatus: 'NOT YET RELIABLE',
    historyStatus: 'NO RECORDED SALES',
    hppStatus: 'NO SALES TO ASSESS',
  });
  expect(report).toEqual(before);
  expect(report.asset).toMatchObject({
    knownUnits: 56n,
    hppValue: 8400n,
    retailValue: 28000n,
    grossSpread: 19600n,
    fixedValue: 40000n,
    combinedValue: 48400n,
  });
  // Counts refer to products: a product with both known and unknown variants is incomplete once.
  const mixed = structuredClone(report);
  mixed.asset.inventory.push({
    ...mixed.asset.inventory[0]!,
    variant: {
      ...mixed.asset.inventory[0]!.variant,
      id: 'synthetic-extra-variant',
      stockKnown: false,
      stockQuantity: 0,
    },
    inventoryValue: null,
    retailValue: null,
  });
  expect(presentInvestorReport(mixed)).toMatchObject({
    productCount: 34,
    knownStockProducts: 27,
    unknownStockProducts: 7,
  });
});
it('formats display-only asset shares with bigint rounding and an explicit zero-denominator state', () => {
  expect(recordedAssetShare(25671000n, 49866000n)).toBe('51.48%');
  expect(recordedAssetShare(24195000n, 49866000n)).toBe('48.52%');
  expect(recordedAssetShare(1n, 6n)).toBe('16.67%');
  expect(recordedAssetShare(9007199254740993n, 9007199254740994n)).toBe(
    '100.00%',
  );
  expect(recordedAssetShare(0n, 0n)).toBe('—');
});
it('renders all inventory and asset detail after the executive sections and uses canonical data for every KPI', async () => {
  const report = await createInvestorReports(f.db).report(new Date(), true);
  const view = presentInvestorReport(report);
  const html = await ejs.renderFile('views/admin/asset-report.ejs', {
    report,
    view,
    formatIdr,
  });
  expect(html.indexOf('data-report-primary')).toBeLessThan(
    html.indexOf('data-report-appendix'),
  );
  expect(html.match(/data-report-primary=/g)).toHaveLength(2);
  expect(html.match(/data-report-appendix=/g)).toHaveLength(3);
  for (const row of report.asset.inventory)
    expect(html).toContain(row.product.name);
  for (const row of report.asset.fixed) expect(html).toContain(row.assetName);
  for (const value of [
    report.asset.hppValue,
    report.asset.retailValue,
    report.asset.grossSpread,
    report.asset.fixedValue,
    report.asset.combinedValue,
  ])
    expect(html).toContain(formatIdr(value));
  expect(html).not.toContain('<form');
  expect(html).toContain('No depreciation');
  const plan = await ejs.renderFile('views/admin/plan-report.ejs', {
    report,
    view,
    formatIdr,
  });
  expect(plan.match(/data-report-primary=/g)).toHaveLength(3);
  expect(plan.match(/data-report-appendix=/g)).toHaveLength(5);
  expect(plan).toContain('data-projection-unavailable');
  expect(plan).not.toContain('Unavailable — incomplete historical cost data');
});
it('continues to present qualifying canonical run rates instead of replacing the existing evidence gate', async () => {
  const a = await accountingFixture();
  try {
    const sale = await a.sell();
    await a.db
      .update(sales)
      .set({
        createdAt: new Date('2026-03-10T12:00:00Z'),
        updatedAt: new Date(),
      })
      .where(eq(sales.id, sale.saleId));
    const [vendor] = await a.db
      .select()
      .from(vendors)
      .where(eq(vendors.slug, 'lokka'));
    await a.db.insert(reportingCoverage).values({
      vendorId: vendor!.id,
      month: '2026-03-01',
      salesComplete: true,
      expensesComplete: true,
      evidence: 'Synthetic reconciled complete month',
      confirmedBy: a.admin.id,
    });
    const report = await createInvestorReports(a.db).report(
      new Date('2026-04-10T12:00:00Z'),
      true,
    );
    const before = structuredClone(report);
    const view = presentInvestorReport(report);
    const html = await ejs.renderFile('views/admin/plan-report.ejs', {
      report,
      view,
      formatIdr,
    });
    expect(view.projectionStatus).toBe('RUN RATE AVAILABLE');
    expect(html).toContain('data-projection-available');
    expect(html).not.toContain('data-projection-unavailable');
    expect(html).toContain(formatIdr(report.plan!.projection!.revenue));
    expect(report).toEqual(before);
  } finally {
    await a.cleanup();
  }
}, 60000);
