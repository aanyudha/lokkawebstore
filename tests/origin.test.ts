import { describe, expect, it } from 'vitest';
import { createOriginValidator } from '../src/security/origin.js';
import { readEnv } from '../src/config/env.js';

const lan = 'http://192.168.1.122:3000';
const development = createOriginValidator({
  appUrl: lan,
  nodeEnv: 'development',
  developmentOrigins: ['http://127.0.0.1:3000'],
});
describe('central trusted-origin policy', () => {
  it.each([lan, 'http://127.0.0.1:3000', 'http://localhost:3000'])(
    'accepts the explicit development entry point %s',
    (origin) => {
      expect(development(origin)).toBe(true);
    },
  );
  it.each([
    'http://evil.example',
    'http://127.0.0.1:9999',
    'http://192.168.1.122:9999',
    'https://192.168.1.122:3000',
    'null',
    '',
    'not-an-origin',
    `${lan}/`,
    `${lan}/id/akun`,
    `${lan}?x=1`,
    `${lan}#x`,
    'http://user:pass@192.168.1.122:3000',
    `${lan}, http://evil.example`,
    ['http://127.0.0.1:3000'],
    null,
  ])('rejects a forged or malformed origin %j', (origin) => {
    expect(development(origin)).toBe(false);
  });
  it('retains missing-Origin support independently of session/CSRF validation', () => {
    expect(development(undefined)).toBe(true);
  });
  it('does not infer an unconfigured LAN origin from a loopback installation', () => {
    expect(
      createOriginValidator({
        appUrl: 'http://127.0.0.1:3000',
        nodeEnv: 'development',
      })(lan),
    ).toBe(false);
  });
  it('keeps production canonical-only despite development aliases', () => {
    const check = createOriginValidator({
      appUrl: 'https://shop.example',
      nodeEnv: 'production',
      developmentOrigins: [lan, 'http://127.0.0.1:3000'],
    });
    expect(check('https://shop.example')).toBe(true);
    for (const origin of [
      lan,
      'http://127.0.0.1:3000',
      'http://localhost:3000',
      'http://shop.example',
      'https://shop.example:9999',
    ])
      expect(check(origin)).toBe(false);
    const loopbackProduction = createOriginValidator({
      appUrl: 'http://127.0.0.1:3000',
      nodeEnv: 'production',
    });
    expect(loopbackProduction('http://localhost:3000')).toBe(false);
  });
  it('preserves protocol and default-port serialization for local aliases', () => {
    const check = createOriginValidator({
      appUrl: 'https://localhost:443',
      nodeEnv: 'development',
    });
    expect(check('https://127.0.0.1')).toBe(true);
    expect(check('http://127.0.0.1')).toBe(false);
    expect(check('https://127.0.0.1:3000')).toBe(false);
  });
  it('uses only the origin of a configured base URL, independent of locale paths', () => {
    expect(
      createOriginValidator({ appUrl: `${lan}/id`, nodeEnv: 'production' })(
        lan,
      ),
    ).toBe(true);
  });
});

describe('development-origin configuration', () => {
  const base = {
    APP_URL: lan,
    APP_RUNTIME: 'fastify',
    DATABASE_URL: 'postgresql://test:test@localhost/test',
  };
  it('parses an explicit list and ignores it in production', () => {
    expect(
      readEnv({
        ...base,
        NODE_ENV: 'development',
        DEV_ALLOWED_ORIGINS: 'http://127.0.0.1:3000, http://localhost:3000',
      }).developmentOrigins,
    ).toEqual(['http://127.0.0.1:3000', 'http://localhost:3000']);
    expect(
      readEnv({ ...base, NODE_ENV: 'production', DEV_ALLOWED_ORIGINS: '*' })
        .developmentOrigins,
    ).toEqual([]);
  });
  it.each([
    '*',
    'http://localhost:3000/id',
    'null',
    'localhost:3000',
    'https://user:pass@example.test',
  ])('rejects invalid development configuration %s', (value) => {
    expect(() =>
      readEnv({ ...base, NODE_ENV: 'development', DEV_ALLOWED_ORIGINS: value }),
    ).toThrow('Invalid DEV_ALLOWED_ORIGINS');
  });
});
