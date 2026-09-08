import 'dotenv/config';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fork, spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { supportedLocaleCodes } from '../../dist/i18n/locales.js';
import { t as translate } from '../../dist/i18n/translator.js';

test('compiled translations initialize for all configured locales', async () => {
  for (const locale of supportedLocaleCodes) {
    const resource = JSON.parse(
      await readFile(
        new URL(`../../dist/i18n/resources/${locale}.json`, import.meta.url),
        'utf8',
      ),
    );
    assert.equal(
      translate(locale, 'home.exploreCollections'),
      resource.home.exploreCollections,
    );
  }
  assert.equal(translate('unknown', 'nav.newIn'), translate('en', 'nav.newIn'));
});

test(
  'source-free production server renders, identifies conflicts, shuts down and restarts',
  { timeout: 60000 },
  async (t) => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const port = Number(process.env.PRODUCTION_TEST_PORT ?? '3000');
    const probe = createServer();
    // Fail without touching any pre-existing listener.
    await new Promise((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(port, '127.0.0.1', () => probe.close(resolve));
    });
    await mkdir(join(root, 'test-results'), { recursive: true });
    const release = await mkdtemp(join(root, 'test-results/production-'));
    t.after(() => rm(release, { recursive: true, force: true }));
    for (const entry of [
      'dist',
      'views',
      'public/build',
      'public/images/brand',
      'package.json',
    ]) {
      await cp(join(root, entry), join(release, entry), { recursive: true });
    }
    await assert.rejects(access(join(release, 'src')));
    await assert.rejects(access(join(release, '.git')));
    const metadata = JSON.parse(
      await readFile(join(release, 'dist/build-info.json'), 'utf8'),
    );
    const env = {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      APP_URL: `http://127.0.0.1:${port}`,
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL,
      LOG_LEVEL: 'info',
    };
    function start() {
      const child = fork(
        fileURLToPath(new URL('signal-fixture.mjs', import.meta.url)),
        [join(release, 'dist/server.js')],
        { cwd: release, env, silent: true, windowsHide: true },
      );
      const instance = { child, output: '', exited: once(child, 'close') };
      child.stdout.on('data', (data) => {
        instance.output += data;
      });
      child.stderr.on('data', (data) => {
        instance.output += data;
      });
      return instance;
    }
    async function stop(instance, signal) {
      if (instance.child.exitCode !== null) return;
      if (process.platform === 'win32') instance.child.send(signal);
      else {
        instance.child.disconnect();
        instance.child.kill(signal);
      }
      const [code] = await instance.exited;
      assert.equal(code, 0, instance.output);
      assert.match(
        instance.output,
        /shutdown complete; HTTP listener and database closed/,
      );
    }
    async function ready(instance) {
      for (let attempt = 0; attempt < 100; attempt++) {
        assert.equal(instance.child.exitCode, null, instance.output);
        if (instance.output.includes('LOKKA Webstore |')) return;
        await delay(100);
      }
      assert.fail(`Server did not start: ${instance.output}`);
    }
    const first = start();
    t.after(() => stop(first, 'SIGTERM'));
    await ready(first);
    assert.match(
      first.output,
      new RegExp(`PID: ${first.child.pid}.*Port: ${port}`),
    );
    const get = (path) =>
      globalThis.fetch(`${env.APP_URL}${path}`, {
        signal: globalThis.AbortSignal.timeout(5000),
      });
    for (const path of ['/health', '/ready', '/', '/id']) {
      const response = await get(path);
      const body = await response.text();
      assert.equal(response.status, 200, `${path}: ${body}`);
      if (path === '/' || path === '/id') {
        assert.ok(
          body.includes(
            translate(path === '/' ? 'en' : 'id', 'home.exploreCollections'),
          ),
        );
        assert.ok(body.includes('/images/brand/lokka-logo.webp'));
      }
    }
    const response = await get('/api/v1/version');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const identity = await response.json();
    assert.deepEqual(identity, { ...metadata, environment: 'production' });
    const second = spawn(process.execPath, ['dist/server.js'], {
      cwd: release,
      env,
      windowsHide: true,
    });
    let conflictOutput = '';
    second.stdout.on('data', (data) => {
      conflictOutput += data;
    });
    second.stderr.on('data', (data) => {
      conflictOutput += data;
    });
    const [secondCode] = await once(second, 'close');
    assert.equal(secondCode, 1, conflictOutput);
    assert.match(conflictOutput, /EADDRINUSE/);
    assert.ok(conflictOutput.includes(`Port ${port} is already in use`));
    assert.match(
      conflictOutput,
      /Stop the existing process or configure another port/,
    );
    await delay(1000);
    assert.equal(first.child.exitCode, null);
    assert.deepEqual(await (await get('/api/v1/version')).json(), identity);
    await stop(first, 'SIGINT');
    const restarted = start();
    t.after(() => stop(restarted, 'SIGTERM'));
    await ready(restarted);
    assert.equal((await get('/health')).status, 200);
    await stop(restarted, 'SIGTERM');
    await new Promise((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(port, '127.0.0.1', () => probe.close(resolve));
    });
    t.diagnostic(
      `Verified production routes and port ${port} conflict/restart; ${process.platform === 'win32' ? 'SIGINT/SIGTERM handlers exercised via test IPC (Windows)' : 'native SIGINT/SIGTERM'}.`,
    );
  },
);
