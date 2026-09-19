import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { readSourceIdentity } from '../src/config/revision.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function makeRoot(version = '0.1.0'): Promise<URL> {
  const dir = await mkdtemp(join(tmpdir(), 'lokka-identity-'));
  dirs.push(dir);
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'lokka-webstore', version }),
    'utf8',
  );
  return pathToFileURL(`${dir}/`);
}

describe('build identity with injected build metadata', () => {
  it('prefers an injected 40-hex commit and a true dirty flag', async () => {
    const root = await makeRoot();
    expect(
      readSourceIdentity(root, {
        LOKKA_GIT_COMMIT: 'a'.repeat(40),
        LOKKA_GIT_DIRTY: 'true',
      }),
    ).toEqual({
      app: 'lokka-webstore',
      version: '0.1.0',
      commit: 'a'.repeat(40),
      dirty: true,
    });
  });

  it('accepts a 64-hex commit and a false dirty flag', async () => {
    const root = await makeRoot();
    const identity = readSourceIdentity(root, {
      LOKKA_GIT_COMMIT: 'b'.repeat(64),
      LOKKA_GIT_DIRTY: 'false',
    });
    expect(identity.commit).toBe('b'.repeat(64));
    expect(identity.dirty).toBe(false);
  });

  it('resolves unavailable/invalid sentinels to null without needing Git', async () => {
    const root = await makeRoot();
    expect(
      readSourceIdentity(root, {
        LOKKA_GIT_COMMIT: 'unavailable',
        LOKKA_GIT_DIRTY: 'unknown',
      }),
    ).toMatchObject({ app: 'lokka-webstore', commit: null, dirty: null });
    expect(
      readSourceIdentity(root, {
        LOKKA_GIT_COMMIT: 'not-a-commit',
        LOKKA_GIT_DIRTY: 'sometimes',
      }).commit,
    ).toBeNull();
  });

  it('falls back to working-copy Git metadata when nothing is injected', () => {
    const identity = readSourceIdentity(new URL('../', import.meta.url));
    expect(identity.app).toBe('lokka-webstore');
    expect(identity.version).toBe('0.1.0');
    expect(identity.commit).toMatch(/^[a-f0-9]{40,64}$/);
    expect(typeof identity.dirty).toBe('boolean');
  });
});
