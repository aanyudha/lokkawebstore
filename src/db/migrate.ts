import 'dotenv/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readEnv } from '../config/env.js';
import { createDatabase } from './client.js';
const database = createDatabase(readEnv().databaseUrl);
try {
  await migrate(database.db, { migrationsFolder: 'drizzle' });
  console.info('Migrations applied');
} finally {
  await database.close();
}
