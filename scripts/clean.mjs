import { rm } from 'node:fs/promises';
import { URL, fileURLToPath } from 'node:url';
import { resolve, relative, isAbsolute } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
// Only these generated directories belong to the build. Never accept CLI paths.
for (const output of ['dist', 'public/build']) {
  const target = resolve(root, output);
  const withinRoot = relative(root, target);
  if (!withinRoot || withinRoot.startsWith('..') || isAbsolute(withinRoot)) {
    throw new Error('Refusing to clean outside the project');
  }
  await rm(target, { recursive: true, force: true });
}
