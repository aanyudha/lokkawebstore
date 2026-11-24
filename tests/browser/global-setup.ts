import 'dotenv/config';
import pg from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from '../../src/db/client.js';
import {
  assertDevelopmentSeedAllowed,
  seedDevelopmentData,
} from '../../src/db/seed-dev-data.js';
import {
  assertDatabaseIdentity,
  disposableDatabaseUrl,
  testDatabaseUrl,
  verificationEnv,
} from '../../scripts/verification-db.js';

// One disposable PostgreSQL database backs the whole Playwright suite. It is
// created, fully migrated (the complete chain, from empty) and seeded with the
// deterministic development catalog here, then handed to every worker through
// DATABASE_URL/TEST_DATABASE_URL, and dropped again by global-teardown.ts.
// The owner development database is only read as a connection template and is
// never written to.
export default async function globalSetup() {
  const source = testDatabaseUrl();
  assertDevelopmentSeedAllowed(process.env.NODE_ENV ?? 'development');
  await assertDatabaseIdentity(source.href, source.pathname.slice(1));
  const admin = new pg.Pool({ connectionString: source.href });
  const { name, url } = disposableDatabaseUrl(source, 'browser');
  const database = createDatabase(url);
  let created = false;
  async function cleanup() {
    const maintenance = new pg.Pool({ connectionString: source.href });
    try {
      if (created) await maintenance.query(`DROP DATABASE "${name}"`);
    } finally {
      await maintenance.end();
    }
  }
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    await assertDatabaseIdentity(url, name);
    await migrate(database.db, { migrationsFolder: 'drizzle' });
    await seedDevelopmentData(database);
  } catch (error) {
    await database.close();
    await cleanup();
    throw error;
  } finally {
    await admin.end();
  }
  await database.close();
  // Playwright workers are spawned after this hook and inherit this process
  // environment; dotenv never overrides an already-set variable, so every
  // spec's readEnv({ ...process.env }) resolves to the disposable database.
  Object.assign(process.env, verificationEnv(url), {
    LOKKA_BROWSER_DATABASE_SOURCE: source.href,
  });
  console.log(`Playwright suite database: ${name}`);
  return cleanup;
}
