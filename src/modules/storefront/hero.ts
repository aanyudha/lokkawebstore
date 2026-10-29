import { eq, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { homepageHero } from '../../db/schema/index.js';
import type { CatalogImageStorage, ImageSize } from '../catalog/storage.js';
import { FormError, textField } from '../catalog/validation.js';

export function createHomepageHero(
  db: Database['db'],
  storage: CatalogImageStorage,
  cleanupWarning: () => void = () => {},
) {
  const url = (key: string, size: ImageSize) =>
    storage.url(key, size).replace('/media/catalog/', '/media/homepage/');
  const get = async () =>
    (
      await db
        .select()
        .from(homepageHero)
        .where(eq(homepageHero.id, 'homepage'))
    )[0] ?? null;
  const discard = async (image: {
    storageKey: string;
    sourceStorageKey: string;
    sourceFormat: string;
  }) => {
    try {
      await storage.removeWithSource(
        image.storageKey,
        image.sourceStorageKey,
        image.sourceFormat,
      );
    } catch {
      cleanupWarning();
    }
  };
  return {
    get,
    async publicImage() {
      const row = await get();
      if (!row) return null;
      try {
        return {
          src: url(row.storageKey, 'card'),
          srcset: `${url(row.storageKey, 'card')} 800w, ${url(row.storageKey, 'detail')} 1600w`,
          width: row.width,
          height: row.height,
          altText: row.altText,
        };
      } catch {
        return null;
      }
    },
    async save(input: Buffer | undefined, alt: unknown) {
      const altText = textField({ altText: alt }, 'altText', 300);
      const saved = input ? await storage.save(input) : null;
      let old: Awaited<ReturnType<typeof get>> = null;
      try {
        await db.transaction(async (tx) => {
          // Serialize even the first insert, so replacements cannot leak a
          // concurrently replaced asset or delete the currently referenced one.
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext('lokka:homepage-hero'))`,
          );
          old =
            (
              await tx
                .select()
                .from(homepageHero)
                .where(eq(homepageHero.id, 'homepage'))
            )[0] ?? null;
          if (!saved && !old)
            throw new FormError('images', 'Choose a homepage hero image.');
          if (saved) {
            const values = {
              storageKey: saved.storageKey,
              sourceStorageKey: saved.source.sourceStorageKey,
              sourceFormat: saved.source.sourceFormat,
              width: saved.width,
              height: saved.height,
              altText,
              updatedAt: new Date(),
            };
            await tx
              .insert(homepageHero)
              .values({ id: 'homepage', ...values })
              .onConflictDoUpdate({ target: homepageHero.id, set: values });
          } else
            await tx
              .update(homepageHero)
              .set({ altText, updatedAt: new Date() })
              .where(eq(homepageHero.id, 'homepage'));
        });
      } catch (error) {
        if (saved)
          await discard({ storageKey: saved.storageKey, ...saved.source });
        throw error;
      }
      // Only after commit. Cleanup failure must never erase the new live asset.
      if (saved && old) await discard(old);
    },
    async clear() {
      const old = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext('lokka:homepage-hero'))`,
        );
        return (
          await tx
            .delete(homepageHero)
            .where(eq(homepageHero.id, 'homepage'))
            .returning()
        )[0];
      });
      if (old) await discard(old);
    },
  };
}
export type HomepageHero = ReturnType<typeof createHomepageHero>;
