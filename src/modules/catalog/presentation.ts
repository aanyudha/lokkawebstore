import type { CatalogImageStorage, ImageSize } from './storage.js';

interface ProductImage {
  id: string;
  isPrimary: boolean;
  sortOrder: number;
}

// Match the catalog relation ordering, including a stable tie breaker.
export function primaryProductImage<T extends ProductImage>(
  images: T[],
): T | null {
  return (
    [...images].sort(
      (a, b) =>
        Number(b.isPrimary) - Number(a.isPrimary) ||
        a.sortOrder - b.sortOrder ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )[0] ?? null
  );
}

export function presentProductImage(
  storage: CatalogImageStorage,
  image: {
    storageKey: string;
    width: number;
    height: number;
    altText?: string | null;
  } | null,
  size: ImageSize,
) {
  return image
    ? {
        src: storage.url(image.storageKey, size),
        width: image.width,
        height: image.height,
        altText: image.altText ?? '',
      }
    : null;
}
