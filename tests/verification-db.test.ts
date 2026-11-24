import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import {
  assertDisposableName,
  testDatabaseUrl,
  verificationEnv,
} from '../scripts/verification-db.js';

it('refuses owner and ambiguous test identities', () => {
  expect(() => testDatabaseUrl('postgresql://fixture@localhost/lokka')).toThrow(
    'Refusing',
  );
  expect(() => testDatabaseUrl('postgresql://fixture@localhost/')).toThrow(
    'explicit database',
  );
  const disposable = 'lokka_verify_' + 'a'.repeat(32);
  expect(() => assertDisposableName(disposable, disposable)).toThrow(
    'Refusing',
  );
});

it('overrides all runtime database aliases and loads the guard in children', () => {
  const url = 'postgresql://fixture@localhost/lokka_verify_' + 'b'.repeat(32);
  const owner = 'lokka_verify_' + 'c'.repeat(32);
  const env = verificationEnv(url, owner);
  expect(env).toMatchObject({
    APP_RUNTIME: 'fastify',
    DATABASE_URL: url,
    DATABASE_URL_DOCKER: url,
    TEST_DATABASE_URL: url,
    PAYMENT_PROVIDER: 'disabled',
    DOTENV_CONFIG_OVERRIDE: 'false',
  });
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import pg from 'pg';
      try {
        await new pg.Client({ host: '127.0.0.1', port: 1, database: process.env.LOKKA_VERIFY_OWNER_DB }).connect();
        process.exitCode = 2;
      } catch (error) {
        if (!error.message.startsWith('Refusing verification')) process.exitCode = 3;
      }`,
    ],
    { env, encoding: 'utf8', timeout: 5000 },
  );
  expect(child.status).toBe(0);
});
