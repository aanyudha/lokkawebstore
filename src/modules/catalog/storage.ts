import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink, readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import sharp from 'sharp';
import { FormError } from './validation.js';
export const imageSizes = { thumb: 400, card: 800, detail: 1600 } as const;
export type ImageSize = keyof typeof imageSizes;
export interface SourceMetadata {
  sourceStorageKey: string;
  sourceFormat: string;
  sourceMimeType: string;
  sourceWidth: number;
  sourceHeight: number;
  sourceSizeBytes: number;
}
export interface CatalogImageStorage {
  save(input: Buffer): Promise<{
    storageKey: string;
    width: number;
    height: number;
    source: SourceMetadata;
  }>;
  remove(key: string): Promise<void>;
  removeWithSource(
    key: string,
    sourceKey: string | null,
    sourceFormat: string | null,
  ): Promise<void>;
  read(key: string, size: ImageSize): Promise<Buffer>;
  readSource(key: string): Promise<Buffer | null>;
  url(key: string, size: ImageSize): string;
}
export class LocalCatalogImageStorage implements CatalogImageStorage {
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  path(key: string, size: ImageSize) {
    if (!/^[a-f0-9-]{36}$/.test(key) || !Object.hasOwn(imageSizes, size))
      throw new FormError('images', 'Invalid image key.');
    const path = resolve(this.root, `${key}-${size}.webp`);
    if (!path.startsWith(this.root + sep))
      throw new FormError('images', 'Invalid path.');
    return path;
  }
  sourcePath(key: string, ext: string) {
    if (!/^[a-f0-9-]{36}$/.test(key))
      throw new FormError('images', 'Invalid image key.');
    const path = resolve(this.root, `${key}-source.${ext}`);
    if (!path.startsWith(this.root + sep))
      throw new FormError('images', 'Invalid path.');
    return path;
  }
  url(key: string, size: ImageSize) {
    this.path(key, size);
    return `/media/catalog/${key}/${size}.webp`;
  }
  async save(input: Buffer) {
    if (input.length > 10 * 1024 * 1024)
      throw new FormError('images', 'Maximum 10 MB per image.');
    const jpeg = input[0] === 255 && input[1] === 216 && input[2] === 255;
    const png = input
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const webp =
      input.toString('ascii', 0, 4) === 'RIFF' &&
      input.toString('ascii', 8, 12) === 'WEBP';
    if (!jpeg && !png && !webp)
      throw new FormError('images', 'Use valid JPEG, PNG, or WebP.');
    const storageKey = randomUUID();
    const sourceFormat = jpeg ? 'jpeg' : png ? 'png' : 'webp';
    const sourceMime = jpeg ? 'image/jpeg' : png ? 'image/png' : 'image/webp';
    const sourceExt = jpeg ? 'jpg' : png ? 'png' : 'webp';
    const sourceKey = randomUUID();
    try {
      const meta = await sharp(input, {
        limitInputPixels: 40000000,
        failOn: 'warning',
      }).metadata();
      if (
        !meta.format ||
        !['jpeg', 'png', 'webp'].includes(meta.format) ||
        (meta.pages ?? 1) > 1
      )
        throw new Error('Unsupported image');
      await mkdir(this.root, { recursive: true });
      await writeFile(this.sourcePath(sourceKey, sourceExt), input, {
        flag: 'wx',
      });
      let width = 0,
        height = 0;
      for (const [size, bound] of Object.entries(imageSizes)) {
        const { data, info } = await sharp(input, {
          limitInputPixels: 40000000,
          failOn: 'warning',
        })
          .rotate()
          .resize({
            width: bound,
            height: bound,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .webp({ quality: 85 })
          .toBuffer({ resolveWithObject: true });
        await writeFile(this.path(storageKey, size as ImageSize), data, {
          flag: 'wx',
        });
        if (size === 'detail') {
          width = info.width;
          height = info.height;
        }
      }
      return {
        storageKey,
        width,
        height,
        source: {
          sourceStorageKey: sourceKey,
          sourceFormat,
          sourceMimeType: sourceMime,
          sourceWidth: meta.width ?? width,
          sourceHeight: meta.height ?? height,
          sourceSizeBytes: input.length,
        },
      };
    } catch {
      await this.removeSource(sourceKey, sourceExt);
      await this.remove(storageKey);
      throw new FormError(
        'images',
        'Image could not be processed. Use a valid static image, maximum 40 megapixels.',
      );
    }
  }
  async remove(key: string) {
    await Promise.all(
      Object.keys(imageSizes).map(async (size) => {
        try {
          await unlink(this.path(key, size as ImageSize));
        } catch (error) {
          if (!(
            error instanceof Error &&
            'code' in error &&
            error.code === 'ENOENT'
          ))
            throw error;
        }
      }),
    );
  }
  async removeSource(sourceKey: string, ext: string) {
    try {
      await unlink(this.sourcePath(sourceKey, ext));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return;
      throw error;
    }
  }
  async removeWithSource(
    key: string,
    sourceKey: string | null,
    sourceFormat: string | null,
  ) {
    await this.remove(key);
    if (sourceKey && sourceFormat) {
      const ext = sourceFormat === 'jpeg' ? 'jpg' : sourceFormat;
      await this.removeSource(sourceKey, ext);
    }
  }
  async read(key: string, size: ImageSize) {
    // Never serve the private original as a public fallback. A missing
    // derivative may use another derivative, otherwise a generated placeholder.
    for (const candidate of [
      size,
      ...Object.keys(imageSizes).filter((s) => s !== size),
    ] as ImageSize[]) {
      try {
        return await readFile(this.path(key, candidate));
      } catch (error) {
        if (!(
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        ))
          throw error;
      }
    }
    return sharp({
      create: { width: 400, height: 400, channels: 3, background: '#e8e5e1' },
    })
      .webp()
      .toBuffer();
  }
  async readSource(key: string): Promise<Buffer | null> {
    for (const ext of ['jpg', 'png', 'webp']) {
      try {
        return await readFile(this.sourcePath(key, ext));
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        )
          continue;
        throw error;
      }
    }
    return null;
  }
}
