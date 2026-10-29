import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  categories,
  products,
  productVariants,
  productImages,
  vendors,
  productTranslations,
  categoryTranslations,
} from '../../db/schema/index.js';
import {
  FormError,
  type Form,
  textField,
  id,
  integer,
  choice,
  slug,
  variantInput,
  databaseError,
} from './validation.js';
import type { CatalogImageStorage } from './storage.js';
import { supportedLocaleCodes } from '../../i18n/index.js';

export function createCatalog(
  db: Database['db'],
  storage: CatalogImageStorage,
) {
  async function vendorId() {
    const [vendor] = await db
      .select()
      .from(vendors)
      .where(eq(vendors.slug, 'lokka'));
    if (!vendor) throw new Error('Run vendor seed');
    return vendor.id;
  }
  async function product(productId: string) {
    const [p] = await db
      .select()
      .from(products)
      .where(
        and(
          eq(products.id, id(productId)),
          eq(products.vendorId, await vendorId()),
        ),
      );
    if (!p) throw new FormError('id', 'Produk tidak ditemukan.');
    return p;
  }
  async function categoryList() {
    return db
      .select()
      .from(categories)
      .orderBy(asc(categories.sortOrder), asc(categories.name));
  }
  async function relations(ids: string[]) {
    if (!ids.length) return { variants: [], images: [] };
    const [variants, images] = await Promise.all([
      db
        .select()
        .from(productVariants)
        .where(inArray(productVariants.productId, ids))
        .orderBy(asc(productVariants.sortOrder), asc(productVariants.sku)),
      db
        .select()
        .from(productImages)
        .where(inArray(productImages.productId, ids))
        .orderBy(
          desc(productImages.isPrimary),
          asc(productImages.sortOrder),
          asc(productImages.id),
        ),
    ]);
    return { variants, images };
  }

  // ─── Locale-aware catalog methods ──────────────────────────

  /** Get a product translation by locale and slug */
  async function localizedProduct(locale: string, localeSlug: string) {
    const [translation] = await db
      .select({
        translation: productTranslations,
        product: products,
      })
      .from(productTranslations)
      .innerJoin(products, eq(products.id, productTranslations.productId))
      .where(
        and(
          eq(productTranslations.locale, locale),
          eq(productTranslations.slug, localeSlug),
          eq(products.status, 'active'),
          eq(products.vendorId, await vendorId()),
        ),
      )
      .limit(1);
    if (!translation) return null;
    const related = await relations([translation.product.id]);
    return {
      product: translation.product,
      translation: translation.translation,
      variants: related.variants.filter((v) => v.status === 'active'),
      images: related.images,
    };
  }

  /** Get a category translation by locale and slug */
  async function localizedCategory(locale: string, localeSlug: string) {
    const [result] = await db
      .select({
        translation: categoryTranslations,
        category: categories,
      })
      .from(categoryTranslations)
      .innerJoin(categories, eq(categories.id, categoryTranslations.categoryId))
      .where(
        and(
          eq(categoryTranslations.locale, locale),
          eq(categoryTranslations.slug, localeSlug),
        ),
      )
      .limit(1);
    return result ?? null;
  }

  /** Get all translations for a product */
  async function productTranslationsList(productId: string) {
    return db
      .select()
      .from(productTranslations)
      .where(eq(productTranslations.productId, productId));
  }

  /** Get all translations for a category */
  async function categoryTranslationsList(categoryId: string) {
    return db
      .select()
      .from(categoryTranslations)
      .where(eq(categoryTranslations.categoryId, categoryId));
  }

  /** Get a product translation by product ID and locale */
  async function productTranslationFor(productId: string, locale: string) {
    const [result] = await db
      .select()
      .from(productTranslations)
      .where(
        and(
          eq(productTranslations.productId, productId),
          eq(productTranslations.locale, locale),
        ),
      );
    return result ?? null;
  }

  /** Get a category translation by category ID and locale */
  async function categoryTranslationFor(categoryId: string, locale: string) {
    const [result] = await db
      .select()
      .from(categoryTranslations)
      .where(
        and(
          eq(categoryTranslations.categoryId, categoryId),
          eq(categoryTranslations.locale, locale),
        ),
      );
    return result ?? null;
  }

  /** Save or update a product translation */
  async function saveProductTranslation(
    productId: string,
    locale: string,
    form: Form,
  ) {
    if (!supportedLocaleCodes.includes(locale as never))
      throw new FormError('locale', 'Locale tidak valid.');
    await product(productId);
    const name = textField(form, 'name', 200, true);
    const localeSlug = slug(form, name);
    const values = {
      productId,
      locale,
      name,
      slug: localeSlug,
      shortDescription: textField(form, 'shortDescription', 500) || null,
      description: textField(form, 'description', 20000) || null,
      seoTitle: textField(form, 'seoTitle', 150) || null,
      seoDescription: textField(form, 'seoDescription', 320) || null,
      updatedAt: new Date(),
    };
    try {
      const existing = await productTranslationFor(productId, locale);
      if (existing) {
        const [row] = await db
          .update(productTranslations)
          .set(values)
          .where(eq(productTranslations.id, existing.id))
          .returning();
        return row!;
      }
      const [row] = await db
        .insert(productTranslations)
        .values(values)
        .returning();
      return row!;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === '23505') {
        throw new FormError(
          'slug',
          `Slug "${localeSlug}" already used for locale "${locale}". Use a unique slug.`,
        );
      }
      throw error;
    }
  }

  /** Save or update a category translation */
  async function saveCategoryTranslation(
    categoryId: string,
    locale: string,
    form: Form,
  ) {
    if (!supportedLocaleCodes.includes(locale as never))
      throw new FormError('locale', 'Locale tidak valid.');
    const name = textField(form, 'name', 150, true);
    const localeSlug = slug(form, name);
    const values = {
      categoryId,
      locale,
      name,
      slug: localeSlug,
      shortDescription: textField(form, 'shortDescription', 500) || null,
      seoTitle: textField(form, 'seoTitle', 150) || null,
      seoDescription: textField(form, 'seoDescription', 320) || null,
      updatedAt: new Date(),
    };
    try {
      const existing = await categoryTranslationFor(categoryId, locale);
      if (existing) {
        const [row] = await db
          .update(categoryTranslations)
          .set(values)
          .where(eq(categoryTranslations.id, existing.id))
          .returning();
        return row!;
      }
      const [row] = await db
        .insert(categoryTranslations)
        .values(values)
        .returning();
      return row!;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === '23505') {
        throw new FormError(
          'slug',
          `Slug "${localeSlug}" already used for locale "${locale}". Use a unique slug.`,
        );
      }
      throw error;
    }
  }

  /** Locale-aware public collection listing */
  async function publicListLocale(
    page: number,
    locale: string,
    categoryId?: string,
  ) {
    const baseCondition = and(
      eq(products.vendorId, await vendorId()),
      eq(products.status, 'active'),
      categoryId ? eq(products.categoryId, categoryId) : undefined,
    );
    const [rows, total] = await Promise.all([
      db
        .select({
          product: products,
          translation: productTranslations,
        })
        .from(products)
        .innerJoin(
          productTranslations,
          and(
            eq(productTranslations.productId, products.id),
            eq(productTranslations.locale, locale),
          ),
        )
        .where(baseCondition)
        .orderBy(desc(products.publishedAt), asc(products.id))
        .limit(24)
        .offset((page - 1) * 24),
      db.select({ value: count() }).from(products).where(baseCondition),
    ]);
    const ids = rows.map((r) => r.product.id);
    const related = await relations(ids);
    return {
      rows: rows.map((r) => ({
        ...r.product,
        name: r.translation.name,
        slug: r.translation.slug,
        shortDescription: r.translation.shortDescription,
        description: r.translation.description,
        seoTitle: r.translation.seoTitle,
        seoDescription: r.translation.seoDescription,
      })),
      total: total[0]!.value,
      variants: related.variants.filter((v) => v.status === 'active'),
      images: related.images,
    };
  }

  /** Get all active category translations for a locale */
  async function categoryListLocale(locale: string) {
    return db
      .select({
        category: categories,
        translation: categoryTranslations,
      })
      .from(categories)
      .innerJoin(
        categoryTranslations,
        and(
          eq(categoryTranslations.categoryId, categories.id),
          eq(categoryTranslations.locale, locale),
        ),
      )
      .where(eq(categories.status, 'active'))
      .orderBy(asc(categories.sortOrder), asc(categoryTranslations.name));
  }

  /** Get the translation for a category by its base ID and locale (for admin use) */
  async function categoryTranslationBase(
    categoryBaseId: string,
    locale: string,
  ) {
    return categoryTranslationFor(categoryBaseId, locale);
  }

  /** Get the translation for a product by its base ID and locale (for admin use) */
  async function productTranslationBase(productBaseId: string, locale: string) {
    return productTranslationFor(productBaseId, locale);
  }

  /** List all categories (base) for admin */
  async function allCategories() {
    return categoryList();
  }

  /** Get all product translations for admin */
  async function adminProductTranslations(productId: string) {
    return productTranslationsList(productId);
  }

  /** Get all category translations for admin */
  async function adminCategoryTranslations(categoryId: string) {
    return categoryTranslationsList(categoryId);
  }

  // ─── Legacy methods (preserved for backward compat) ─────────

  return {
    product,
    categoryList,
    allCategories,
    relations,
    localizedProduct,
    localizedCategory,
    productTranslationsList,
    categoryTranslationsList,
    productTranslationFor,
    categoryTranslationFor,
    productTranslationBase,
    categoryTranslationBase,
    saveProductTranslation,
    saveCategoryTranslation,
    publicListLocale,
    categoryListLocale,
    adminProductTranslations,
    adminCategoryTranslations,
    async publicImage(key: string) {
      if (!/^[a-f0-9-]{36}$/.test(key)) return null;
      const [row] = await db
        .select({ image: productImages })
        .from(productImages)
        .innerJoin(products, eq(products.id, productImages.productId))
        .innerJoin(vendors, eq(vendors.id, products.vendorId))
        .where(
          and(
            eq(productImages.storageKey, key),
            eq(products.status, 'active'),
            eq(vendors.slug, 'lokka'),
          ),
        )
        .limit(1);
      return row?.image ?? null;
    },
    async publicList(page: number, categoryId?: string) {
      const condition = and(
        eq(products.vendorId, await vendorId()),
        eq(products.status, 'active'),
        categoryId ? eq(products.categoryId, categoryId) : undefined,
      );
      const [rows, total] = await Promise.all([
        db
          .select()
          .from(products)
          .where(condition)
          .orderBy(desc(products.publishedAt), asc(products.id))
          .limit(24)
          .offset((page - 1) * 24),
        db.select({ value: count() }).from(products).where(condition),
      ]);
      const related = await relations(rows.map((p) => p.id));
      return {
        rows,
        total: total[0]!.value,
        variants: related.variants.filter((v) => v.status === 'active'),
        images: related.images,
      };
    },
    async publicProduct(slugValue: string) {
      const [p] = await db
        .select()
        .from(products)
        .where(
          and(
            eq(products.slug, slugValue),
            eq(products.status, 'active'),
            eq(products.vendorId, await vendorId()),
          ),
        );
      if (!p) return null;
      const related = await relations([p.id]);
      return {
        product: p,
        variants: related.variants.filter((v) => v.status === 'active'),
        images: related.images,
      };
    },
    async adminProducts() {
      return db
        .select()
        .from(products)
        .where(eq(products.vendorId, await vendorId()))
        .orderBy(desc(products.updatedAt));
    },
    async inventory() {
      return db
        .select({ variant: productVariants, product: products })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(eq(products.vendorId, await vendorId()))
        .orderBy(asc(products.name), asc(productVariants.sortOrder));
    },
    async saveCategory(form: Form, categoryId?: string) {
      const name = textField(form, 'name', 150, true);
      const parentId = textField(form, 'parentId')
        ? id(form.parentId, 'parentId')
        : null;
      const values = {
        name,
        slug: slug(form, name),
        parentId,
        status: choice(form, 'status', ['active', 'hidden']),
        sortOrder: integer({ sortOrder: '0', ...form }, 'sortOrder'),
        shortDescription: textField(form, 'shortDescription', 500) || null,
        seoTitle: textField(form, 'seoTitle', 150) || null,
        seoDescription: textField(form, 'seoDescription', 320) || null,
        updatedAt: new Date(),
      };
      try {
        return await db.transaction(async (tx) => {
          // Serialize hierarchy writes, including an empty table, to prevent concurrent cycles.
          await tx.execute(sql`SELECT pg_advisory_xact_lock(724011)`);
          const all = await tx.select().from(categories);
          if (categoryId && !all.some((c) => c.id === id(categoryId)))
            throw new FormError('id', 'Kategori tidak ditemukan.');
          const seen = new Set(categoryId ? [categoryId] : []);
          let cursor = parentId;
          while (cursor) {
            if (seen.has(cursor))
              throw new FormError(
                'parentId',
                'Hierarki kategori tidak boleh berputar.',
              );
            seen.add(cursor);
            const parent = all.find((c) => c.id === cursor);
            if (!parent)
              throw new FormError(
                'parentId',
                'Kategori induk tidak ditemukan.',
              );
            cursor = parent.parentId;
          }
          const [row] = categoryId
            ? await tx
                .update(categories)
                .set(values)
                .where(eq(categories.id, categoryId))
                .returning()
            : await tx.insert(categories).values(values).returning();
          return row!;
        });
      } catch (error) {
        return databaseError(error);
      }
    },
    async saveProduct(form: Form, productId?: string) {
      const existing = productId ? await product(productId) : null;
      const name = textField(form, 'name', 200, true);
      const categoryId = textField(form, 'categoryId')
        ? id(form.categoryId, 'categoryId')
        : null;
      if (
        categoryId &&
        !(await categoryList()).some((c) => c.id === categoryId)
      )
        throw new FormError('categoryId', 'Kategori tidak ditemukan.');
      const status = choice(form, 'status', ['draft', 'active', 'archived']);
      const values = {
        vendorId: await vendorId(),
        categoryId,
        name,
        slug: slug(form, name),
        shortDescription: textField(form, 'shortDescription', 500) || null,
        description: textField(form, 'description', 20000) || null,
        status,
        featured: form.featured === 'on',
        seoTitle: textField(form, 'seoTitle', 150) || null,
        seoDescription: textField(form, 'seoDescription', 320) || null,
        publishedAt:
          existing?.publishedAt ?? (status === 'active' ? new Date() : null),
        updatedAt: new Date(),
      };
      try {
        return await db.transaction(async (tx) => {
          const [previous] = productId
            ? await tx
                .select()
                .from(products)
                .where(eq(products.id, productId))
                .for('update')
            : [];
          if (status === 'active') {
            const variants = productId
              ? await tx
                  .select()
                  .from(productVariants)
                  .where(eq(productVariants.productId, productId))
              : [];
            const active = variants.filter((v) => v.status === 'active');
            if (
              !active.length ||
              active.some(
                (v) =>
                  v.price <= 0n ||
                  v.weightGrams <= 0 ||
                  !/^[A-Za-z0-9._-]+$/.test(v.sku),
              )
            )
              throw new FormError(
                'status',
                'Save a draft and add a usable active variant with SKU, positive price and gram weight before publishing.',
              );
          }
          const [row] = productId
            ? await tx
                .update(products)
                .set(values)
                .where(eq(products.id, productId))
                .returning()
            : await tx.insert(products).values(values).returning();
          if (previous) {
            // Text copied into fallback translations follows base edits;
            // independently translated fields remain owner-supplied text.
            const copied = (
              key:
                | 'name'
                | 'slug'
                | 'shortDescription'
                | 'description'
                | 'seoTitle'
                | 'seoDescription',
            ) =>
              sql`case when ${productTranslations[key]} is not distinct from ${previous[key]} then ${row![key]} else ${productTranslations[key]} end`;
            await tx
              .update(productTranslations)
              .set({
                name: copied('name'),
                slug: copied('slug'),
                shortDescription: copied('shortDescription'),
                description: copied('description'),
                seoTitle: copied('seoTitle'),
                seoDescription: copied('seoDescription'),
                updatedAt: new Date(),
              })
              .where(eq(productTranslations.productId, row!.id));
          }
          if (!productId) {
            for (const locale of supportedLocaleCodes) {
              const [existingTranslation] = await tx
                .select()
                .from(productTranslations)
                .where(
                  and(
                    eq(productTranslations.productId, row!.id),
                    eq(productTranslations.locale, locale),
                  ),
                );
              if (!existingTranslation) {
                await tx.insert(productTranslations).values({
                  productId: row!.id,
                  locale,
                  name: row!.name,
                  slug: row!.slug,
                  shortDescription: row!.shortDescription,
                  description: row!.description,
                  seoTitle: row!.seoTitle,
                  seoDescription: row!.seoDescription,
                  updatedAt: new Date(),
                });
              }
            }
          }
          return row!;
        });
      } catch (error) {
        return databaseError(error);
      }
    },
    async archive(productId: string) {
      await product(productId);
      await db
        .update(products)
        .set({ status: 'archived', updatedAt: new Date() })
        .where(eq(products.id, productId));
    },
    async saveVariant(productId: string, form: Form, variantId?: string) {
      await product(productId);
      const values = variantInput(form);
      try {
        return await db.transaction(async (tx) => {
          const [parent] = await tx
            .select()
            .from(products)
            .where(eq(products.id, productId))
            .for('update');
          if (parent?.status === 'active' && values.status !== 'active') {
            const active = await tx
              .select()
              .from(productVariants)
              .where(
                and(
                  eq(productVariants.productId, productId),
                  eq(productVariants.status, 'active'),
                ),
              );
            if (
              !active.some(
                (v) => v.id !== variantId && v.price > 0n && v.weightGrams > 0,
              )
            )
              throw new FormError(
                'status',
                'A published product must retain a usable active variant.',
              );
          }
          if (variantId) {
            const [row] = await tx
              .update(productVariants)
              .set({ ...values, updatedAt: new Date() })
              .where(
                and(
                  eq(productVariants.id, id(variantId)),
                  eq(productVariants.productId, productId),
                ),
              )
              .returning();
            if (!row) throw new FormError('id', 'Varian tidak ditemukan.');
            return row;
          }
          const [row] = await tx
            .insert(productVariants)
            .values({ ...values, productId })
            .returning();
          return row!;
        });
      } catch (error) {
        return databaseError(error);
      }
    },
    async stock(productId: string, variantId: string, form: Form) {
      await product(productId);
      const [row] = await db
        .update(productVariants)
        .set({
          stockQuantity: integer(form, 'stockQuantity'),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(productVariants.id, id(variantId)),
            eq(productVariants.productId, productId),
          ),
        )
        .returning();
      if (!row) throw new FormError('id', 'Varian tidak ditemukan.');
    },
    async addImages(productId: string, inputs: Buffer[], altText: string) {
      await product(productId);
      const saved: Awaited<ReturnType<CatalogImageStorage['save']>>[] = [];
      try {
        for (const input of inputs) saved.push(await storage.save(input));
        await db.transaction(async (tx) => {
          await tx
            .select()
            .from(products)
            .where(eq(products.id, productId))
            .for('update');
          const previous = await tx
            .select()
            .from(productImages)
            .where(eq(productImages.productId, productId));
          if (previous.length + saved.length > 20)
            throw new FormError('images', 'Maximum 20 images per product.');
          for (const [i, image] of saved.entries())
            await tx.insert(productImages).values({
              storageKey: image.storageKey,
              productId,
              altText,
              sortOrder: previous.length + i,
              isPrimary: previous.length === 0 && i === 0,
              width: image.width,
              height: image.height,
              sourceStorageKey: image.source.sourceStorageKey,
              sourceFormat: image.source.sourceFormat,
              sourceMimeType: image.source.sourceMimeType,
              sourceWidth: image.source.sourceWidth,
              sourceHeight: image.source.sourceHeight,
              sourceSizeBytes: image.source.sourceSizeBytes,
            });
        });
      } catch (error) {
        await Promise.all(
          saved.map((image) =>
            storage.removeWithSource(
              image.storageKey,
              image.source.sourceStorageKey,
              image.source.sourceFormat,
            ),
          ),
        );
        throw error;
      }
    },
    async editImage(
      productId: string,
      imageId: string,
      form: Form,
      remove = false,
    ) {
      await product(productId);
      let deletedKey: string | undefined;
      let deletedSourceKey: string | null = null;
      let deletedSourceFormat: string | null = null;
      await db.transaction(async (tx) => {
        await tx
          .select()
          .from(products)
          .where(eq(products.id, productId))
          .for('update');
        const [image] = await tx
          .select()
          .from(productImages)
          .where(
            and(
              eq(productImages.id, id(imageId)),
              eq(productImages.productId, productId),
            ),
          );
        if (!image) throw new FormError('images', 'Image not found.');
        if (remove) {
          deletedKey = image.storageKey;
          deletedSourceKey = image.sourceStorageKey;
          deletedSourceFormat = image.sourceFormat;
          await tx.delete(productImages).where(eq(productImages.id, image.id));
          if (image.isPrimary) {
            const [next] = await tx
              .select()
              .from(productImages)
              .where(eq(productImages.productId, productId))
              .orderBy(asc(productImages.sortOrder), asc(productImages.id))
              .limit(1);
            if (next)
              await tx
                .update(productImages)
                .set({ isPrimary: true })
                .where(eq(productImages.id, next.id));
          }
        } else {
          if (form.isPrimary === 'on')
            await tx
              .update(productImages)
              .set({ isPrimary: false })
              .where(eq(productImages.productId, productId));
          await tx
            .update(productImages)
            .set({
              altText: textField(form, 'altText', 300),
              sortOrder: integer(form, 'sortOrder'),
              isPrimary: form.isPrimary === 'on' || image.isPrimary,
            })
            .where(eq(productImages.id, image.id));
        }
      });
      // DB first: a failed filesystem cleanup leaves an unreachable orphan, never a broken DB reference.
      if (deletedKey)
        await storage.removeWithSource(
          deletedKey,
          deletedSourceKey,
          deletedSourceFormat,
        );
    },
  };
}
export type Catalog = ReturnType<typeof createCatalog>;
