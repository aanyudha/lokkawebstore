import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_RUNTIME,
  SUPPORTED_APP_RUNTIMES,
  planStart,
  readRuntime,
  requireDockerDatabaseConfig,
} from '../scripts/runtime.mjs';

describe('deployment runtime selector', () => {
  it('documents the exact supported values and the fastify default', () => {
    expect(SUPPORTED_APP_RUNTIMES).toEqual(['fastify', 'docker']);
    expect(DEFAULT_APP_RUNTIME).toBe('fastify');
    expect(readRuntime({})).toBe('fastify');
  });
  it.each(['fastify', 'docker'])('accepts APP_RUNTIME=%s', (mode) => {
    expect(readRuntime({ APP_RUNTIME: mode })).toBe(mode);
  });
  it('rejects an unknown APP_RUNTIME with an actionable message', () => {
    expect(() => readRuntime({ APP_RUNTIME: 'unknown' })).toThrow(
      'Invalid APP_RUNTIME "unknown". Supported values: fastify, docker.',
    );
  });
  it('selects the direct application command for fastify', () => {
    const plan = planStart({ APP_RUNTIME: 'fastify' });
    expect(plan.kind).toBe('app');
    expect(plan.command).toBe(process.execPath);
    expect(plan.args[0]!.split(/[\\/]/).pop()).toBe('start-app.mjs');
  });
  it('selects non-destructive Docker orchestration for docker', () => {
    const plan = planStart({
      APP_RUNTIME: 'docker',
      DATABASE_URL_DOCKER: 'postgresql://docker:docker@postgres:5432/lokka',
    });
    expect(plan.kind).toBe('docker');
    expect(plan.command).toBe('docker');
    const args = plan.args.join(' ');
    expect(args).toContain('docker-compose.yml');
    expect(args).toContain('deploy/docker-compose.runtime.yml');
    expect(args).toContain('up -d app');
    expect(args).not.toMatch(/down/);
    expect(args).not.toMatch(/prune/);
    expect(args).not.toMatch(/rm|remove/);
  });
  it('never routes the direct application command back through the selector', () => {
    const plan = planStart({ APP_RUNTIME: 'fastify' });
    expect(plan.args.join(' ')).not.toContain('start.mjs');
  });
  it('executes zero Docker commands in the fastify start plan', () => {
    const plan = planStart({ APP_RUNTIME: 'fastify' });
    const surface = `${plan.command} ${plan.args.join(' ')}`;
    expect(surface).not.toMatch(/\bdocker\b/i);
    expect(surface).not.toMatch(/\bcompose\b/i);
    expect(surface).not.toMatch(/ -f\b/);
    expect(plan.args[0]!.split(/[\\/]/).pop()).toBe('start-app.mjs');
  });
  it('does not select business-logic branches by runtime', () => {
    const fastify = planStart({ APP_RUNTIME: 'fastify' });
    const docker = planStart({
      APP_RUNTIME: 'docker',
      DATABASE_URL_DOCKER: 'postgresql://docker:docker@postgres:5432/lokka',
    });
    expect(fastify.runtime).toBe('fastify');
    expect(docker.runtime).toBe('docker');
    expect(fastify.kind).not.toBe(docker.kind);
  });
  it('requires DATABASE_URL_DOCKER for every Docker start, including development', () => {
    for (const nodeEnv of ['development', 'production', 'test']) {
      expect(() =>
        planStart({ APP_RUNTIME: 'docker', NODE_ENV: nodeEnv }),
      ).toThrow('APP_RUNTIME=docker requires DATABASE_URL_DOCKER.');
      expect(() => requireDockerDatabaseConfig({ NODE_ENV: nodeEnv })).toThrow(
        'APP_RUNTIME=docker requires DATABASE_URL_DOCKER.',
      );
    }
  });
  it('accepts an explicit DATABASE_URL_DOCKER in every environment', () => {
    for (const nodeEnv of ['development', 'production']) {
      const plan = planStart({
        APP_RUNTIME: 'docker',
        NODE_ENV: nodeEnv,
        DATABASE_URL_DOCKER:
          'postgresql://lokka:production@postgres:5432/lokka',
      });
      expect(plan.kind).toBe('docker');
      expect(() =>
        requireDockerDatabaseConfig({
          NODE_ENV: nodeEnv,
          DATABASE_URL_DOCKER:
            'postgresql://lokka:production@postgres:5432/lokka',
        }),
      ).not.toThrow();
    }
  });
  it('never includes database credentials in guard errors', () => {
    let message = '';
    try {
      requireDockerDatabaseConfig({});
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toMatch(/postgres|password|secret|@|:/i);
  });
});
