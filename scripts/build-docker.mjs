import 'dotenv/config';
import { execFileSync, spawnSync } from 'node:child_process';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';
import {
  composeArgs,
  readRuntime,
  requireDockerDatabaseConfig,
} from './runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

/** Resolve Git metadata on the host, or null when unavailable. */
function gitValue(args) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

/** Bake host Git provenance into the image build args, never .git itself. */
function injectBuildMetadata() {
  const commit = gitValue(['rev-parse', 'HEAD']);
  if (commit && /^[a-f0-9]{40,64}$/.test(commit))
    process.env.LOKKA_GIT_COMMIT = commit;
  const status = gitValue([
    'status',
    '--porcelain',
    '--untracked-files=normal',
  ]);
  process.env.LOKKA_GIT_DIRTY =
    status === null ? 'unknown' : status === '' ? 'false' : 'true';
  process.env.LOKKA_BUILD_TIMESTAMP = new Date().toISOString();
}

/** Build the LOKKA application Docker image when APP_RUNTIME=docker. */
function main() {
  let runtime;
  try {
    runtime = readRuntime();
    if (runtime === 'docker') requireDockerDatabaseConfig();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (runtime !== 'docker') return;

  injectBuildMetadata();
  const result = spawnSync('docker', composeArgs('build', 'app'), {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) {
    process.stderr.write(
      `[lokka] APP_RUNTIME=docker requires the Docker CLI: ${result.error.message}\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.exitCode = result.status ?? 1;
}

main();
