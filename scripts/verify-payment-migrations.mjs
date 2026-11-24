import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  unlink,
  rmdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import {
  assertDatabaseIdentity,
  disposableDatabaseUrl,
  testDatabaseUrl,
} from './verification-db.ts';

const source = testDatabaseUrl();
await assertDatabaseIdentity(source.href, source.pathname.slice(1));
const parent = new pg.Pool({ connectionString: source.href });
const journal = JSON.parse(
  await readFile('drizzle/meta/_journal.json', 'utf8'),
);
const history = readMigrationFiles({ migrationsFolder: 'drizzle' }).map(
  (entry) => ({
    created_at: String(entry.folderMillis),
    hash: entry.hash,
  }),
);
assert.deepEqual(
  journal.entries.slice(-3).map((entry) => entry.tag),
  [
    '0012_webstore_payments',
    '0013_webstore_checkout',
    '0014_webstore_payment_provider_account',
  ],
);
const historical = mkdtemp(join(tmpdir(), 'lokka-audit-'));
const files = [];

async function disposable(work) {
  const { name, url } = disposableDatabaseUrl(source, 'audit');
  await parent.query(`CREATE DATABASE "${name}"`);
  const pool = new pg.Pool({ connectionString: url });
  try {
    await assertDatabaseIdentity(url, name);
    console.log(`Migration proof database: ${name}`);
    const rows = async (sql) => (await pool.query(sql)).rows;
    await work(drizzle(pool), rows);
  } finally {
    await pool.end();
    await parent.query(`DROP DATABASE "${name}"`);
  }
}

const historySql =
  'SELECT created_at, hash FROM drizzle.__drizzle_migrations ORDER BY id';
const folder = await historical;
const meta = join(folder, 'meta');
await mkdir(meta);
async function save(file, contents) {
  await writeFile(file, contents);
  files.push(file);
}
try {
  await disposable(async (db, rows) => {
    await migrate(db, { migrationsFolder: 'drizzle' });
    assert.deepEqual(await rows(historySql), history);
    const [column] = await rows(
      "SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'payment_attempts' AND column_name = 'provider_account'",
    );
    assert.equal(column?.is_nullable, 'YES');
    console.log('Fresh lineage through 0014: PASS');
  });
  const through0013 = journal.entries.slice(0, -1);
  await save(
    join(meta, '_journal.json'),
    JSON.stringify({ ...journal, entries: through0013 }),
  );
  for (const { tag } of through0013) {
    assert.match(tag, /^\d{4}_[a-z0-9_]+$/);
    await save(
      join(folder, tag + '.sql'),
      await readFile(join('drizzle', tag + '.sql')),
    );
  }
  await disposable(async (db, rows) => {
    await migrate(db, { migrationsFolder: folder });
    assert.deepEqual(await rows(historySql), history.slice(0, -1));
    await rows(`WITH customer AS (
      INSERT INTO customers (name,email,email_normalized,password_hash)
      VALUES ('Migration fixture','migration@example.test','migration@example.test','fixture') RETURNING id
    ), order_row AS (
      INSERT INTO orders (order_number,customer_id,idempotency_key,subtotal,grand_total,shipping_address_snapshot,shipping_method_snapshot,shipment_weight_grams)
      SELECT 'WEB-20000101-000001',id,gen_random_uuid(),25000,25000,'{}','{}',300 FROM customer RETURNING id
    ), attempt AS (
      INSERT INTO payment_attempts (order_id,provider,merchant_invoice_number,sequence,request_id,amount,currency)
      SELECT id,'DOKU','MIGRATION1',1,'migration-request',25000,'IDR' FROM order_row RETURNING id
    )
    INSERT INTO payment_notifications (provider,event_id,attempt_id,merchant_invoice_number,original_request_id,request_timestamp,occurred_at,amount,currency,outcome,provider_status,result)
    SELECT 'DOKU','migration-event',id,'MIGRATION1','migration-request',now(),now(),25000,'IDR','IGNORED','FAILED','IGNORED' FROM attempt`);
    const read = async () => ({
      orders: await rows('SELECT * FROM orders'),
      attempts: await rows('SELECT * FROM payment_attempts'),
      notifications: await rows('SELECT * FROM payment_notifications'),
    });
    const before = await read();
    await migrate(db, { migrationsFolder: 'drizzle' });
    assert.deepEqual(await read(), {
      ...before,
      attempts: before.attempts.map((row) => ({
        ...row,
        provider_account: null,
      })),
    });
    assert.deepEqual(await rows(historySql), history);
    console.log(
      'Upgrade from 0013 preserved the order, attempt and notification: PASS',
    );
    const after = await read();
    await migrate(db, { migrationsFolder: 'drizzle' });
    assert.deepEqual(await rows(historySql), history);
    assert.deepEqual(await read(), after);
    console.log('Migration replay was a no-op: PASS');
  });
} finally {
  await parent.end();
  for (const file of files) await unlink(file);
  await rmdir(meta);
  await rmdir(folder);
}
