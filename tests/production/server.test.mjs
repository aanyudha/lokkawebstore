import 'dotenv/config';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fork, spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import process from 'node:process';
import { URL, URLSearchParams, fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../../dist/db/client.js';
import {
  adminUsers,
  categories,
  products,
  vendors,
} from '../../dist/db/schema/index.js';
import { hashPassword } from '../../dist/modules/auth/service.js';
import { createCatalog } from '../../dist/modules/catalog/service.js';
import { LocalCatalogImageStorage } from '../../dist/modules/catalog/storage.js';
import { supportedLocaleCodes } from '../../dist/i18n/locales.js';
import { t as translate } from '../../dist/i18n/translator.js';
import {
  assertDatabaseIdentity,
  disposableDatabaseUrl,
  testDatabaseUrl,
  verificationEnv,
} from '../../scripts/verification-db.ts';

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
    // Production HTTP checks mutate fixtures too. Never point the release at
    // the owner database, even when temporary records would be cleaned up.
    const source = testDatabaseUrl();
    await assertDatabaseIdentity(source.href, source.pathname.slice(1));
    const maintenance = new pg.Pool({ connectionString: source.href });
    const { name: databaseName, url: target } = disposableDatabaseUrl(
      source,
      'production',
    );
    let created = false;
    const servers = [];
    t.after(async () => {
      try {
        for (const server of servers) await stop(server, 'SIGTERM');
      } finally {
        try {
          if (created)
            await maintenance.query(`DROP DATABASE "${databaseName}"`);
        } finally {
          await maintenance.end();
        }
      }
    });
    await maintenance.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    await assertDatabaseIdentity(target, databaseName);
    const migrated = createDatabase(target);
    try {
      await migrate(migrated.db, { migrationsFolder: join(root, 'drizzle') });
      await migrated.db
        .insert(vendors)
        .values({ slug: 'lokka', name: 'LOKKA', status: 'active' });
    } finally {
      await migrated.close();
    }
    t.diagnostic(`Production fixture database: ${databaseName}`);
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
      ...verificationEnv(target),
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      APP_URL: `http://127.0.0.1:${port}`,
      LOG_LEVEL: 'info',
    };
    function start() {
      const child = fork(
        fileURLToPath(new URL('signal-fixture.mjs', import.meta.url)),
        [join(release, 'dist/server.js')],
        { cwd: release, env, silent: true, windowsHide: true },
      );
      const instance = { child, output: '', exited: once(child, 'close') };
      servers.push(instance);
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
    assert.deepEqual(identity, {
      ...metadata,
      environment: 'production',
      runtime: 'fastify',
    });
    const adminLogin = await get('/admin/login');
    assert.equal(adminLogin.status, 200);
    const adminHtml = await adminLogin.text();
    assert.match(adminHtml, /data-admin-layout="auth"/);
    assert.doesNotMatch(adminHtml, /site-header|site-footer|\/build\/main\./);
    for (const asset of adminHtml.matchAll(
      /(?:href|src)="(\/build\/admin\.[^"]+)"/g,
    )) {
      assert.equal((await get(asset[1])).status, 200, asset[1]);
    }
    assert.match(adminHtml, /\/build\/admin\.[^"]+\.css/);
    assert.match(adminHtml, /\/build\/admin\.[^"]+\.js/);
    // Real HTTP QA of the compiled back office, using only temporary records.
    const database = createDatabase(env.DATABASE_URL);
    const run = randomUUID();
    const email = `production-${run}@example.test`;
    const password = `temporary-${run}`;
    const [admin] = await database.db
      .insert(adminUsers)
      .values({
        email,
        name: 'Production verification',
        passwordHash: await hashPassword(password),
      })
      .returning();
    let productId;
    let categoryId;
    try {
      const catalog = createCatalog(
        database.db,
        new LocalCatalogImageStorage('storage/tests/production'),
      );
      const product = await catalog.saveProduct({
        name: `Production ${run}`,
        status: 'draft',
      });
      productId = product.id;
      const category = await catalog.saveCategory({
        name: `Production ${run}`,
        status: 'hidden',
      });
      categoryId = category.id;
      const csrf = adminHtml.match(/name="csrf" value="([a-f0-9]+)"/)[1];
      const login = await globalThis.fetch(`${env.APP_URL}/admin/login`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie: `lokka_login_csrf=${csrf}`,
        },
        body: new URLSearchParams({ csrf, email, password }),
      });
      assert.equal(login.status, 303);
      const cookie = login.headers
        .getSetCookie()
        .filter((value) => /^lokka_admin(?:_csrf)?=/.test(value))
        .map((value) => value.split(';')[0])
        .join('; ');
      for (const path of [
        '/admin',
        '/admin/products',
        '/admin/categories',
        '/admin/inventory',
        '/admin/media',
        `/admin/products/${productId}/edit`,
        `/admin/categories/${categoryId}/edit`,
        `/admin/products/${productId}/pricing`,
        '/admin/finance/overhead',
        '/admin/settings/fulfillment',
      ]) {
        const page = await globalThis.fetch(`${env.APP_URL}${path}`, {
          headers: { cookie },
          redirect: 'manual',
        });
        assert.equal(page.status, 200, path);
        assert.match(await page.text(), /data-admin-layout="backoffice"/, path);
        assert.match(page.headers.get('cache-control'), /no-store/);
      }
      for (const path of [
        '/collections',
        '/id/koleksi',
        '/account/login',
        '/account/register',
        '/id/akun/masuk',
        '/id/akun/daftar',
      ])
        assert.equal((await get(path)).status, 200, path);
    } finally {
      if (productId)
        await database.db.delete(products).where(eq(products.id, productId));
      if (categoryId)
        await database.db
          .delete(categories)
          .where(eq(categories.id, categoryId));
      await database.db.delete(adminUsers).where(eq(adminUsers.id, admin.id));
      await database.close();
    }
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
