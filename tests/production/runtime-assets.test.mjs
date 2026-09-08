import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  access,
  copyFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { URL } from 'node:url';
import { supportedLocaleCodes } from '../../dist/i18n/locales.js';
import { copyTranslations } from '../../scripts/runtime-assets.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'lokka-build-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source');
  const destination = join(root, 'destination');
  await mkdir(source);
  for (const locale of supportedLocaleCodes) {
    await writeFile(join(source, `${locale}.json`), '{"hello":"world"}');
  }
  return { root, source, destination };
}

test('copies validated resources and future locales into a new destination', async (t) => {
  const { source, destination } = await fixture(t);
  await writeFile(join(source, 'future.json'), '{"hello":"future"}');
  await copyTranslations(source, destination, supportedLocaleCodes);
  for (const locale of [...supportedLocaleCodes, 'future']) {
    assert.deepEqual(
      await readFile(join(destination, `${locale}.json`)),
      await readFile(join(source, `${locale}.json`)),
    );
  }
});

for (const locale of supportedLocaleCodes) {
  test(`rejects missing required ${locale} resource`, async (t) => {
    const { source, destination } = await fixture(t);
    await rm(join(source, `${locale}.json`));
    await assert.rejects(
      copyTranslations(source, destination, supportedLocaleCodes),
      /Missing required translation/,
    );
    await assert.rejects(access(destination));
  });
}

test('rejects malformed JSON before publishing resources', async (t) => {
  const { source, destination } = await fixture(t);
  await writeFile(join(source, 'future.json'), '{broken');
  await assert.rejects(
    copyTranslations(source, destination, supportedLocaleCodes),
    SyntaxError,
  );
  await assert.rejects(access(destination));
});

test('rejects an unavailable source directory', async (t) => {
  const { root, destination } = await fixture(t);
  await assert.rejects(
    copyTranslations(join(root, 'missing'), destination, supportedLocaleCodes),
    { code: 'ENOENT' },
  );
});

test('clean removes only generated outputs, independent of working directory', async (t) => {
  const { root } = await fixture(t);
  await mkdir(join(root, 'scripts'));
  await copyFile(
    new URL('../../scripts/clean.mjs', import.meta.url),
    join(root, 'scripts/clean.mjs'),
  );
  const preserved = [
    'storage/uploads/owner.txt',
    'public/images/lokka_logo.png',
    'docs/basic_concept/owner.txt',
    'src/owner.txt',
  ];
  const generated = ['dist/stale.js', 'public/build/stale.js'];
  for (const file of [...preserved, ...generated]) {
    await mkdir(join(root, file, '..'), { recursive: true });
    await writeFile(join(root, file), 'preserve');
  }
  execFileSync(process.execPath, [join(root, 'scripts/clean.mjs')], {
    cwd: tmpdir(),
    windowsHide: true,
  });
  for (const file of preserved)
    assert.equal(await readFile(join(root, file), 'utf8'), 'preserve');
  for (const file of generated) await assert.rejects(access(join(root, file)));
});
