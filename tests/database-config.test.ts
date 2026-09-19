import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { readEnv, resolveDatabaseUrl } from '../src/config/env.js';

const OVERLAY_URL = new URL(
  '../deploy/docker-compose.runtime.yml',
  import.meta.url,
);
const MIGRATE_URL = new URL('../src/db/migrate.ts', import.meta.url);

describe('database configuration deployment wiring', () => {
  it('resolves the same database URL for the application and migrations', async () => {
    const composeSource = await readFile(OVERLAY_URL, 'utf8');
    expect(composeSource).toContain('APP_RUNTIME: docker');
    expect(composeSource).toMatch(/DATABASE_URL_DOCKER:/);
    expect(composeSource).not.toMatch(/development_only/);
    expect(composeSource).not.toMatch(/DATABASE_URL:\s*\$\{/);

    const migrateSource = await readFile(MIGRATE_URL, 'utf8');
    expect(migrateSource).toContain('readEnv().databaseUrl');

    const source = {
      NODE_ENV: 'test',
      APP_RUNTIME: 'fastify',
      APP_URL: 'http://127.0.0.1:3000',
      DATABASE_URL: 'postgresql://native:native@127.0.0.1:5432/lokka',
    };
    expect(resolveDatabaseUrl('fastify', source)).toBe(source.DATABASE_URL);
    expect(readEnv(source).databaseUrl).toBe(
      resolveDatabaseUrl('fastify', source),
    );
  });

  it('proves per-runtime database isolation through the resolver', () => {
    const hostDb = 'postgresql://native:native@127.0.0.1:5432/lokka';
    const containerDb = 'postgresql://docker:docker@postgres:5432/lokka';
    expect(resolveDatabaseUrl('fastify', { DATABASE_URL: hostDb })).toBe(
      hostDb,
    );
    expect(() =>
      resolveDatabaseUrl('fastify', { DATABASE_URL_DOCKER: containerDb }),
    ).toThrow('APP_RUNTIME=fastify requires DATABASE_URL.');
    expect(
      resolveDatabaseUrl('docker', { DATABASE_URL_DOCKER: containerDb }),
    ).toBe(containerDb);
    expect(() =>
      resolveDatabaseUrl('docker', { DATABASE_URL: hostDb }),
    ).toThrow('APP_RUNTIME=docker requires DATABASE_URL_DOCKER.');
  });
});
