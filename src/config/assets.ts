import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const buildDir = resolve('public/build');

let cachedAssets: { css: string; js: string } | null = null;

/**
 * Resolve the content-hashed asset filenames from Vite build output.
 * Falls back to unhashed names if build directory is missing.
 */
export function getAssets(): { css: string; js: string } {
  if (cachedAssets) return cachedAssets;

  try {
    const files = readdirSync(buildDir);
    const cssFile = files.find(
      (f) => f.startsWith('main.') && f.endsWith('.css'),
    );
    const jsFile = files.find(
      (f) => f.startsWith('main.') && f.endsWith('.js'),
    );

    cachedAssets = {
      css: cssFile ? `/build/${cssFile}` : '/build/main.css',
      js: jsFile ? `/build/${jsFile}` : '/build/main.js',
    };
  } catch {
    cachedAssets = { css: '/build/main.css', js: '/build/main.js' };
  }

  return cachedAssets;
}

/**
 * Reset cached assets (useful after rebuilds in dev).
 */
export function resetAssets() {
  cachedAssets = null;
}
