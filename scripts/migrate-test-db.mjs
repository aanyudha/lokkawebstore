import 'dotenv/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { assertDatabaseIdentity, testDatabaseUrl } from './verification-db.ts';

const url = testDatabaseUrl();
await assertDatabaseIdentity(url.href, url.pathname.slice(1));
const pool = new pg.Pool({ connectionString: url.href });
try {
  await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
  console.log('Migrations applied');
} finally {
  await pool.end();
}
