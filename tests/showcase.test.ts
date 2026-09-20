import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { commercialDatabase } from './helpers/commercial-database.js';
import { createCatalog } from '../src/modules/catalog/service.js';
import { createShowcase } from '../src/modules/catalog/showcase.js';
import { LocalCatalogImageStorage } from '../src/modules/catalog/storage.js';
import { productImages } from '../src/db/schema/index.js';
import { eq } from 'drizzle-orm';

let fixture: Awaited<ReturnType<typeof commercialDatabase>>;
let catalog: ReturnType<typeof createCatalog>;
let showcase: ReturnType<typeof createShowcase>;
let productId = '';
let imageIds: string[] = [];

function makeJpeg(w = 800, h = 600) {
  return sharp({
    create: { width: w, height: h, channels: 3, background: '#c9c1b6' },
  })
    .jpeg()
    .toBuffer();
}

beforeAll(async () => {
  fixture = await commercialDatabase();
  const db = fixture.database.db;
  const { vendors } = await import('../src/db/schema/index.js');
  await db
    .insert(vendors)
    .values({ slug: 'lokka', name: 'LOKKA', status: 'active' });
  const storage = new LocalCatalogImageStorage('storage/tests/showcase-domain');
  catalog = createCatalog(db, storage);
  showcase = createShowcase(db);
  const product = await catalog.saveProduct({
    name: 'Showcase test product',
    status: 'draft',
  });
  productId = product.id;
  // Add 8 JPEG images
  const bufs = await Promise.all(Array.from({ length: 8 }, () => makeJpeg()));
  await catalog.addImages(productId, bufs, 'test images');
  const related = await catalog.relations([productId]);
  imageIds = related.images.map((i) => i.id);
}, 30000);

afterAll(async () => {
  await fixture?.cleanup();
});

describe('showcase domain — one per product', () => {
  it('creates a showcase on first access', async () => {
    const s = await showcase.getOrCreateShowcase(productId);
    expect(s).toBeDefined();
    expect(s.productId).toBe(productId);
    expect(s.status).toBe('draft');
    const s2 = await showcase.getOrCreateShowcase(productId);
    expect(s2.id).toBe(s.id);
  });
});

describe('showcase domain — selection', () => {
  it('adds images to showcase', async () => {
    const s = await showcase.getOrCreateShowcase(productId);
    await showcase.addSelection(productId, imageIds[0]!);
    await showcase.addSelection(productId, imageIds[1]!);
    const sel = await showcase.showcaseSelections(s.id);
    expect(sel).toHaveLength(2);
  });
  it('rejects duplicate selection', async () => {
    await expect(
      showcase.addSelection(productId, imageIds[0]!),
    ).rejects.toThrow('already in Showcase');
  });
  it('rejects image from another product', async () => {
    const product2 = await catalog.saveProduct({
      name: 'Other product',
      status: 'draft',
    });
    const bufs = await Promise.all([makeJpeg()]);
    await catalog.addImages(product2.id, bufs, 'other');
    const related = await catalog.relations([product2.id]);
    const otherImageId = related.images[0]!.id;
    await expect(
      showcase.addSelection(productId, otherImageId),
    ).rejects.toThrow('does not belong');
  });
  it('removes selection safely', async () => {
    const s = await showcase.getOrCreateShowcase(productId);
    const sel = await showcase.showcaseSelections(s.id);
    const toRemove = sel[0]!.selection;
    await showcase.removeSelection(toRemove.id);
    const after = await showcase.showcaseSelections(s.id);
    expect(after).toHaveLength(sel.length - 1);
    // Verify product image still exists
    const imgs = await fixture.database.db
      .select()
      .from(productImages)
      .where(eq(productImages.id, sel[0]!.image.id));
    expect(imgs).toHaveLength(1);
  });
});

