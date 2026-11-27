import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { readEnv } from '../src/config/env.js';
import { dokuFixture } from './helpers/doku-fixture.js';

const sandbox = {
  DATABASE_URL: 'postgresql://127.0.0.1:1/config-only',
  APP_URL: 'http://192.168.1.122:3000',
  PAYMENT_PROVIDER: 'doku',
  DOKU_ENV: 'sandbox',
  DOKU_CLIENT_ID: dokuFixture.clientId,
  DOKU_SECRET_KEY: dokuFixture.secretKey,
  DOKU_NOTIFICATION_URL: dokuFixture.notificationUrl,
};

it('accepts local mode without DOKU credentials in development and test only', () => {
  for (const NODE_ENV of ['development', 'test']) {
    const env = readEnv({
      DATABASE_URL: sandbox.DATABASE_URL,
      APP_URL: sandbox.APP_URL,
      PAYMENT_PROVIDER: 'local',
      NODE_ENV,
    });
    expect(env.paymentMode).toBe('local');
    expect(env.doku).toBeNull();
    expect(env.paymentReadiness).toMatchObject({
      provider: 'Local development',
      developmentOnly: true,
    });
  }
  expect(() =>
    readEnv({ ...sandbox, PAYMENT_PROVIDER: 'local', NODE_ENV: 'production' }),
  ).toThrow('PAYMENT_PROVIDER=local');
});

it('fails startup in production with local payments explicitly enabled', () => {
  const child = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'src/server.ts'],
    {
      env: {
        ...process.env,
        ...sandbox,
        DATABASE_URL: process.env.TEST_DATABASE_URL ?? sandbox.DATABASE_URL,
        APP_RUNTIME: 'fastify',
        NODE_ENV: 'production',
        PAYMENT_PROVIDER: 'local',
        HOST: '127.0.0.1',
        PORT: '3062',
      },
      encoding: 'utf8',
      timeout: 10000,
    },
  );
  expect(child.error).toBeUndefined();
  expect(child.status).toBe(1);
  expect(child.stderr).toContain(
    'Startup failed. PAYMENT_PROVIDER=local is development/test only',
  );
  expect(child.stdout).not.toContain('Server listening');
});

it('accepts an HTTP LAN return address in sandbox and reports only safe readiness fields', () => {
  const env = readEnv(sandbox);
  expect(env.appUrl).toBe(sandbox.APP_URL);
  expect(env.doku?.environment).toBe('sandbox');
  expect(env.paymentReadiness).toEqual({
    provider: 'DOKU Sandbox',
    notificationConfigured: true,
    credentialsConfigured: true,
  });
  const disabled = readEnv({
    DATABASE_URL: sandbox.DATABASE_URL,
    APP_URL: sandbox.APP_URL,
    PAYMENT_PROVIDER: 'disabled',
  });
  expect(disabled.doku).toBeNull();
  expect(disabled.paymentReadiness).toEqual({
    provider: 'Disabled',
    notificationConfigured: false,
    credentialsConfigured: false,
  });
});

it.each([
  ['DOKU_CLIENT_ID', ''],
  ['DOKU_CLIENT_ID', 'invalid client ID'],
  ['DOKU_SECRET_KEY', ' '],
  ['DOKU_ENV', 'invalid'],
  ['DOKU_NOTIFICATION_URL', ''],
  ['DOKU_NOTIFICATION_URL', 'http://example.test/payments/doku/notification'],
  ['DOKU_NOTIFICATION_URL', 'https://example.test/wrong-path'],
  [
    'DOKU_NOTIFICATION_URL',
    'https://example.test/payments/doku/notification?x=redacted',
  ],
])('rejects explicit DOKU config with an invalid %s', (field, value) => {
  expect(() => readEnv({ ...sandbox, [field]: value })).toThrow(field);
});

it('requires HTTPS APP_URL for production DOKU', () => {
  expect(() => readEnv({ ...sandbox, DOKU_ENV: 'production' })).toThrow(
    'HTTPS APP_URL',
  );
  expect(
    readEnv({
      ...sandbox,
      DOKU_ENV: 'production',
      APP_URL: 'https://shop.example.test',
    }).paymentReadiness.provider,
  ).toBe('DOKU Production');
});

it('reports the failing field at startup without exposing the supplied config values', () => {
  const invalidUrl = 'https://example.test/path-with-sensitive-value';
  const child = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'src/server.ts'],
    {
      env: {
        ...process.env,
        ...sandbox,
        DATABASE_URL: process.env.TEST_DATABASE_URL ?? sandbox.DATABASE_URL,
        APP_RUNTIME: 'fastify',
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: '3059',
        DOKU_NOTIFICATION_URL: invalidUrl,
      },
      encoding: 'utf8',
      timeout: 10000,
    },
  );
  expect(child.error).toBeUndefined();
  expect(child.status).toBe(1);
  expect(child.stderr).toContain('Startup failed. DOKU_NOTIFICATION_URL');
  for (const value of [
    sandbox.DOKU_CLIENT_ID,
    sandbox.DOKU_SECRET_KEY,
    invalidUrl,
  ])
    expect(child.stderr + child.stdout).not.toContain(value);
});
