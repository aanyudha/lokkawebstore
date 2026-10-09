import pg from 'pg';

// Drops the disposable suite database created by global-setup.ts. Both hooks
// run in the same Playwright main process, so the names stashed by the setup
// are still available here. Connections are terminated first so the drop
// cannot be blocked by a lingering pool.
export default async function globalTeardown(): Promise<void> {
  const name = process.env.LOKKA_BROWSER_DATABASE_NAME;
  const source = process.env.LOKKA_BROWSER_DATABASE_SOURCE;
  if (!name || !source) return;
  const admin = new pg.Pool({ connectionString: source });
  try {
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [name],
    );
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
  } finally {
    await admin.end();
  }
}
