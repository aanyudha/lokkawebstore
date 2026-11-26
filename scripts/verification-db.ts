import { randomUUID } from 'node:crypto';
import pg from 'pg';

const disposable =
  /^lokka_(?:e1_verify|verify|production|browser|audit)_[a-f0-9]{32}$/;
type Scope = 'e1_verify' | 'verify' | 'production' | 'browser' | 'audit';

export function databaseUrl(source: string | undefined) {
  try {
    const url = new URL(source ?? '');
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      !/^\/[^/]+$/.test(url.pathname)
    )
      throw new Error();
    return url;
  } catch {
    throw new Error(
      'Verification requires a PostgreSQL URL with an explicit database.',
    );
  }
}

export function assertDisposableName(
  name: string,
  owner = process.env.LOKKA_VERIFY_OWNER_DB,
) {
  if (!owner || !disposable.test(name) || name === owner)
    throw new Error(
      'Refusing verification connection without a protected owner and a separate disposable database.',
    );
}

export function testDatabaseUrl(source = process.env.TEST_DATABASE_URL) {
  const url = databaseUrl(source);
  assertDisposableName(url.pathname.slice(1));
  return url;
}

export function disposableDatabaseUrl(
  source: URL,
  scope: Scope,
  owner = process.env.LOKKA_VERIFY_OWNER_DB,
) {
  const target = new URL(source);
  const name = `lokka_${scope}_${randomUUID().replaceAll('-', '')}`;
  assertDisposableName(name, owner);
  target.pathname = '/' + name;
  return { name, url: target.href };
}

export async function assertDatabaseIdentity(url: string, expected: string) {
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    await assertConnectedDatabase(client, expected);
  } finally {
    await client.end();
  }
}

export async function assertConnectedDatabase(
  client: Pick<pg.Client, 'query'>,
  expected: string,
) {
  const { rows } = await client.query<{ name: string }>(
    'SELECT current_database() AS name',
  );
  if (rows[0]?.name !== expected)
    throw new Error(
      'PostgreSQL resolved a different database than requested for verification.',
    );
}

export function verificationEnv(
  url: string,
  owner = process.env.LOKKA_VERIFY_OWNER_DB,
) {
  const name = databaseUrl(url).pathname.slice(1);
  assertDisposableName(name, owner);
  const preload = new URL('./verification-pg-guard.mjs', import.meta.url).href;
  return {
    ...process.env,
    APP_RUNTIME: 'fastify',
    NODE_ENV: 'test',
    DATABASE_URL: url,
    TEST_DATABASE_URL: url,
    DATABASE_URL_DOCKER: url,
    PGDATABASE: name,
    // Dotenv treats any nonempty override string as true.
    DOTENV_CONFIG_OVERRIDE: '',
    PAYMENT_PROVIDER: 'disabled',
    SHIPPING_RATE_PROVIDER: 'disabled',
    JNT_TARIFF_URL: '',
    JNT_TARIFF_CUSTOMER_NAME: '',
    JNT_TARIFF_KEY: '',
    DOKU_CLIENT_ID: '',
    DOKU_SECRET_KEY: '',
    DOKU_NOTIFICATION_URL: '',
    LOKKA_VERIFY_OWNER_DB: owner,
    LOKKA_BROWSER_DATABASE_SOURCE: '',
    NODE_OPTIONS: `--import=${preload}`,
  };
}
