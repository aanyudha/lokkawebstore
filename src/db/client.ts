import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema/index.js';
export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 3000,
    query_timeout: 3000,
    statement_timeout: 3000,
    idleTimeoutMillis: 30000,
  });
  // Never log raw driver errors: they can contain connection or query details.
  pool.on('error', () => {
    process.stderr.write('PostgreSQL idle connection error\n');
  });
  return {
    db: drizzle(pool, { schema }),
    check: async () => {
      await pool.query('SELECT 1');
    },
    close: () => pool.end(),
  };
}
export type Database = ReturnType<typeof createDatabase>;
