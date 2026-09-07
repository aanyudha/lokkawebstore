import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink, readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import sharp from 'sharp';
import { FormError } from './validation.js';
export const imageSizes = { thumb: 400, card: 800, detail: 1600 } as const;
export type ImageSize = keyof typeof imageSizes;
export interface CatalogImageStorage {
  save(
    input: Buffer,
  ): Promise<{ storageKey: string; width: number; height: number }>;
  remove(key: string): Promise<void>;
  read(key: string, size: ImageSize): Promise<Buffer>;
  url(key: string, size: ImageSize): string;
}
export class LocalCatalogImageStorage implements CatalogImageStorage {
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  path(key: string, size: ImageSize) {
    if (!/^[a-f0-9-]{36}$/.test(key) || !Object.hasOwn(imageSizes, size))
      throw new FormError('images', 'Kunci gambar tidak valid.');
    const path = resolve(this.root, `${key}-${size}.webp`);
    if (!path.startsWith(this.root + sep))
      throw new FormError('images', 'Path tidak valid.');
    return path;
  }
  url(key: string, size: ImageSize) {
    this.path(key, size);
    return `/media/catalog/${key}/${size}.webp`;
  }
  async save(input: Buffer) {
    if (input.length > 10 * 1024 * 1024)
      throw new FormError('images', 'Maksimum 10 MB per gambar.');
    const jpeg = input[0] === 255 && input[1] === 216 && input[2] === 255;
    const png = input
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const webp =
      input.toString('ascii', 0, 4) === 'RIFF' &&
      input.toString('ascii', 8, 12) === 'WEBP';
    if (!jpeg && !png && !webp)
      throw new FormError('images', 'Gunakan JPEG, PNG, atau WebP yang valid.');
    const storageKey = randomUUID();
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
      return { storageKey, width, height };
    } catch {
      await this.remove(storageKey);
      throw new FormError(
        'images',
        'Gambar tidak dapat diproses. Gunakan gambar statis valid, maksimum 40 megapiksel.',
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
  read(key: string, size: ImageSize) {
    return readFile(this.path(key, size));
  }
}
