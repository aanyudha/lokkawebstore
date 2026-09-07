import 'dotenv/config';
import { readEnv } from '../config/env.js';
import { createDatabase } from './client.js';
import { vendors } from './schema/index.js';
const database = createDatabase(readEnv().databaseUrl);
try {
  await database.db
    .insert(vendors)
    .values({ slug: 'lokka', name: 'LOKKA', status: 'active' })
    .onConflictDoNothing({ target: vendors.slug });
  console.info('LOKKA vendor seed complete');
} finally {
  await database.close();
}
