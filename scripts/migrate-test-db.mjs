import 'dotenv/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readEnv } from '../src/config/env.js';
import { createDatabase } from '../src/db/client.js';

const env = readEnv({
  ...process.env,
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL,
});
const database = createDatabase(env.databaseUrl);
try {
  await migrate(database.db, { migrationsFolder: 'drizzle' });
  console.log('Migrations applied');
} finally {
  await database.close();
}
