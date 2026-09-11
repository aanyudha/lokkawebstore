import 'dotenv/config';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from '../../src/db/client.js';
// Finance is global: use a disposable, independently migrated database, never owner periods.
export async function commercialDatabase() {
  const source = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!source)
    throw new Error('PostgreSQL URL required for integration verification.');
  const admin = new pg.Pool({ connectionString: source });
  const name = `lokka_verify_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(source);
  url.pathname = `/${name}`;
  const database = createDatabase(url.href);
  try {
    await migrate(database.db, { migrationsFolder: 'drizzle' });
  } catch (error) {
    await database.close();
    await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
    throw error;
  }
  return {
    database,
    url: url.href,
    async cleanup() {
      await database.close();
      await admin.query(`DROP DATABASE "${name}"`);
      await admin.end();
    },
  };
}
