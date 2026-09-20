import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const buildDir = resolve('public/build');

const cachedAssets = new Map<string, { css: string; js: string }>();

/**
 * Resolve the content-hashed asset filenames from Vite build output.
 * Falls back to unhashed names if build directory is missing.
 */
export function getAssets(entry: 'main' | 'admin' | 'pos' = 'main'): {
  css: string;
  js: string;
} {
  const cached = cachedAssets.get(entry);
  if (cached) return cached;
  let assets = { css: `/build/${entry}.css`, js: `/build/${entry}.js` };

  try {
    const files = readdirSync(buildDir);
    const cssFile = files.find(
      (f) => f.startsWith(`${entry}.`) && f.endsWith('.css'),
    );
    const jsFile = files.find(
      (f) => f.startsWith(`${entry}.`) && f.endsWith('.js'),
    );

    assets = {
      css: cssFile ? `/build/${cssFile}` : assets.css,
      js: jsFile ? `/build/${jsFile}` : assets.js,
    };
  } catch {
    // Keep the development fallback when assets have not been built yet.
  }

  cachedAssets.set(entry, assets);
  return assets;
}

/**
 * Reset cached assets (useful after rebuilds in dev).
 */
export function resetAssets() {
  cachedAssets.clear();
}
