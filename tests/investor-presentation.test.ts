import { beforeAll, afterAll, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import ejs from 'ejs';
import { readFile, readdir } from 'node:fs/promises';
import { investorFixture } from './helpers/investor-fixture.js';
import { accountingFixture } from './helpers/accounting-fixture.js';
import { importOwnerData } from '../src/modules/finance/owner-import.js';
import { createInvestorReports } from '../src/modules/finance/investor-reports.js';
import {
  presentInvestorReport,
  recordedAssetShare,
} from '../src/modules/admin/investor-presentation.js';
import { formatIdr } from '../src/modules/catalog/validation.js';
import {
  reportCopy,
  reportLanguage,
  reportLanguageLinks,
} from '../src/modules/admin/report-copy.js';
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
it('defaults unsupported language values to English and preserves report query context', () => {
  for (const value of [undefined, '', 'en', 'ID', 'fr', ['id'], { lang: 'id' }])
    expect(reportLanguage(value)).toBe('en');
  expect(reportLanguage('id')).toBe('id');
  expect(
    reportLanguageLinks(
      '/admin/reports/12-month-plan?period=month&lang=fr&tag=a&tag=b',
    ),
  ).toEqual({
    en: '/admin/reports/12-month-plan?period=month&lang=en&tag=a&tag=b',
    id: '/admin/reports/12-month-plan?period=month&lang=id&tag=a&tag=b',
  });
});
it('renders EN and ID from one immutable report with identical figures, detail rows and timestamps', async () => {
  const report = await createInvestorReports(f.db).report(
    new Date('2026-11-15T10:00:00Z'),
    true,
  );
  const before = structuredClone(report);
  expect(report.asset.fixed).toHaveLength(20);
  expect(report.asset.fixed.every((row) => row.status === 'ACTIVE')).toBe(true);
  for (const [template, title, primary, appendices] of [
    ['asset-report', 'Daftar Aset + Valuasi', 2, 3],
    ['plan-report', 'Rencana 12 Bulan + Prospektif', 3, 5],
  ] as const) {
    const render = async (language: 'en' | 'id') => {
      const view = presentInvestorReport(report, language);
      const translate = view.t;
      view.t = (key, values) => {
        // Fail on untranslated presentation copy, including accessible names.
        expect(reportCopy.id, key).toHaveProperty(key);
        return translate(key, values);
      };
      return ejs.renderFile(`views/admin/${template}.ejs`, {
        report,
        view,
        formatIdr,
      });
    };
    const en = await render('en');
    const id = await render('id');
    for (const html of [en, id]) {
      expect(html).not.toMatch(
        /disposed|released assets|dilepas|tidak lagi digunakan|tidak dimiliki/i,
      );
      expect(html).not.toMatch(/[\u00e2\u00c3\u00c2\ufffd]/u);
      expect(html).not.toMatch(/\{(?:retail|hpp|spread|count|revenue)\}/);
      expect(html).not.toMatch(
        /canonical|backend|editable forecasting UI|system-generated SKU|complete stock-and-cost cohort/i,
      );
    }
    expect(en).not.toMatch(
      /Lampiran|Belum tersedia|Rencana Operasional|Persediaan dinilai/,
    );
    expect(id).not.toMatch(
      /Appendix|Historical Performance Detail|Cash Flow Detail|Projection Methodology|Risks and Assumptions|months/,
    );
    expect(id).toContain(title.toUpperCase());
    expect(id).toContain('lang="id"');
    expect(en).toContain('lang="en"');
    expect(id.match(/Rp[\d.]+/g)).toEqual(en.match(/Rp[\d.]+/g));
    expect(id.match(/<t[dh][^>]*>\d+(?:\.\d+%|)<\/t[dh]>/g)).toEqual(
      en.match(/<t[dh][^>]*>\d+(?:\.\d+%|)<\/t[dh]>/g),
    );
    expect(id.match(/datetime="[^"]+"/g)).toEqual(
      en.match(/datetime="[^"]+"/g),
    );
    expect(id.match(/data-report-primary=/g)).toHaveLength(primary);
    expect(id.match(/data-report-appendix=/g)).toHaveLength(appendices);
    for (const row of report.asset.inventory) {
      if (template === 'asset-report') {
        expect(id).toContain(row.product.name);
        expect(id).toContain(row.variant.sku);
      }
    }
    if (template === 'asset-report') {
      for (const [html, language] of [
        [en, 'en'],
        [id, 'id'],
      ] as const) {
        const view = presentInvestorReport(report, language);
        expect(html.split(view.t('Data and Valuation Notes'))).toHaveLength(2);
        expect(
          html.split(
            view.t(
              'Unconfirmed stock or cost is excluded from calculations that require it. A confirmed zero is included as zero; missing data is not treated as zero.',
            ),
          ),
        ).toHaveLength(2);
        const main = html.split('<div class="report-appendices">')[0]!;
        expect(main).not.toMatch(
          /denominator|two decimal places|listed variants|number of individual units|penyebut|cakupan nilai jual|salah satu variannya|dua angka desimal|jumlah unit fisik/i,
        );
        for (const key of [
          'This report uses inventory and asset data recorded in the LOKKA system as of the report date.',
          'Only confirmed stock quantities and recorded costs are included in inventory valuation calculations.',
          'Missing data is not treated as zero and is excluded from calculations that require it.',
          'Inventory retail value is based on current selling prices and is presented as a commercial indicator, not as recorded asset value or guaranteed profit.',
          'Fixed assets are presented at recorded acquisition cost. Depreciation and book value have not yet been calculated.',
          'Product names, asset names, and SKUs are shown as recorded so the figures can be traced back to the underlying operational data.',
          'Where stock, cost, weight, or product media is incomplete, the limitation is disclosed as an operational readiness issue. It does not change the underlying valuation basis used in this report.',
        ])
          expect(main.split(view.t(key))).toHaveLength(2);
      }
      expect(id).toContain('Nilai Persediaan Berdasarkan HPP');
      expect(id).toContain('Nilai Perolehan Aktiva Tetap');
      expect(id).toContain('Stok Belum Diisi');
      for (const row of report.asset.fixed) expect(id).toContain(row.assetName);
    } else {
      expect(id).toContain('Rencana Operasional 12 Bulan');
      expect(id).toContain(
        'belum memadai untuk menghasilkan proyeksi yang dapat dipertanggungjawabkan',
      );
      expect(id).toContain(
        'Potensi Selisih Kotor bukan merupakan laba yang dijamin.',
      );
    }
  }
  expect(report).toEqual(before);
});
it('retains actual disposed asset rows and translated statuses without generic policy copy', async () => {
  const report = await createInvestorReports(f.db).report(new Date(), true);
  report.asset.fixed.push({
    ...report.asset.fixed[0]!,
    id: 'synthetic-disposed-asset',
    assetName: 'Synthetic retired equipment',
    status: 'DISPOSED',
  });
  const before = structuredClone(report);
  for (const language of ['en', 'id'] as const) {
    const html = await ejs.renderFile('views/admin/asset-report.ejs', {
      report,
      view: presentInvestorReport(report, language),
      formatIdr,
    });
    expect(html).toContain('Synthetic retired equipment');
    expect(html).toContain(
      `<td>${language === 'en' ? 'DISPOSED' : 'Dilepas'}</td>`,
    );
    expect(html.replace(/<td>(?:DISPOSED|Dilepas)<\/td>/g, '')).not.toMatch(
      /disposed|released assets|dilepas|tidak lagi digunakan|tidak dimiliki/i,
    );
    expect(html).toContain('data-report-fixed>Rp40.000');
    expect(html).toContain('data-report-combined>Rp48.400');
    expect(
      html
        .split('<table class="report-fixed-table">')[1]!
        .split('</tbody>')[0]!
        .match(/<tr>/g),
    ).toHaveLength(22);
  }
  expect(report).toEqual(before);
});
it('keeps the entire report presentation path and tests valid UTF-8 without saved mojibake', async () => {
  const files = [
    'src/modules/admin/report-copy.ts',
    'src/modules/admin/investor-presentation.ts',
    'src/modules/admin/investor-routes.ts',
    'views/admin/asset-report.ejs',
    'views/admin/plan-report.ejs',
    'views/partials/admin/report-header.ejs',
    'web/client/styles/investor-report.css',
    ...(await readdir('tests', { recursive: true }))
      .filter((name) => /\.(ts|mjs)$/.test(name))
      .map((name) => `tests/${name}`),
  ];
  for (const path of files) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(
      await readFile(path),
    );
    expect(text, path).not.toMatch(/[\u00e2\u00c3\u00c2\ufffd]/u);
  }
});
it('explains legacy revenue without attributing mixed sales totals to demo transactions', async () => {
  const report = await createInvestorReports(f.db).report(new Date(), true);
  const original = structuredClone(report);
  const note = {
    notes: 'Sale POS-REF-001',
    transactionNumber: 'POS-REF-001',
    source: 'POS',
  };
  expect(presentInvestorReport(report).transactionNotes(note)).toBe(note.notes);
  expect(presentInvestorReport(report, 'id').transactionNotes(note)).toBe(
    'Penjualan POS-REF-001',
  );
  expect(
    presentInvestorReport(report, 'id').transactionNotes({
      ...note,
      source: 'MANUAL',
    }),
  ).toBe(note.notes);
  expect(
    presentInvestorReport(report, 'id').transactionNotes({
      ...note,
      notes: 'Owner supplied description',
    }),
  ).toBe('Owner supplied description');
  report.plan!.legacySales = 1n;
  report.plan!.accounting.saleCount = 1n;
  report.plan!.accounting.revenue = 495000n;
  for (const language of ['en', 'id'] as const) {
    const view = presentInvestorReport(report, language);
    expect(view.legacySalesExplanation).toContain('Rp495.000');
    expect(view.legacySalesExplanation).toContain('1');
    expect(view.legacySalesExplanation).not.toContain('Rp6.450.000');
  }
  report.plan!.accounting.saleCount = 2n;
  report.plan!.accounting.revenue = 900000n;
  expect(presentInvestorReport(report).legacySalesExplanation).toContain(
    'not only those legacy transactions',
  );
  expect(presentInvestorReport(report, 'id').legacySalesExplanation).toContain(
    'bukan hanya transaksi lama tersebut',
  );
  report.plan!.legacySales = 0n;
  expect(presentInvestorReport(report).legacySalesExplanation).toBe(
    'No legacy demo-product sales are included in this report period.',
  );
  // The original database report remains unchanged; only this in-memory test copy was altered.
  expect(await createInvestorReports(f.db).report(original.asOf, true)).toEqual(
    original,
  );
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
    const id = await ejs.renderFile('views/admin/plan-report.ejs', {
      report,
      view: presentInvestorReport(report, 'id'),
      formatIdr,
    });
    expect(id).toContain('data-projection-available');
    expect(id).not.toContain('data-projection-unavailable');
    expect(id).toContain('Pendapatan disetahunkan');
    expect(id.match(/Rp[\d.]+/g)).toEqual(html.match(/Rp[\d.]+/g));
    expect(report).toEqual(before);
  } finally {
    await a.cleanup();
  }
}, 60000);
