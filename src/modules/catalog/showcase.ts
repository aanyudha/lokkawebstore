import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  products,
  productImages,
  productShowcases,
  productShowcaseImages,
  vendors,
} from '../../db/schema/index.js';
import { FormError, id } from './validation.js';

export interface ReadinessResult {
  selectedCount: number;
  minimumRequired: number;
  hasEnoughImages: boolean;
  hasCover: boolean;
  missingSourceCount: number;
  invalidSourceFormatCount: number;
  manualResolutionReviewCount: number;
  overallState: 'READY' | 'NOT_READY' | 'REVIEW_REQUIRED';
  issues: string[];
}

export function createShowcase(db: Database['db']) {
  async function vendorId() {
    const [vendor] = await db
      .select()
      .from(vendors)
      .where(eq(vendors.slug, 'lokka'));
    if (!vendor) throw new Error('Run vendor seed');
    return vendor.id;
  }

  async function ensureProduct(productId: string) {
    const [p] = await db
      .select()
      .from(products)
      .where(
        and(
          eq(products.id, id(productId)),
          eq(products.vendorId, await vendorId()),
        ),
      );
    if (!p) throw new FormError('id', 'Product not found.');
    return p;
  }

  async function getOrCreateShowcase(productId: string) {
    await ensureProduct(productId);
    const [existing] = await db
      .select()
      .from(productShowcases)
      .where(eq(productShowcases.productId, productId));
    if (existing) return existing;
    const [row] = await db
      .insert(productShowcases)
      .values({ productId })
      .returning();
    return row!;
  }

  async function showcase(productId: string) {
    await ensureProduct(productId);
    const [row] = await db
      .select()
      .from(productShowcases)
      .where(eq(productShowcases.productId, productId));
    return row ?? null;
  }

  async function showcaseSelections(showcaseId: string) {
    return db
      .select({
        selection: productShowcaseImages,
        image: productImages,
      })
      .from(productShowcaseImages)
      .innerJoin(
        productImages,
        eq(productImages.id, productShowcaseImages.productImageId),
      )
      .where(eq(productShowcaseImages.showcaseId, showcaseId))
      .orderBy(
        asc(productShowcaseImages.sortOrder),
        asc(productShowcaseImages.id),
      );
  }

  async function addSelection(productId: string, imageId: string) {
    const showcaseRow = await getOrCreateShowcase(productId);
    const imageIdVal = id(imageId);
    const [image] = await db
      .select()
      .from(productImages)
      .where(
        and(
          eq(productImages.id, imageIdVal),
          eq(productImages.productId, productId),
        ),
      );
    if (!image)
      throw new FormError('imageId', 'Image does not belong to this product.');
    const [existing] = await db
      .select()
      .from(productShowcaseImages)
      .where(
        and(
          eq(productShowcaseImages.showcaseId, showcaseRow.id),
          eq(productShowcaseImages.productImageId, imageIdVal),
        ),
      );
    if (existing) throw new FormError('imageId', 'Image already in Showcase.');
    const [maxRow] = await db
      .select({
        maxSort: sql<number>`coalesce(max(${productShowcaseImages.sortOrder}), -1)`,
      })
      .from(productShowcaseImages)
      .where(eq(productShowcaseImages.showcaseId, showcaseRow.id));
    const maxSort = maxRow?.maxSort ?? -1;
    const [row] = await db
      .insert(productShowcaseImages)
      .values({
        showcaseId: showcaseRow.id,
        productImageId: imageIdVal,
        sortOrder: maxSort + 1,
      })
      .returning();
    return row!;
  }

  async function removeSelection(showcaseImageId: string) {
    const [sel] = await db
      .select()
      .from(productShowcaseImages)
      .where(eq(productShowcaseImages.id, id(showcaseImageId)));
    if (!sel) throw new FormError('id', 'Showcase selection not found.');
    await db
      .delete(productShowcaseImages)
      .where(eq(productShowcaseImages.id, sel.id));
    return sel;
  }

  async function reorder(showcaseId: string, orderedImageIds: string[]) {
    await db.transaction(async (tx) => {
      await tx
        .select()
        .from(productShowcases)
        .where(eq(productShowcases.id, showcaseId))
        .for('update');
      for (let i = 0; i < orderedImageIds.length; i++) {
        await tx
          .update(productShowcaseImages)
          .set({ sortOrder: i, updatedAt: new Date() })
          .where(
            and(
              eq(productShowcaseImages.showcaseId, showcaseId),
              eq(productShowcaseImages.productImageId, id(orderedImageIds[i])),
            ),
          );
      }
    });
  }

  async function setCover(showcaseId: string, imageId: string) {
    const imageIdVal = id(imageId);
    await db.transaction(async (tx) => {
      await tx
        .select()
        .from(productShowcases)
        .where(eq(productShowcases.id, showcaseId))
        .for('update');
      const [sel] = await tx
        .select()
        .from(productShowcaseImages)
        .where(
          and(
            eq(productShowcaseImages.showcaseId, showcaseId),
            eq(productShowcaseImages.productImageId, imageIdVal),
          ),
        );
      if (!sel)
        throw new FormError(
          'imageId',
          'Image must be selected in Showcase before setting as cover.',
        );
      await tx
        .update(productShowcaseImages)
        .set({ isCover: false, updatedAt: new Date() })
        .where(eq(productShowcaseImages.showcaseId, showcaseId));
      await tx
        .update(productShowcaseImages)
        .set({ isCover: true, updatedAt: new Date() })
        .where(eq(productShowcaseImages.id, sel.id));
    });
  }

  async function setStatus(productId: string, status: string, notes?: string) {
    const showcaseRow = await getOrCreateShowcase(productId);
    const values: Record<string, unknown> = {
      status,
      updatedAt: new Date(),
    };
    if (notes !== undefined) values.notes = notes;
    await db
      .update(productShowcases)
      .set(values)
      .where(eq(productShowcases.id, showcaseRow.id));
  }

  async function computeReadiness(
    showcaseId: string,
  ): Promise<ReadinessResult> {
    const selections = await showcaseSelections(showcaseId);
    const issues: string[] = [];
    const minimumRequired = 5;
    const selectedCount = selections.length;
    const hasEnoughImages = selectedCount >= minimumRequired;
    if (!hasEnoughImages)
      issues.push(
        `Selected photos ${selectedCount} / ${minimumRequired} — need at least ${minimumRequired}.`,
      );
    const hasCover = selections.some((s) => s.selection.isCover);
    if (!hasCover) issues.push('Cover photo not selected.');
    let missingSourceCount = 0;
    let invalidSourceFormatCount = 0;
    let manualResolutionReviewCount = 0;
    for (const s of selections) {
      if (!s.image.sourceFormat) {
        missingSourceCount++;
      } else if (
        s.image.sourceFormat !== 'jpeg' &&
        s.image.sourceFormat !== 'png'
      ) {
        invalidSourceFormatCount++;
      }
      if (
        !s.image.sourceWidth ||
        !s.image.sourceHeight ||
        s.image.sourceWidth < 2000 ||
        s.image.sourceHeight < 2000
      ) {
        manualResolutionReviewCount++;
      }
    }
    if (missingSourceCount > 0)
      issues.push(
        `${missingSourceCount} image(s) missing original JPG/PNG source — re-upload recommended.`,
      );
    if (invalidSourceFormatCount > 0)
      issues.push(
        `${invalidSourceFormatCount} image(s) have WebP-only source — JPG/PNG source unavailable.`,
      );
    if (manualResolutionReviewCount > 0)
      issues.push(
        `${manualResolutionReviewCount} image(s) require high-resolution visual review.`,
      );
    let overallState: ReadinessResult['overallState'] = 'READY';
    if (!hasEnoughImages || !hasCover || missingSourceCount > 0)
      overallState = 'NOT_READY';
    else if (invalidSourceFormatCount > 0 || manualResolutionReviewCount > 0)
      overallState = 'REVIEW_REQUIRED';
    return {
      selectedCount,
      minimumRequired,
      hasEnoughImages,
      hasCover,
      missingSourceCount,
      invalidSourceFormatCount,
      manualResolutionReviewCount,
      overallState,
      issues,
    };
  }

  async function showcaseIndex() {
    const allProducts = await db
      .select({
        product: products,
        showcase: productShowcases,
      })
      .from(products)
      .leftJoin(productShowcases, eq(productShowcases.productId, products.id))
      .where(eq(products.vendorId, await vendorId()))
      .orderBy(sql`${products.name} asc nulls last`);

    const results = await Promise.all(
      allProducts.map(async (row) => {
        let selectedCount = 0;
        let hasCover = false;
        let readiness: ReadinessResult | null = null;
        if (row.showcase) {
          const selections = await showcaseSelections(row.showcase.id);
          selectedCount = selections.length;
          hasCover = selections.some((s) => s.selection.isCover);
          readiness = await computeReadiness(row.showcase.id);
        }
        return {
          product: row.product,
          showcase: row.showcase,
          selectedCount,
          hasCover,
          readiness,
        };
      }),
    );
    return results;
  }

  return {
    showcase,
    getOrCreateShowcase,
    showcaseSelections,
    addSelection,
    removeSelection,
    reorder,
    setCover,
    setStatus,
    computeReadiness,
    showcaseIndex,
  };
}

export type Showcase = ReturnType<typeof createShowcase>;
