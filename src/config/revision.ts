import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export interface BuildIdentity {
  app: 'lokka-webstore';
  version: string;
  commit: string | null;
  dirty: boolean | null;
}

/** Used once in development, or at build time. No Git dependency at runtime. */
export function readSourceIdentity(root: URL): BuildIdentity {
  const pkg = JSON.parse(
    readFileSync(new URL('package.json', root), 'utf8'),
  ) as { version: string };
  let commit: string | null = null;
  let dirty: boolean | null = null;
  try {
    const git = (args: string[]) =>
      execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
        timeout: 5000,
      }).trim();
    const revision = git(['rev-parse', 'HEAD']);
    if (/^[a-f0-9]{40,64}$/.test(revision)) commit = revision;
    dirty = git(['status', '--porcelain', '--untracked-files=normal']) !== '';
  } catch {
    // Source archives may have no Git executable or repository metadata.
  }
  return { app: 'lokka-webstore', version: pkg.version, commit, dirty };
}
