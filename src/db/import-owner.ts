import 'dotenv/config';
import { readFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, relative, isAbsolute } from 'node:path';
import { createDatabase } from './client.js';
import { LocalCatalogImageStorage } from '../modules/catalog/storage.js';
import {
  importOwnerData,
  parseOwnerPayload,
  payloadHash,
} from '../modules/finance/owner-import.js';
import { reconcileInitialOwnerImport } from '../modules/finance/owner-reconciliation.js';
import { createInvestorReports } from '../modules/finance/investor-reports.js';
import { sql } from 'drizzle-orm';
const flag = (name: string) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const url = process.env.DATABASE_URL;
const payloadPath = flag('--payload');
const adminId = flag('--admin-id');
if (!url || !payloadPath || !adminId)
  throw new Error(
    'Use owner:import -- --payload PATH --admin-id UUID [--apply --backup-dir OUTSIDE_REPO].',
  );
const database = createDatabase(url);
const storage = new LocalCatalogImageStorage(
  process.env.CATALOG_STORAGE_ROOT ?? 'storage/catalog',
);
const protectedTables = [
  'sales',
  'sale_items',
  'sale_payments',
  'financial_transactions',
  'inventory_movements',
  'orders',
  'order_items',
  'product_images',
  'product_translations',
];
async function snapshot() {
  return database.db.transaction(async (tx) => {
    await tx.execute(
      sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`,
    );
    const result: Record<string, { id: string; hash: string }[]> = {};
    for (const table of protectedTables) {
      const rows = await tx.execute(
        sql.raw(
          `SELECT id, to_jsonb(t)::text AS row_text FROM "${table}" t ORDER BY id`,
        ),
      );
      result[table] = rows.rows.map((row) => ({
        id: String(row.id),
        hash: payloadHash(row.row_text),
      }));
    }
    return result;
  });
}
try {
  const payload = parseOwnerPayload(
    JSON.parse(await readFile(resolve(payloadPath), 'utf8')),
  );
  console.info(
    JSON.stringify(
      await importOwnerData(database.db, storage, payload, adminId, false),
      null,
      2,
    ),
  );
  if (process.argv.includes('--apply')) {
    const directory = flag('--backup-dir');
    if (!directory)
      throw new Error(
        'A restorable backup directory outside the repository is required.',
      );
    const backupDirectory = resolve(directory);
    const inside = relative(resolve('.'), backupDirectory);
    if (!inside || (!inside.startsWith('..') && !isAbsolute(inside)))
      throw new Error('Backup directory must be outside the repository.');
    await mkdir(backupDirectory, { recursive: true });
    const backup = resolve(
      backupDirectory,
      `lokka-owner-before-import-${new Date().toISOString().replaceAll(/[:.]/g, '-')}.dump`,
    );
    const connection = new URL(url);
    const childEnv = {
      ...process.env,
      PGHOST: connection.hostname,
      PGPORT: connection.port || '5432',
      PGUSER: decodeURIComponent(connection.username),
      PGPASSWORD: decodeURIComponent(connection.password),
      PGDATABASE: decodeURIComponent(connection.pathname.slice(1)),
    };
    const fingerprint = await snapshot();
    execFileSync(
      'pg_dump',
      ['--format=custom', '--no-owner', '--no-acl', '--file', backup],
      { env: childEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    execFileSync('pg_restore', ['--list', backup], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const beforeApply = await snapshot();
    if (payloadHash(fingerprint) !== payloadHash(beforeApply))
      throw new Error(
        'Historical data changed while backing up. Rerun the dry run.',
      );
    await import('node:fs/promises').then((fs) =>
      fs.writeFile(
        backup + '.fingerprints.json',
        JSON.stringify(fingerprint, null, 2) + '\n',
      ),
    );
    console.info(
      `Restorable backup and fingerprints captured outside repository: ${backup}`,
    );
    const applied = await importOwnerData(
      database.db,
      storage,
      payload,
      adminId,
      true,
    );
    console.info(JSON.stringify(applied, null, 2));
    if (applied.created === 54 && applied.skipped === 0)
      console.info(
        JSON.stringify(
          {
            initialRowReconciliation: await reconcileInitialOwnerImport(
              database.db,
              payload,
            ),
          },
          null,
          2,
        ),
      );
    const after = await snapshot();
    for (const table of protectedTables)
      for (const row of fingerprint[table]!) {
        if (
          !after[table]!.some(
            (current) => current.id === row.id && current.hash === row.hash,
          )
        )
          throw new Error(
            `Historical preservation check failed for ${table}. Review backup before further writes.`,
          );
      }
    const report = await createInvestorReports(database.db).report();
    console.info(
      JSON.stringify(
        {
          historyPreserved: true,
          assetTotals: {
            units: report.asset.knownUnits,
            hpp: report.asset.hppValue,
            retail: report.asset.retailValue,
            spread: report.asset.grossSpread,
            fixed: report.asset.fixedValue,
            combined: report.asset.combinedValue,
            incomplete: report.asset.incompleteCount,
          },
        },
        (_, value) => (typeof value === 'bigint' ? value.toString() : value),
        2,
      ),
    );
  }
} finally {
  await database.close();
}
