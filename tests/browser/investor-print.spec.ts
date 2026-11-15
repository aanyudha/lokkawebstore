import { test, expect, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { investorFixture } from '../helpers/investor-fixture.js';
import { importOwnerData } from '../../src/modules/finance/owner-import.js';
import { createSalesService } from '../../src/modules/sales/service.js';
import { productVariants } from '../../src/db/schema/index.js';
import { buildApp } from '../../src/app.js';
import { readEnv } from '../../src/config/env.js';
async function verifySameRenderedReport(
  page: Page,
  primaryCount: number,
  appendixCount: number,
) {
  const report = page.locator('[data-investor-report]');
  await expect(report).not.toContainText(
    /disposed|released assets|dilepas|tidak lagi digunakan|tidak dimiliki/i,
  );
  await expect(report).not.toContainText(/[\u00e2\u00c3\u00c2\ufffd]/u);
  const before = await report.innerHTML();
  const tableText = await report.locator('table').allTextContents();
  const date = await report.locator('time').getAttribute('datetime');
  await page.evaluate(() => {
    window.print = () => {
      document.documentElement.dataset.printCount = String(
        Number(document.documentElement.dataset.printCount ?? '0') + 1,
      );
    };
  });
  const previousCount = Number(
    (await page.locator('html').getAttribute('data-print-count')) ?? '0',
  );
  await page.locator('[data-print-report]').click();
  await expect(page.locator('html')).toHaveAttribute(
    'data-print-count',
    String(previousCount + 1),
  );
  await page.emulateMedia({ media: 'print' });
  await expect(report).not.toContainText(/[\u00e2\u00c3\u00c2\ufffd]/u);
  const collisions = await report.locator('thead th').evaluateAll((cells) => {
    const failures: string[] = [];
    for (const cell of cells) {
      const box = cell.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(cell);
      for (const rect of range.getClientRects())
        if (
          rect.left < box.left - 1 ||
          rect.right > box.right + 1 ||
          rect.bottom > box.bottom + 1
        )
          failures.push(cell.textContent ?? '');
      if (getComputedStyle(cell).whiteSpace === 'nowrap')
        failures.push(cell.textContent ?? '');
    }
    return failures;
  });
  expect(collisions).toEqual([]);
  expect(
    await report
      .locator('td.report-money')
      .evaluateAll((cells) =>
        cells
          .filter((cell) => getComputedStyle(cell).textAlign !== 'right')
          .map((cell) => cell.textContent),
      ),
  ).toEqual([]);
  expect(
    await report
      .locator('td')
      .evaluateAll((cells) =>
        cells
          .filter(
            (cell) =>
              /^-?Rp[\d.]+$/.test(cell.textContent?.trim() ?? '') &&
              getComputedStyle(cell).textAlign !== 'right',
          )
          .map((cell) => cell.textContent),
      ),
  ).toEqual([]);
  await expect(page.locator('#admin-sidebar')).toBeHidden();
  await expect(page.locator('.admin-topbar')).toBeHidden();
  await expect(page.locator('[data-print-report]')).toBeHidden();
  await expect(page.locator('.report-language-selector')).toBeHidden();
  await expect(page.locator('[data-investor-report]')).not.toContainText(
    /disposed|released assets|dilepas|tidak lagi digunakan|tidak dimiliki/i,
  );
  await expect(report.locator('.report-heading img')).toBeVisible();
  await expect(report.locator('time')).toBeVisible();
  await expect(report.locator('[data-report-primary]')).toHaveCount(
    primaryCount,
  );
  await expect(report.locator('[data-report-appendix]')).toHaveCount(
    appendixCount,
  );
  for (const section of await report
    .locator('[data-report-primary],[data-report-appendix]')
    .all())
    await expect(section).toBeVisible();
  expect(await report.innerHTML()).toBe(before);
  expect(await report.locator('table').allTextContents()).toEqual(tableText);
  expect(await report.locator('time').getAttribute('datetime')).toBe(date);
  expect(await report.evaluate((node) => getComputedStyle(node).page)).toBe(
    'lokka-investor',
  );
  expect(
    await report
      .locator('.report-kpi')
      .first()
      .evaluate((node) => getComputedStyle(node).breakInside),
  ).toBe('avoid');
  expect(
    await report
      .locator('[data-report-primary]')
      .nth(1)
      .evaluate((node) => getComputedStyle(node).breakBefore),
  ).toBe('page');
  expect(
    await report
      .locator('thead')
      .first()
      .evaluate((node) => getComputedStyle(node).display),
  ).toBe('table-header-group');
  await page.emulateMedia({ media: 'screen' });
  expect(await report.innerHTML()).toBe(before);
}

async function savePrintPdf(
  page: Page,
  kind: 'assets' | 'plan',
  language: 'en' | 'id',
) {
  // page.pdf honors a forced screen emulation; export with actual print CSS.
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.admin-topbar')).toBeHidden();
  await expect(page.locator('.report-language-selector')).toBeHidden();
  if (kind === 'assets') {
    const notes = page.locator('[data-valuation-notes]');
    await expect(notes).toBeVisible();
    await expect(notes.locator('h3')).toHaveText(
      language === 'en'
        ? 'Data and Valuation Notes'
        : 'Catatan Data dan Penilaian',
    );
    await expect(notes.locator('li')).toHaveCount(5);
    const paragraphs = await notes.locator('p, li').allTextContents();
    expect(new Set(paragraphs).size).toBe(7);
    expect(
      (await page.locator('[data-report-primary]').allTextContents()).join(' '),
    ).not.toMatch(
      /denominator|two decimal places|listed variants|number of individual units|penyebut|cakupan nilai jual|salah satu variannya|dua angka desimal|jumlah unit fisik/i,
    );
    await notes.screenshot({
      path: `test-results/investor-assets-notes-${language}.png`,
    });
  }
  const pdf = await page.pdf({
    path: `test-results/investor-${kind}-${language}.pdf`,
    printBackground: true,
    preferCSSPageSize: true,
  });
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  await page.emulateMedia({ media: 'screen' });
}

async function verifyIndonesianReport(page: Page, kind: 'assets' | 'plan') {
  const report = page.locator('[data-investor-report]');
  await savePrintPdf(page, kind, 'en');
  const values = await report.locator('dd').allTextContents();
  const money = (await report.innerText()).match(/Rp[\d.]+/g);
  const numbers = await report.locator('td').allTextContents();
  const numericCells = (cells: string[]) =>
    cells.filter((cell) => /^(?:Rp[\d.]+|\d+(?:\.\d+%)?|—)$/.test(cell));
  const language = page.getByRole('navigation', {
    name: 'Report language',
    exact: true,
  });
  await expect(
    language.getByRole('link', { name: 'English', exact: true }),
  ).toHaveAttribute('aria-current', 'true');
  await language
    .getByRole('link', { name: 'Bahasa Indonesia', exact: true })
    .click();
  await expect(page).toHaveURL(/lang=id/);
  await expect(report).toHaveAttribute('lang', 'id');
  await expect(report).not.toContainText(/[\u00e2\u00c3\u00c2\ufffd]/u);
  await expect(report).not.toContainText(
    /Appendix|Historical Performance Detail|Cash Flow Detail|Projection Methodology|months/,
  );
  await expect(report.locator('h2')).toHaveText(
    kind === 'assets'
      ? 'DAFTAR ASET + VALUASI'
      : 'RENCANA 12 BULAN + PROSPEKTIF',
  );
  await expect(page).toHaveTitle(
    kind === 'assets'
      ? 'LOKKA — Daftar Aset + Valuasi'
      : 'LOKKA — Rencana 12 Bulan + Prospektif',
  );
  await expect(
    page
      .getByRole('navigation', { name: 'Bahasa laporan', exact: true })
      .getByRole('link', { name: 'Bahasa Indonesia', exact: true }),
  ).toHaveAttribute('aria-current', 'true');
  expect((await report.innerText()).match(/Rp[\d.]+/g)).toEqual(money);
  expect(numericCells(await report.locator('td').allTextContents())).toEqual(
    numericCells(numbers),
  );
  const monetaryKpis = (cells: string[]) =>
    cells.filter((value) => /^Rp[\d.]+$/.test(value));
  expect(monetaryKpis(await report.locator('dd').allTextContents())).toEqual(
    monetaryKpis(values),
  );
  if (kind === 'plan') {
    await expect(page.locator('[data-projection-unavailable]')).toHaveText(
      'Proyeksi keuangan 12 bulan belum disajikan karena riwayat penjualan, HPP historis, dan data biaya belum cukup lengkap untuk menghasilkan proyeksi yang dapat dipertanggungjawabkan. LOKKA akan mulai menampilkan proyeksi setelah tersedia periode operasi yang cukup panjang dan data biaya yang memadai.',
    );
    await expect(report).toContainText('Rencana Operasional 12 Bulan');
    await expect(report).toContainText('Risiko dan Asumsi');
    await expect(report).toContainText('Tahap Awal');
    await expect(report).toContainText('BELUM LENGKAP');
    await expect(report.locator('[data-report-primary]').first()).toContainText(
      'Prospek 12 Bulan',
    );
    await expect(report.locator('[data-report-primary]').first()).toContainText(
      'Peluang Komersial',
    );
    await expect(report.locator('[data-legacy-summary]')).toContainText(
      'produk demo lama',
    );
    expect(
      (await report.locator('[data-report-primary]').allTextContents()).join(
        ' ',
      ),
    ).not.toMatch(
      /canonical entry|itemless|source row|editable forecast|system-generated SKU|30 hari lengkap|bulan kalender berturut-turut|bulan lengkap \/|hari lengkap/i,
    );
  }
  const url = page.url();
  await report
    .locator('[data-report-primary]')
    .first()
    .screenshot({
      path: `test-results/investor-${kind}-id.png`,
    });
  await verifySameRenderedReport(
    page,
    kind === 'assets' ? 2 : 3,
    kind === 'assets' ? 3 : 5,
  );
  expect(page.url()).toBe(url);
  await savePrintPdf(page, kind, 'id');
  await expect(report).toHaveAttribute('lang', 'id');
  await page.getByRole('link', { name: 'English', exact: true }).click();
  await expect(page).toHaveURL(/lang=en/);
  expect((await report.innerText()).match(/Rp[\d.]+/g)).toEqual(money);
}
test('executive reports retain identical canonical figures, appendices and dates in screen and print media', async ({
  page,
}) => {
  test.setTimeout(120000);
  const f = await investorFixture();
  expect(new URL(f.url).pathname).toMatch(/^\/lokka_verify_/);
  expect(f.url).not.toBe(process.env.LOKKA_BROWSER_DATABASE_SOURCE);
  const [variant] = await f.db
    .select()
    .from(productVariants)
    .where(eq(productVariants.sku, 'LOKKA-DEMO-SHIRT-M'));
  await createSalesService(f.db).completeSale({
    source: 'POS',
    cashierId: f.admin.id,
    items: [{ variantId: variant!.id, quantity: 1 }],
    cashTendered: 495000n,
  });
  await importOwnerData(f.db, f.storage, f.payload, f.admin.id, true);
  const env = readEnv({
    ...process.env,
    DATABASE_URL: f.url,
    APP_RUNTIME: 'fastify',
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3049',
    APP_URL: 'http://127.0.0.1:3049',
  });
  const app = await buildApp(env, {
    database: { ...f.database, close: async () => {} },
    logger: false,
  });
  const errors: string[] = [];
  const unexpected: string[] = [];
  const reportRequests: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 400) unexpected.push(`${r.status()} ${r.url()}`);
  });
  page.on('request', (r) => {
    if (r.url().includes('/admin/reports/')) reportRequests.push(r.url());
  });
  try {
    await app.listen({ host: '127.0.0.1', port: 3049 });
    await page.goto(env.appUrl + '/admin/login');
    await page.getByLabel('Email', { exact: true }).fill(f.admin.email);
    await page
      .getByLabel('Password', { exact: true })
      .fill('temporary-investor-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(env.appUrl + '/admin');
    const nav = page.getByRole('navigation', { name: 'Admin', exact: true });
    await nav
      .getByRole('link', { name: 'Asset Register + Valuation', exact: true })
      .click();
    await expect(page.locator('[data-report-combined]')).toHaveText('Rp48.400');
    await expect(page.locator('[data-report-hpp]')).toHaveText('Rp8.400');
    await expect(page.locator('[data-report-fixed]')).toHaveText('Rp40.000');
    await expect(page.locator('[data-report-retail]')).toHaveText('Rp28.000');
    await expect(page.locator('[data-report-spread]')).toHaveText('Rp19.600');
    await expect(page.locator('[data-report-units]')).toHaveText('56');
    await expect(page.locator('[data-product-count]')).toHaveText('34');
    await expect(page.locator('[data-asset-mix]')).toBeVisible();
    await expect(
      page.locator('[data-report-appendix="A"] tbody tr'),
    ).toHaveCount(34);
    await expect(
      page.locator('[data-report-appendix="B"] tbody tr'),
    ).toHaveCount(20);
    await expect(
      page.locator('[data-report-primary] .table-scroll'),
    ).toHaveCount(0);
    await expect(page.locator('[data-investor-report] form')).toHaveCount(0);
    const assetRequestCount = reportRequests.length;
    await verifySameRenderedReport(page, 2, 3);
    expect(reportRequests).toHaveLength(assetRequestCount);
    await verifyIndonesianReport(page, 'assets');
    await page.setViewportSize({ width: 1100, height: 1000 });
    await page.locator('[data-report-primary]').first().screenshot({
      path: 'test-results/investor-executive-assets.png',
    });
    await nav
      .getByRole('link', { name: '12-month Plan + Prospective', exact: true })
      .click();
    await expect(page.locator('[data-plan-assets]')).toHaveText('Rp48.400');
    await expect(page.locator('[data-plan-revenue]')).toHaveText('Rp495.000');
    await expect(page.locator('[data-plan-cash]')).toHaveText('Rp495.000');
    await expect(page.locator('[data-plan-units]')).toHaveText('56');
    await expect(page.locator('[data-hpp-limitation]')).toHaveCount(1);
    await expect(page.locator('[data-projection-unavailable]')).toBeVisible();
    await expect(page.locator('.report-roadmap > li')).toHaveCount(4);
    await expect(
      page.locator('[data-report-primary] .table-scroll'),
    ).toHaveCount(0);
    await expect(page.locator('[data-legacy-disclosure]')).toContainText(
      'Rp495.000 comes from 1 completed legacy demo-product transaction',
    );
    const planRequestCount = reportRequests.length;
    await verifySameRenderedReport(page, 3, 5);
    expect(reportRequests).toHaveLength(planRequestCount);
    await verifyIndonesianReport(page, 'plan');
    await page.locator('[data-report-primary]').first().screenshot({
      path: 'test-results/investor-executive-plan.png',
    });
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
  } finally {
    await app.close();
    await f.cleanup();
  }
});