describe('showcase domain — reorder', () => {
  it('reorders showcase images', async () => {
    const s = await showcase.getOrCreateShowcase(productId);
    // Re-add the removed image
    await showcase.addSelection(productId, imageIds[0]!);
    const before = await showcase.showcaseSelections(s.id);
    const ids = before.map((b) => b.selection.productImageId);
    const reversed = [...ids].reverse();
    await showcase.reorder(s.id, reversed);
    const after = await showcase.showcaseSelections(s.id);
    expect(after.map((a) => a.selection.productImageId)).toEqual(reversed);
  });
});

describe('showcase domain — cover', () => {
  it('sets cover', async () => {
    const s = await showcase.getOrCreateShowcase(productId);
    await showcase.setCover(s.id, imageIds[0]!);
    const sel = await showcase.showcaseSelections(s.id);
    const covers = sel.filter((s) => s.selection.isCover);
    expect(covers).toHaveLength(1);
    expect(covers[0]!.selection.productImageId).toBe(imageIds[0]);
  });
  it('ensures only one cover', async () => {
    const s = await showcase.getOrCreateShowcase(productId);
    await showcase.setCover(s.id, imageIds[1]!);
    const sel = await showcase.showcaseSelections(s.id);
    const covers = sel.filter((s) => s.selection.isCover);
    expect(covers).toHaveLength(1);
    expect(covers[0]!.selection.productImageId).toBe(imageIds[1]);
  });
  it('rejects cover for non-selected image', async () => {
    const s = await showcase.getOrCreateShowcase(productId);
    // Remove all selections and try to set cover
    const sel = await showcase.showcaseSelections(s.id);
    for (const item of sel) {
      await showcase.removeSelection(item.selection.id);
    }
    await expect(showcase.setCover(s.id, imageIds[0]!)).rejects.toThrow(
      'must be selected',
    );
  });
});

describe('showcase domain — product image deletion', () => {
  it('cascade-deletes showcase selection when product image is deleted', async () => {
    const s = await showcase.getOrCreateShowcase(productId);
    // Add image 2 back
    await showcase.addSelection(productId, imageIds[1]!);
    const before = await showcase.showcaseSelections(s.id);
    expect(before.length).toBeGreaterThan(0);
    // Delete the product image
    await catalog.editImage(productId, imageIds[1]!, {}, true);
    const after = await showcase.showcaseSelections(s.id);
    expect(after.length).toBe(before.length - 1);
  });
});

describe('showcase domain — readiness', () => {
  it('returns NOT_READY with insufficient images', async () => {
    const s = await showcase.getOrCreateShowcase(productId);
    const r = await showcase.computeReadiness(s.id);
    expect(r.overallState).toBe('NOT_READY');
    expect(r.hasEnoughImages).toBe(false);
  });
  it('returns NOT_READY with enough images but no cover', async () => {
    const db = fixture.database.db;
    const storage = new LocalCatalogImageStorage(
      'storage/tests/showcase-nocover',
    );
    const noCoverCatalog = createCatalog(db, storage);
    const p = await noCoverCatalog.saveProduct({
      name: 'No cover test product',
      status: 'draft',
    });
    const bufs = await Promise.all(Array.from({ length: 5 }, () => makeJpeg()));
    await noCoverCatalog.addImages(p.id, bufs, 'no cover test');
    const related = await noCoverCatalog.relations([p.id]);
    const s = await showcase.getOrCreateShowcase(p.id);
    for (const img of related.images) {
      await showcase.addSelection(p.id, img.id);
    }
    // Ensure no cover
    const sel = await showcase.showcaseSelections(s.id);
    for (const item of sel) {
      if (item.selection.isCover) {
        await showcase.removeSelection(item.selection.id);
      }
    }
    const r = await showcase.computeReadiness(s.id);
    expect(r.hasEnoughImages).toBe(true);
    expect(r.hasCover).toBe(false);
    expect(r.overallState).toBe('NOT_READY');
  });
  it('returns REVIEW_REQUIRED for high-res images needing manual review', async () => {
    const db = fixture.database.db;
    const storage = new LocalCatalogImageStorage(
      'storage/tests/showcase-review',
    );
    const reviewCatalog = createCatalog(db, storage);
    const p = await reviewCatalog.saveProduct({
      name: 'Review test product',
      status: 'draft',
    });
    // Upload 5 small JPEG images (under 2000px threshold)
    const bufs = await Promise.all(
      Array.from({ length: 5 }, () => makeJpeg(800, 600)),
    );
    await reviewCatalog.addImages(p.id, bufs, 'review test');
    const related = await reviewCatalog.relations([p.id]);
    const s = await showcase.getOrCreateShowcase(p.id);
    for (const img of related.images) {
      await showcase.addSelection(p.id, img.id);
    }
    await showcase.setCover(s.id, related.images[0]!.id);
    const r = await showcase.computeReadiness(s.id);
    expect(r.hasEnoughImages).toBe(true);
    expect(r.hasCover).toBe(true);
    expect(r.overallState).toBe('REVIEW_REQUIRED');
    expect(r.manualResolutionReviewCount).toBeGreaterThan(0);
  });
});

