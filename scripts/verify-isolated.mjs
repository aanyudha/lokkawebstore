import 'dotenv/config';
import pg from 'pg';
import { spawn } from 'node:child_process';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import {
  assertConnectedDatabase,
  databaseUrl,
  disposableDatabaseUrl,
  verificationEnv,
} from './verification-db.ts';

// Never hand the owner URL to a test process, even legacy integration tests.
const source = process.env.DATABASE_URL;
if (!source)
  throw new Error('DATABASE_URL is required as a connection template.');
const owner = new pg.Pool({ connectionString: source });
const adminUrl = databaseUrl(source);
adminUrl.pathname = '/postgres';
const admin = new pg.Client({ connectionString: adminUrl.href });
const quote = (value) => '"' + value.replaceAll('"', '""') + '"';
async function fingerprint() {
  const client = await owner.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query(
      "SET LOCAL TIME ZONE 'UTC'; SET LOCAL DateStyle TO 'ISO, YMD'; SET LOCAL IntervalStyle TO 'postgres'; SET LOCAL extra_float_digits = 3; SET LOCAL bytea_output = 'hex';",
    );
    const identity = await client.query('SELECT current_database() AS name');
    const { rows } = await client.query(
      `SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('public', 'drizzle') ORDER BY schemaname COLLATE "C", tablename COLLATE "C"`,
    );
    const facts = [];
    for (const row of rows) {
      const result = await client.query(
        `SELECT count(*)::text AS count, md5(coalesce(string_agg(h, '' ORDER BY h COLLATE "C"), '')) AS hash FROM (SELECT md5(row_to_json(t)::text) AS h FROM ${quote(row.schemaname)}.${quote(row.tablename)} t) rows`,
      );
      facts.push({
        table: row.schemaname + '.' + row.tablename,
        ...result.rows[0],
      });
    }
    await client.query('COMMIT');
    return { owner: identity.rows[0].name, facts };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
function run(command, args, env) {
  return new Promise((resolve, reject) => {
    // cmd.exe is used only to launch npm's Windows shim, never for file operations.
    const windows = process.platform === 'win32';
    const executable = windows ? (process.env.ComSpec ?? 'cmd.exe') : command;
    const childArgs = windows
      ? ['/d', '/s', '/c', `${command} ${args.join(' ')}`]
      : args;
    const child = spawn(executable, childArgs, {
      stdio: 'inherit',
      env,
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Verification command failed (${code}).`)),
    );
  });
}
const modes = {
  focused: [['npx', ['vitest', 'run', 'tests/webstore.test.ts']]],
  // Limit contention from parallel Argon2 and database integration work.
  unit: [['npm', ['test', '--', '--maxWorkers=1']]],
  production: [['npm', ['run', 'test:production']]],
  browser: [['npm', ['run', 'test:browser']]],
  webbrowser: [
    ['npx', ['playwright', 'test', 'tests/browser/webstore.spec.ts']],
  ],
  audit: [
    [
      'npx',
      [
        'vitest',
        'run',
        'tests/doku-provider.test.ts',
        'tests/webstore-payments.test.ts',
        'tests/verification-db.test.ts',
        '--maxWorkers=1',
        '--silent=false',
      ],
    ],
    ['npm', ['run', 'test:production']],
    [
      'npm',
      ['run', 'test:browser', '--', 'tests/browser/webstore-payment.spec.ts'],
    ],
    ['node', ['scripts/verify-payment-migrations.mjs']],
  ],
  e4: [
    [
      'npm',
      [
        'test',
        '--',
        '--maxWorkers=1',
        'tests/webstore.test.ts',
        'tests/webstore-payments.test.ts',
        'tests/webstore-fulfillment.test.ts',
        'tests/doku-provider.test.ts',
        'tests/admin-foundation.test.ts',
        'tests/verification-db.test.ts',
        'tests/accounting.test.ts',
        'tests/finance-cash-flow.test.ts',
        'tests/pos.test.ts',
      ],
    ],
    ['npm', ['run', 'test:production']],
    [
      'npm',
      [
        'run',
        'test:browser',
        '--',
        'tests/browser/webstore.spec.ts',
        'tests/browser/webstore-payment.spec.ts',
      ],
    ],
    ['node', ['scripts/verify-payment-migrations.mjs']],
  ],
};
const commands = modes[process.argv[2]];
if (!commands)
  throw new Error(
    'Use focused, unit, production, browser, webbrowser, audit or e4.',
  );
let created = false;
const before = await fingerprint();
const { name, url } = disposableDatabaseUrl(
  databaseUrl(source),
  'e1_verify',
  before.owner,
);
const childEnv = verificationEnv(url, before.owner);
try {
  if (before.owner === 'postgres')
    throw new Error('Owner and maintenance databases must be separate.');
  await admin.connect();
  await assertConnectedDatabase(admin, 'postgres');
  await admin.query(`CREATE DATABASE ${quote(name)}`);
  created = true;
  const database = new pg.Client({ connectionString: url });
  try {
    await database.connect();
    await assertConnectedDatabase(database, name);
    await migrate(drizzle(database), { migrationsFolder: 'drizzle' });
  } finally {
    await database.end();
  }
  console.log(
    `Isolated verification database: ${name}; owner tables fingerprinted: ${before.facts.length}`,
  );
  for (const [command, args] of commands) await run(command, args, childEnv);
} finally {
  if (created) await admin.query(`DROP DATABASE ${quote(name)}`);
  const after = await fingerprint();
  const unchanged = JSON.stringify(before) === JSON.stringify(after);
  const prior = new Map(before.facts.map((row) => [row.table, row]));
  const current = new Map(after.facts.map((row) => [row.table, row]));
  for (const table of new Set([...prior.keys(), ...current.keys()])) {
    const original = prior.get(table);
    const latest = current.get(table);
    if (JSON.stringify(original) !== JSON.stringify(latest))
      console.log(
        `Owner fingerprint changed: ${table} (rows ${original?.count ?? 'absent'} → ${latest?.count ?? 'absent'})`,
      );
  }
  console.log(
    `Owner DB isolation: ${unchanged ? 'PASS' : 'FAIL'}; ${after.facts.length} table fingerprints compared; disposable database dropped.`,
  );
  await owner.end();
  await admin.end();
  if (!unchanged) process.exitCode = 1;
}
