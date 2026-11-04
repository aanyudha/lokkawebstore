import 'dotenv/config';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import { spawn } from 'node:child_process';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

// Never hand the owner URL to a test process, even legacy integration tests.
const source = process.env.DATABASE_URL;
if (!source)
  throw new Error('DATABASE_URL is required as a connection template.');
const owner = new pg.Pool({ connectionString: source });
const adminUrl = new URL(source);
adminUrl.pathname = '/postgres';
const admin = new pg.Pool({ connectionString: adminUrl.href });
const name = `lokka_e1_verify_${randomUUID().replaceAll('-', '')}`;
const isolatedUrl = new URL(source);
isolatedUrl.pathname = `/${name}`;
const quote = (value) => '"' + value.replaceAll('"', '""') + '"';
async function fingerprint() {
  const client = await owner.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { rows } = await client.query(
      "SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('public', 'drizzle') ORDER BY schemaname, tablename",
    );
    const facts = [];
    for (const row of rows) {
      const result = await client.query(
        `SELECT count(*)::text AS count, md5(coalesce(string_agg(h, '' ORDER BY h), '')) AS hash FROM (SELECT md5(row_to_json(t)::text) AS h FROM ${quote(row.schemaname)}.${quote(row.tablename)} t) rows`,
      );
      facts.push({
        table: row.schemaname + '.' + row.tablename,
        ...result.rows[0],
      });
    }
    await client.query('COMMIT');
    return facts;
  } finally {
    client.release();
  }
}
function run(command, args) {
  return new Promise((resolve, reject) => {
    // cmd.exe is used only to launch npm's Windows shim, never for file operations.
    const windows = process.platform === 'win32';
    const executable = windows ? (process.env.ComSpec ?? 'cmd.exe') : command;
    const childArgs = windows
      ? ['/d', '/s', '/c', `${command} ${args.join(' ')}`]
      : args;
    const child = spawn(executable, childArgs, {
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: isolatedUrl.href,
        TEST_DATABASE_URL: isolatedUrl.href,
        DATABASE_URL_DOCKER: isolatedUrl.href,
      },
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
};
const commands = modes[process.argv[2]];
if (!commands)
  throw new Error('Use focused, unit, production, browser or webbrowser.');
let created = false;
const before = await fingerprint();
try {
  await admin.query(`CREATE DATABASE ${quote(name)}`);
  created = true;
  const pool = new pg.Pool({ connectionString: isolatedUrl.href });
  try {
    await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
  } finally {
    await pool.end();
  }
  console.log(
    `Isolated verification database: ${name}; owner tables fingerprinted: ${before.length}`,
  );
  for (const [command, args] of commands) await run(command, args);
} finally {
  if (created) await admin.query(`DROP DATABASE ${quote(name)}`);
  const after = await fingerprint();
  const unchanged = JSON.stringify(before) === JSON.stringify(after);
  console.log(
    `Owner DB isolation: ${unchanged ? 'PASS' : 'FAIL'}; ${after.length} table fingerprints compared; disposable database dropped.`,
  );
  await owner.end();
  await admin.end();
  if (!unchanged) process.exitCode = 1;
}
