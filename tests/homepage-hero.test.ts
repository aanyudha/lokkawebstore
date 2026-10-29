import { beforeAll, afterAll, beforeEach, it, expect, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { readdir, unlink } from 'node:fs/promises';
import sharp from 'sharp';
import { accountingFixture } from './helpers/accounting-fixture.js';
import { buildApp } from '../src/app.js';
import { readEnv } from '../src/config/env.js';
import { homepageHero } from '../src/db/schema/index.js';
import { LocalCatalogImageStorage } from '../src/modules/catalog/storage.js';
import { createHomepageHero } from '../src/modules/storefront/hero.js';

let f: Awaited<ReturnType<typeof accountingFixture>>;
let app: FastifyInstance;
const storage = new LocalCatalogImageStorage(
  `storage/tests/hero-${randomUUID()}`,
);
let hero: ReturnType<typeof createHomepageHero>;
let cookie: string, csrf: string, png: Buffer;
const origin = 'http://localhost:3000';
const files = async () => readdir(storage.root).catch(() => []);
beforeAll(async () => {
  f = await accountingFixture();
  hero = createHomepageHero(f.db, storage);
  png = await sharp({
    create: { width: 1800, height: 1200, channels: 3, background: '#b49877' },
  })
    .png()
    .toBuffer();
  app = await buildApp(
    readEnv({
      ...process.env,
      NODE_ENV: 'test',
      APP_RUNTIME: 'fastify',
      DATABASE_URL: f.url,
      APP_URL: origin,
      CATALOG_STORAGE_ROOT: storage.root,
    }),
    { database: { ...f.database, close: async () => {} }, logger: false },
  );
  const login = await app.inject('/admin/login');
  const result = await app.inject({
    method: 'POST',
    url: '/admin/login',
    cookies: Object.fromEntries(login.cookies.map((c) => [c.name, c.value])),
    payload: {
      csrf: login.cookies.find((c) => c.name === 'lokka_login_csrf')!.value,
      email: f.admin.email,
      password: 'temporary-accounting-password',
    },
  });
  cookie = result.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  csrf = result.cookies.find((c) => c.name === 'lokka_admin_csrf')!.value;
}, 60000);
beforeEach(async () => {
  await hero.clear();
});
afterAll(async () => {
  await hero?.clear();
  await app?.close();
  await f?.cleanup();
});
function upload(
  data: Buffer,
  token = csrf,
  requestOrigin = origin,
  firstFile = false,
) {
  const boundary = 'hero-boundary';
  const field = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="csrf"\r\n\r\n${token}\r\n`,
  );
  const image = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="hero.png"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    data,
    Buffer.from('\r\n'),
  ]);
  return app.inject({
    method: 'POST',
    url: '/admin/settings/homepage',
    headers: {
      cookie,
      origin: requestOrigin,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.concat([
      ...(firstFile ? [image, field] : [field, image]),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="altText"\r\n\r\nLOKKA fabric\r\n--${boundary}--\r\n`,
      ),
    ]),
  });
}
it('renders empty EN/ID homepage without image requests or random product fallback', async () => {
  for (const path of ['/', '/id']) {
    const r = await app.inject(path);
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('hero-placeholder');
    expect(r.body).not.toContain('class="hero-image"');
  }
});
it('saves authenticated upload and serves only public WebP, shared across locales', async () => {
  expect((await upload(png)).statusCode).toBe(303);
  const image = (await hero.publicImage())!;
  expect(image.src).toMatch(/^\/media\/homepage\//);
  const row = (await hero.get())!;
  for (const path of ['/', '/id']) {
    const r = await app.inject(path);
    expect(r.body).toContain(image.src);
    expect(r.body).toContain('LOKKA fabric');
    expect(r.body).not.toContain(row.sourceStorageKey);
    expect(r.body).not.toContain(storage.root);
  }
  const publicImage = await app.inject(image.src);
  expect(publicImage.statusCode).toBe(200);
  expect((await sharp(publicImage.rawPayload).metadata()).format).toBe('webp');
  expect(
    (await app.inject(`/media/homepage/${row.sourceStorageKey}/source.png`))
      .statusCode,
  ).toBe(404);
  expect(
    (await app.inject(`/media/catalog/${row.storageKey}/card.webp`)).statusCode,
  ).toBe(404);
});
it('replacement changes runtime URL and safely cleans old derivatives and private source', async () => {
  await hero.save(png, 'first');
  const old = (await hero.get())!;
  await hero.save(png, 'second');
  const current = (await hero.get())!;
  expect(current.storageKey).not.toBe(old.storageKey);
  expect(await files()).toHaveLength(4);
  expect((await app.inject((await hero.publicImage())!.src)).statusCode).toBe(
    200,
  );
  expect(current.updatedAt.getTime()).toBeGreaterThanOrEqual(
    old.updatedAt.getTime(),
  );
});
it('rejects corrupt/unsupported image while preserving the existing image', async () => {
  await hero.save(png, 'keep');
  const old = (await hero.get())!;
  expect(
    (await upload(Buffer.from('<svg><script>alert(1)</script></svg>')))
      .statusCode,
  ).toBe(422);
  expect((await hero.get())!.storageKey).toBe(old.storageKey);
  expect(await files()).toHaveLength(4);
});
it('requires a real DB session, correct origin and CSRF before file storage', async () => {
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/admin/settings/homepage',
        payload: { csrf },
      })
    ).statusCode,
  ).toBe(303);
  for (const token of ['', 'invalid'])
    expect((await upload(png, token)).statusCode).toBe(403);
  expect((await upload(png, csrf, 'http://evil.example')).statusCode).toBe(403);
  expect((await upload(png, csrf, origin, true)).statusCode).toBe(403);
  expect(await files()).toHaveLength(0);
});
it('updates escaped configurable alt text without replacing media and allows decorative empty alt', async () => {
  await hero.save(png, '');
  const old = (await hero.get())!;
  await hero.save(undefined, '<script>alert(1)</script>');
  const r = await app.inject('/');
  expect(r.body).toContain('&lt;script&gt;');
  expect((await hero.get())!.storageKey).toBe(old.storageKey);
  await expect(hero.save(undefined, 'x'.repeat(301))).rejects.toThrow();
});
it('rolls back reference and removes new files if the database write fails', async () => {
  await hero.save(png, 'keep');
  const old = (await hero.get())!;
  const transaction = vi
    .spyOn(f.db, 'transaction')
    .mockRejectedValueOnce(new Error('Simulated database failure'));
  await expect(hero.save(png, 'new')).rejects.toThrow(
    'Simulated database failure',
  );
  transaction.mockRestore();
  expect((await hero.get())!.storageKey).toBe(old.storageKey);
  expect(await files()).toHaveLength(4);
});
it('missing derivative files return an optimized neutral fallback without exposing the original', async () => {
  await hero.save(png, 'fabric');
  const row = (await hero.get())!;
  for (const size of ['thumb', 'card', 'detail'] as const)
    await unlink(storage.path(row.storageKey, size));
  const r = await app.inject((await hero.publicImage())!.src);
  expect(r.statusCode).toBe(200);
  expect((await sharp(r.rawPayload).metadata()).format).toBe('webp');
  expect(r.rawPayload.equals(png)).toBe(false);
});
it('invalid persisted media reference falls back without constructing an unsafe URL', async () => {
  await hero.save(png, 'fabric');
  const old = (await hero.get())!;
  await f.db
    .update(homepageHero)
    .set({ storageKey: '../../private', updatedAt: new Date() });
  const r = await app.inject('/id');
  expect(r.statusCode).toBe(200);
  expect(r.body).toContain('hero-placeholder');
  await f.db
    .update(homepageHero)
    .set({ storageKey: old.storageKey, updatedAt: new Date() });
});
it('clear removes reference before files and returns the normal neutral fallback', async () => {
  await hero.save(png, 'fabric');
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/admin/settings/homepage/remove',
        headers: { cookie, origin },
        payload: { csrf },
      })
    ).statusCode,
  ).toBe(303);
  expect(await hero.get()).toBeNull();
  expect(await files()).toHaveLength(0);
  expect((await app.inject('/')).body).toContain('hero-placeholder');
});
