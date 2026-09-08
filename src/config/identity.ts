import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { readSourceIdentity, type BuildIdentity } from './revision.js';

const identity: BuildIdentity =
  extname(import.meta.filename) === '.ts'
    ? readSourceIdentity(new URL('../../', import.meta.url))
    : (JSON.parse(
        readFileSync(new URL('../build-info.json', import.meta.url), 'utf8'),
      ) as BuildIdentity);

export function runtimeIdentity(environment: string) {
  // Explicit allowlist: never return arbitrary metadata or environment variables.
  return {
    app: identity.app,
    version: identity.version,
    commit: identity.commit,
    dirty: identity.dirty,
    environment,
  };
}
