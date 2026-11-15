import type { createInvestorReports } from '../finance/investor-reports.js';
import { CATEGORY_LABELS, SOURCE_LABELS } from '../finance/ledger.js';
import {
  reportTranslator,
  reportLanguageLinks,
  type ReportLanguage,
} from './report-copy.js';
type Report = Awaited<
  ReturnType<ReturnType<typeof createInvestorReports>['report']>
>;
/** Display ratio only: whole-Rupiah values never pass through floating point. */
export function recordedAssetShare(value: bigint, total: bigint): string {
  if (total === 0n) return '—';
  const hundredths = (value * 10000n + total / 2n) / total;
  return `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}%`;
}
/** Read-only presentation metadata. All financial figures remain on the original report. */
export function presentInvestorReport(
  report: Report,
  language: ReportLanguage = 'en',
  requestUrl = '/admin/reports/assets',
) {
  const t = reportTranslator(language);
  const products = new Map<
    string,
    { unknown: boolean; missingWeight: boolean }
  >();
  for (const row of report.asset.inventory) {
    const previous = products.get(row.product.id);
    products.set(row.product.id, {
      unknown: (previous?.unknown ?? false) || !row.variant.stockKnown,
      missingWeight:
        (previous?.missingWeight ?? false) || row.variant.weightGrams <= 0,
    });
  }
  const unknownProducts = [...products.values()].filter(
    (product) => product.unknown,
  ).length;
  const units = new Set(report.asset.inventory.map((row) => row.variant.unit));
  const soleUnit = units.size === 1 ? [...units][0] : null;
  const plan = report.plan;
  return {
    language,
    t,
    languageLinks: reportLanguageLinks(requestUrl),
    productCount: products.size,
    knownStockProducts: products.size - unknownProducts,
    unknownStockProducts: unknownProducts,
    missingWeightProducts: [...products.values()].filter(
      (product) => product.missingWeight,
    ).length,
    activeFixedCount: report.asset.fixed.filter(
      (row) => row.status === 'ACTIVE',
    ).length,
    unitLabel: soleUnit || t('recorded units'),
    inventoryShare: recordedAssetShare(
      report.asset.hppValue,
      report.asset.combinedValue,
    ),
    fixedShare: recordedAssetShare(
      report.asset.fixedValue,
      report.asset.combinedValue,
    ),
    totalShare: recordedAssetShare(
      report.asset.combinedValue,
      report.asset.combinedValue,
    ),
    historyStatus:
      !plan || plan.accounting.saleCount === 0n
        ? 'NO RECORDED SALES'
        : plan.projection
          ? 'QUALIFYING HISTORY'
          : 'EARLY STAGE',
    hppStatus:
      !plan || plan.accounting.saleCount === 0n
        ? 'NO SALES TO ASSESS'
        : plan.accounting.cogs === null
          ? 'INCOMPLETE'
          : 'COMPLETE',
    projectionStatus: plan?.projection
      ? 'RUN RATE AVAILABLE'
      : 'NOT YET RELIABLE',
    sourceLabels: Object.fromEntries(
      Object.entries(SOURCE_LABELS).map(([key, label]) => [key, t(label)]),
    ),
    categoryLabels: Object.fromEntries(
      Object.entries(CATEGORY_LABELS).map(([key, label]) => [key, t(label)]),
    ),
  };
}