describe('showcase domain — status', () => {
  it('updates status and notes', async () => {
    await showcase.setStatus(productId, 'active', 'Ready for review');
    const s = await showcase.showcase(productId);
    expect(s?.status).toBe('active');
    expect(s?.notes).toBe('Ready for review');
  });
});

describe('showcase domain — independence from storefront', () => {
  it('does not change product_images sort order when reordering showcase', async () => {
    const db = fixture.database.db;
    const storage = new LocalCatalogImageStorage(
      'storage/tests/showcase-independence',
    );
    const indepCatalog = createCatalog(db, storage);
    const p = await indepCatalog.saveProduct({
      name: 'Independence test product',
      status: 'draft',
    });
    const bufs = await Promise.all(Array.from({ length: 5 }, () => makeJpeg()));
    await indepCatalog.addImages(p.id, bufs, 'independence');
    const related = await indepCatalog.relations([p.id]);
    const originalOrder = related.images.map((i) => i.id);
    const s = await showcase.getOrCreateShowcase(p.id);
    for (const img of related.images) {
      await showcase.addSelection(p.id, img.id);
    }
    const reversed = [...originalOrder].reverse();
    await showcase.reorder(s.id, reversed);
    // product_images order unchanged
    const after = await indepCatalog.relations([p.id]);
    expect(after.images.map((i) => i.id)).toEqual(originalOrder);
  });
  it('does not change storefront primary image when changing showcase cover', async () => {
    const db = fixture.database.db;
    const storage = new LocalCatalogImageStorage(
      'storage/tests/showcase-cover-independence',
    );
    const indepCatalog = createCatalog(db, storage);
    const p = await indepCatalog.saveProduct({
      name: 'Cover independence test',
      status: 'draft',
    });
    const bufs = await Promise.all(Array.from({ length: 5 }, () => makeJpeg()));
    await indepCatalog.addImages(p.id, bufs, 'cover independence');
    const related = await indepCatalog.relations([p.id]);
    const originalPrimary = related.images.find((i) => i.isPrimary)?.id;
    const s = await showcase.getOrCreateShowcase(p.id);
    for (const img of related.images) {
      await showcase.addSelection(p.id, img.id);
    }
    // Set cover to a non-primary image
    const nonPrimary = related.images.find((i) => !i.isPrimary);
    if (nonPrimary) await showcase.setCover(s.id, nonPrimary.id);
    // product_images.is_primary unchanged
    const after = await indepCatalog.relations([p.id]);
    const newPrimary = after.images.find((i) => i.isPrimary)?.id;
    expect(newPrimary).toBe(originalPrimary);
  });
  it('does not change product status when changing showcase status', async () => {
    const db = fixture.database.db;
    const storage = new LocalCatalogImageStorage(
      'storage/tests/showcase-status-independence',
    );
    const indepCatalog = createCatalog(db, storage);
    const p = await indepCatalog.saveProduct({
      name: 'Status independence test',
      status: 'draft',
    });
    await showcase.setStatus(p.id, 'active');
    const s = await indepCatalog.product(p.id);
    expect(s.status).toBe('draft');
  });
});
