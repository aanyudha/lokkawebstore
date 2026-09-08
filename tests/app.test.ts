import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { readEnv } from '../src/config/env.js';
const env = readEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@localhost/test',
  APP_URL: 'http://localhost:3000',
});
const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
async function setup(check = vi.fn(async () => {})) {
  const database = { check, close: vi.fn(async () => {}) };
  const app = await buildApp(env, { database, logger: false });
  apps.push(app);
  return { app, database };
}
describe('foundation routes', () => {
  it.each(['/health', '/api/v1/status'])(
    '%s returns service status',
    async (url) => {
      const { app } = await setup();
      const response = await app.inject(url);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: 'ok',
        service: 'lokka-webstore',
      });
    },
  );
  it('renders the SSR shell with localized content and security headers', async () => {
    const { app } = await setup();
    const response = await app.inject('/');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    // English homepage should have lang="en"
    expect(response.body).toContain('lang="en"');
    // Should contain English translation text
    expect(response.body).toContain('Contemporary Indonesian fashion');
    // Should include content-hashed assets
    expect(response.body).toContain('/build/');
    // Should have language switcher
    expect(response.body).toContain('EN');
    expect(response.body).toContain('ID');
    expect(response.headers['content-security-policy']).toContain(
      "script-src 'self'",
    );
    expect(response.headers['content-security-policy']).not.toContain(
      'upgrade-insecure-requests',
    );
  });
  it('renders Indonesian homepage at /id', async () => {
    const { app } = await setup();
    const response = await app.inject('/id');
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('lang="id-ID"');
    expect(response.body).toContain('Fashion Indonesia kontemporer');
  });
  it('redirects old unprefixed Indonesian routes', async () => {
    const { app } = await setup();
    const koleksi = await app.inject('/koleksi');
    expect(koleksi.statusCode).toBe(301);
    expect(koleksi.headers.location).toBe('/id/koleksi');
  });
  it('returns HTML and API 404s', async () => {
    const { app } = await setup();
    const html = await app.inject('/missing');
    expect(html.statusCode).toBe(404);
    expect(html.body).toContain('Page not found');
    const api = await app.inject('/api/v1/missing');
    expect(api.statusCode).toBe(404);
    expect(api.json()).toEqual({ error: 'Not found' });
  });
  it('returns Indonesian 404 for /id prefixed URLs', async () => {
    const { app } = await setup();
    const html = await app.inject('/id/missing');
    expect(html.statusCode).toBe(404);
    expect(html.body).toContain('Halaman tidak ditemukan');
  });
  it('checks readiness and closes the pool', async () => {
    const { app, database } = await setup();
    const response = await app.inject('/ready');
    expect(response.statusCode).toBe(200);
    expect(database.check).toHaveBeenCalledOnce();
    expect(response.headers['cache-control']).toBe('no-store');
    await app.close();
    expect(database.close).toHaveBeenCalledOnce();
  });
  it('returns 503 without database details when unavailable', async () => {
    const { app } = await setup(
      vi.fn(async () => {
        throw new Error('private database credentials');
      }),
    );
    const response = await app.inject('/ready');
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('credentials');
  });
  it('hides unexpected errors', async () => {
    const { app } = await setup();
    app.get('/failure', () => {
      throw new Error('secret detail');
    });
    const response = await app.inject('/failure');
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('secret detail');
  });
  it('rate limits API requests', async () => {
    const { app } = await setup();
    for (let i = 0; i < 60; i++) await app.inject('/api/v1/status');
    expect((await app.inject('/api/v1/status')).statusCode).toBe(429);
  });
  it('does not serve files outside the asset root', async () => {
    const { app } = await setup();
    expect((await app.inject('/build/%2e%2e/.env')).statusCode).not.toBe(200);
  });
});
describe('environment', () => {
  it('rejects missing or malformed settings without exposing values', () => {
    expect(() => readEnv({})).toThrow('DATABASE_URL');
    expect(() => readEnv({ ...process.env, PORT: '0' })).toThrow('PORT');
    expect(() => readEnv({ DATABASE_URL: 'secret' })).toThrow(
      'Invalid or missing DATABASE_URL',
    );
  });
});
