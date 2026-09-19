import 'dotenv/config';
import { readEnv } from '../config/env.js';
import { createDatabase } from './client.js';
import {
  assertDevelopmentSeedAllowed,
  seedDevelopmentData,
} from './seed-dev-data.js';

const environment = readEnv();
assertDevelopmentSeedAllowed(environment.nodeEnv);
const database = createDatabase(environment.databaseUrl);
try {
  await seedDevelopmentData(database);
  console.info('LOKKA development seed complete');
} finally {
  await database.close();
}
