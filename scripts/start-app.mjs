import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';

// Direct LOKKA application command. Used both by `npm run start:app` and as the
// container CMD. It NEVER reads APP_RUNTIME for orchestration, so it cannot
// recurse back into the deployment runtime selector (scripts/start.mjs).

const root = fileURLToPath(new URL('../', import.meta.url));
const serverEntry = fileURLToPath(
  new URL('../dist/server.js', import.meta.url),
);
const migrateEntry = fileURLToPath(
  new URL('../dist/db/migrate.js', import.meta.url),
);

if (!existsSync(serverEntry)) {
  process.stderr.write(
    'Compiled application not found. Run `npm run build` first, then `npm start`.\n',
  );
  process.exitCode = 1;
  process.exit(1);
}

const migration = spawnSync(process.execPath, [migrateEntry], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
});

if (migration.error) {
  process.stderr.write(
    `[lokka] Startup migration check could not run: ${migration.error.message}\n`,
  );
  process.exitCode = 1;
  process.exit(1);
}
if (migration.status !== 0) {
  process.stderr.write(
    '[lokka] Pending additive database migrations could not be applied. ' +
      'Is PostgreSQL reachable through DATABASE_URL? ' +
      'Start the database, then run `npm start` again (or apply migrations with `npm run db:migrate`).\n',
  );
  process.exitCode = migration.status ?? 1;
  process.exit(1);
}

// Import in-process so this process (PID 1 inside Docker) owns the server and
// receives SIGINT/SIGTERM for graceful shutdown. dist/server.js sets its own
// exit code on startup failure.
process.exitCode = 0;
await import(new URL('../dist/server.js', import.meta.url).href);
