import 'dotenv/config';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from '../../src/db/client.js';
import {
  assertDevelopmentSeedAllowed,
  seedDevelopmentData,
} from '../../src/db/seed-dev-data.js';

// One disposable PostgreSQL database backs the whole Playwright suite. It is
// created, fully migrated (the complete chain, from empty) and seeded with the
// deterministic development catalog here, then handed to every worker through
// DATABASE_URL/TEST_DATABASE_URL, and dropped again by global-teardown.ts.
// The owner development database is only read as a connection template and is
// never written to.
export default async function globalSetup(): Promise<void> {
  const source = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!source)
    throw new Error('PostgreSQL URL required for browser verification.');
  assertDevelopmentSeedAllowed(process.env.NODE_ENV ?? 'development');
  const admin = new pg.Pool({ connectionString: source });
  const name = `lokka_browser_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(source);
  url.pathname = `/${name}`;
  const database = createDatabase(url.href);
  try {
    await migrate(database.db, { migrationsFolder: 'drizzle' });
    await seedDevelopmentData(database);
  } catch (error) {
    await database.close();
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.end();
    throw error;
  }
  await database.close();
  await admin.end();
  // Playwright workers are spawned after this hook and inherit this process
  // environment; dotenv never overrides an already-set variable, so every
  // spec's readEnv({ ...process.env }) resolves to the disposable database.
  process.env.DATABASE_URL = url.href;
  process.env.TEST_DATABASE_URL = url.href;
  process.env.LOKKA_BROWSER_DATABASE_NAME = name;
  process.env.LOKKA_BROWSER_DATABASE_SOURCE = source;
}
