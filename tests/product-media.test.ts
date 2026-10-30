import { expect, it } from 'vitest';
import { unlink } from 'node:fs/promises';
import sharp from 'sharp';
import { productMediaFixture } from './helpers/product-media-fixture.js';
import { buildApp } from '../src/app.js';
import { readEnv } from '../src/config/env.js';
import { primaryProductImage } from '../src/modules/catalog/presentation.js';

it('selects primary, then sort order and stable ID without changing input', () => {
  const rows = [
    { id: 'b', sortOrder: 0, isPrimary: false },
    { id: 'a', sortOrder: 0, isPrimary: false },
    { id: 'z', sortOrder: 10, isPrimary: true },
  ];
  expect(primaryProductImage(rows)?.id).toBe('z');
  expect(primaryProductImage(rows.slice(0, 2))?.id).toBe('a');
  expect(rows[0]!.id).toBe('b');
  expect(primaryProductImage([])).toBeNull();
});

it('shares primary media across EN/ID home, collection, detail and POS; absent/missing media stays safe', async () => {
  const f = await productMediaFixture();
  const app = await buildApp(
    readEnv({
      ...process.env,
      APP_RUNTIME: 'fastify',
      NODE_ENV: 'test',
      DATABASE_URL: f.url,
      CATALOG_STORAGE_ROOT: f.storage.root,
    }),
    { database: { ...f.database, close: async () => {} }, logger: false },
  );
  try {
    const card = f.storage.url(f.primary.storageKey, 'card');
    for (const path of [
      '/',
      '/id',
      '/collections',
      '/id/collections',
      '/id/koleksi',
    ]) {
      const response = await app.inject(path);
      expect(response.statusCode).toBe(path === '/id/collections' ? 301 : 200);
      if (response.statusCode === 301) continue;
      expect(response.body).toContain(card);
      expect(response.body).toContain('Without image');
      expect(response.body).toContain('product-placeholder');
      expect(response.body).not.toContain(f.primary.sourceStorageKey!);
      expect(response.body).not.toContain(
        f.storage.url(f.secondary.storageKey, 'card'),
      );
    }
    for (const prefix of ['/product/', '/id/produk/']) {
      const detail = await app.inject(prefix + f.product.slug);
      expect(detail.statusCode).toBe(200);
      expect(
        detail.body.indexOf(f.storage.url(f.primary.storageKey, 'detail')),
      ).toBeLessThan(
        detail.body.lastIndexOf(
          f.storage.url(f.secondary.storageKey, 'detail'),
        ),
      );
      const empty = await app.inject(prefix + f.empty.slug);
      expect(empty.statusCode).toBe(200);
      expect(empty.body).toContain('product-placeholder');
      expect(empty.body).not.toContain('/media/catalog/');
    }
    const pos = await f.salesService.searchProducts();
    expect(
      pos.find((p) => p.id === f.product.id)?.primaryImage?.storageKey,
    ).toBe(f.primary.storageKey);
    expect(pos.find((p) => p.id === f.empty.id)?.primaryImage).toBeNull();
    await unlink(f.storage.path(f.primary.storageKey, 'card'));
    let media = await app.inject(card);
    expect(media.statusCode).toBe(200);
    expect((await sharp(media.rawPayload).metadata()).format).toBe('webp');
    await f.storage.remove(f.primary.storageKey);
    media = await app.inject(card);
    expect(media.statusCode).toBe(200);
    expect((await sharp(media.rawPayload).metadata()).width).toBe(400);
    expect(
      await f.storage.readSource(f.primary.sourceStorageKey!),
    ).not.toBeNull();
    expect(
      (await app.inject(`/media/catalog/${f.primary.storageKey}/source.jpg`))
        .statusCode,
    ).toBe(404);
  } finally {
    await app.close();
    await f.cleanup();
  }
}, 60000);
