import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import sharp from 'sharp';
import { accountingFixture } from './accounting-fixture.js';
import { createCatalog } from '../../src/modules/catalog/service.js';
import { LocalCatalogImageStorage } from '../../src/modules/catalog/storage.js';

export async function productMediaFixture() {
  const f = await accountingFixture();
  const storage = new LocalCatalogImageStorage(
    `storage/tests/media-${randomUUID()}`,
  );
  const catalog = createCatalog(f.db, storage);
  try {
    const empty = await catalog.saveProduct({
      name: 'Without image',
      slug: 'without-image',
      status: 'draft',
    });
    await catalog.saveVariant(empty.id, {
      name: 'M',
      sku: 'EMPTY-M',
      price: '100000',
      weightGrams: '200',
      stockQuantity: '5',
      status: 'active',
      sortOrder: '0',
    });
    await catalog.saveProduct(
      { name: empty.name, slug: empty.slug, status: 'active' },
      empty.id,
    );
    for (const product of [f.product, empty])
      for (const locale of ['en', 'id'])
        await catalog.saveProductTranslation(product.id, locale, {
          name: product.name,
          slug: product.slug,
        });
    const png = await sharp({
      create: { width: 900, height: 1100, channels: 3, background: '#ab7755' },
    })
      .png()
      .toBuffer();
    await catalog.addImages(f.product.id, [png, png], 'Fabric detail');
    const images = (await catalog.relations([f.product.id])).images;
    // The primary is neither the first uploaded nor the lowest sort order.
    await catalog.editImage(f.product.id, images[1]!.id, {
      isPrimary: 'on',
      sortOrder: '10',
      altText: 'Primary fabric',
    });
    return {
      ...f,
      catalog,
      storage,
      empty,
      primary: images[1]!,
      secondary: images[0]!,
      async cleanup() {
        await f.cleanup();
        await rm(storage.root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await f.cleanup();
    await rm(storage.root, { recursive: true, force: true });
    throw error;
  }
}
