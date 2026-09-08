import { writeFile } from 'node:fs/promises';
import { URL, fileURLToPath } from 'node:url';
import { supportedLocaleCodes } from '../dist/i18n/locales.js';
import { readSourceIdentity } from '../dist/config/revision.js';
import { copyTranslations } from './runtime-assets.mjs';

const root = new URL('../', import.meta.url);
await copyTranslations(
  fileURLToPath(new URL('src/i18n/resources/', root)),
  fileURLToPath(new URL('dist/i18n/resources/', root)),
  supportedLocaleCodes,
);
await writeFile(
  new URL('dist/build-info.json', root),
  `${JSON.stringify(readSourceIdentity(root), null, 2)}\n`,
);
