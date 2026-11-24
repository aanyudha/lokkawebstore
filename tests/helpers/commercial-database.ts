import 'dotenv/config';
import pg from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from '../../src/db/client.js';
import {
  assertDatabaseIdentity,
  disposableDatabaseUrl,
  testDatabaseUrl,
} from '../../scripts/verification-db.js';
// Finance is global: use a disposable, independently migrated database, never owner periods.
export async function commercialDatabase() {
  const source = testDatabaseUrl();
  await assertDatabaseIdentity(source.href, source.pathname.slice(1));
  const admin = new pg.Pool({ connectionString: source.href });
  const { name, url } = disposableDatabaseUrl(source, 'verify');
  const database = createDatabase(url);
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    await assertDatabaseIdentity(url, name);
    await migrate(database.db, { migrationsFolder: 'drizzle' });
    console.log(`Integration fixture database: ${name}`);
  } catch (error) {
    await database.close();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
    throw error;
  }
  return {
    database,
    url,
    async cleanup() {
      await database.close();
      await admin.query(`DROP DATABASE "${name}"`);
      await admin.end();
    },
  };
}
