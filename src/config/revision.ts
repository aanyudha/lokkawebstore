import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export interface BuildIdentity {
  app: 'lokka-webstore';
  version: string;
  commit: string | null;
  dirty: boolean | null;
}

/**
 * Used once in development, or at build time. No Git dependency at runtime.
 *
 * When a CI or image build injects LOKKA_GIT_COMMIT/LOKKA_GIT_DIRTY, those
 * validated values win even though the build machine (or Docker build stage)
 * has no Git repository. Otherwise it resolves from the working copy.
 */
export function readSourceIdentity(
  root: URL,
  source: NodeJS.ProcessEnv = process.env,
): BuildIdentity {
  const pkg = JSON.parse(
    readFileSync(new URL('package.json', root), 'utf8'),
  ) as { version: string };
  let commit: string | null = null;
  let dirty: boolean | null = null;
  const injectedCommit = source.LOKKA_GIT_COMMIT;
  const injectedDirty = source.LOKKA_GIT_DIRTY;
  if (injectedCommit || injectedDirty) {
    if (injectedCommit && /^[a-f0-9]{40,64}$/.test(injectedCommit))
      commit = injectedCommit;
    if (injectedDirty === 'true') dirty = true;
    else if (injectedDirty === 'false') dirty = false;
    return { app: 'lokka-webstore', version: pkg.version, commit, dirty };
  }
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
