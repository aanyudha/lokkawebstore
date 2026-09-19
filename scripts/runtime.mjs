import 'dotenv/config';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';

export const SUPPORTED_APP_RUNTIMES = Object.freeze(['fastify', 'docker']);
export const DEFAULT_APP_RUNTIME = 'fastify';

const RUNTIME_COMPOSE_FILES = Object.freeze([
  'docker-compose.yml',
  'deploy/docker-compose.runtime.yml',
]);

/** Validate APP_RUNTIME exactly. Missing defaults to fastify. */
export function readRuntime(source = process.env) {
  const value = source.APP_RUNTIME ?? DEFAULT_APP_RUNTIME;
  if (!SUPPORTED_APP_RUNTIMES.includes(value)) {
    throw new Error(
      `Invalid APP_RUNTIME "${value}". Supported values: ${SUPPORTED_APP_RUNTIMES.join(', ')}.`,
    );
  }
  return value;
}

/** Arguments for docker compose against the merged Compose project. */
export function composeArgs(action, ...rest) {
  return [
    'compose',
    ...RUNTIME_COMPOSE_FILES.flatMap((file) => ['-f', file]),
    action,
    ...rest,
  ];
}

/**
 * Docker runtime database safety. Docker mode requires DATABASE_URL_DOCKER in
 * EVERY environment - there is no default database credential and no
 * cross-runtime fallback. A Docker start without DATABASE_URL_DOCKER fails
 * immediately with a clear message. Error messages never include credential
 * values.
 */
export function requireDockerDatabaseConfig(source = process.env) {
  if (!source.DATABASE_URL_DOCKER) {
    throw new Error('APP_RUNTIME=docker requires DATABASE_URL_DOCKER.');
  }
}

/**
 * Decide how npm start should launch LOKKA without shell-specific logic.
 * APP_RUNTIME=fastify spawns the direct application command (start-app.mjs).
 * APP_RUNTIME=docker delegates to a non-destructive `docker compose up -d app`.
 */
export function planStart(source = process.env) {
  const runtime = readRuntime(source);
  if (runtime === 'docker') {
    requireDockerDatabaseConfig(source);
    return {
      runtime,
      kind: 'docker',
      command: 'docker',
      args: composeArgs('up', '-d', 'app'),
    };
  }
  return {
    runtime,
    kind: 'app',
    command: process.execPath,
    args: [fileURLToPath(new URL('./start-app.mjs', import.meta.url))],
  };
}
