# LOKKA Webstore

LOKKA is an Indonesian fashion and batik brand. This modular monolith uses Fastify 5, strict TypeScript, PostgreSQL 18, Drizzle/pg, EJS server rendering, Vite and plain CSS. Milestone 2.5 adds catalog costing, global overhead carry-forward and fulfillment readiness. Purchasing is not enabled.

## Requirements and Windows setup

Node.js 24 LTS, npm, Git, and Docker Desktop with its Linux container engine running. No global package installation is needed. In PowerShell, use npm.cmd if script policy blocks npm.ps1; do not change system policy.

Run from C:\lokkawebstore:

```powershell
npm.cmd ci
Copy-Item .env.example .env
npm.cmd run docker:up
npm.cmd run db:migrate
npm.cmd run db:seed
npm.cmd run dev
```

Edit .env for your environment. DATABASE_URL and APP_URL are required; NODE_ENV, HOST, PORT, LOG_LEVEL and TRUST_PROXY are validated at startup. DOKU/Biteship settings are unused placeholders. Never use the Compose development password in production. The database binds to localhost:5432 and persists in a named volume. `npm.cmd run docker:down` stops it without deleting data. Docker must be accessible to the current user; install/start missing system dependencies yourself.

Open http://127.0.0.1:3000, matching the default APP_URL. Development first builds assets, then watches server TypeScript and frontend assets concurrently. Refresh the browser after frontend edits; there is no HMR server. The asset directory is intentionally ignored by Git.

If port 5432 is occupied, set POSTGRES_PORT=5433 and change the port in DATABASE_URL to 5433 in .env before starting Compose. Leave other databases untouched.

## Commands

```powershell
npm.cmd run format:check
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd start
```

`format`, `lint:fix` and `test:watch` support daily development. `db:generate` creates committed migrations after schema edits; `db:migrate` applies them; `db:studio` opens local schema tooling. Seed is idempotent and inserts only the LOKKA vendor. Foundation tests use a database seam; catalog integration tests require migrated PostgreSQL via TEST_DATABASE_URL or DATABASE_URL from .env. Tests create uniquely named temporary records and remove them afterward; no DOKU/Biteship access is needed. Prefer a separate test database. CI provisions PostgreSQL 18 and runs migrations, seed, formatting, lint, typecheck, tests and build on Node 24.

Run `npm.cmd run test:browser` for Chrome desktop/mobile verification on Windows. It starts an isolated app on localhost:3011 and uses temporary catalog/admin fixtures, which are cleaned afterward. Chrome must already be installed. On Linux install the Playwright Chromium browser in your development environment. Screenshots are written to ignored test-results/. Browser tests expect built assets; run build first.

## Admin and catalog workflow

Create your first administrator in an interactive terminal:

```powershell
npm.cmd run admin:create -- --email admin@example.com --name "LOKKA Admin"
```

Enter and confirm a password of 12–128 characters; input is not echoed. There is no default administrator or password. Open http://127.0.0.1:3000/admin/login using the host configured in APP_URL (origin checks protect form submissions). Production requires HTTPS and NODE_ENV=production for Secure cookies. Sessions expire after eight hours; logout revokes the current session. To revoke all access operationally, set the admin user's status to disabled in the database. Password recovery, MFA and user-management UI are deferred.

If logout or another admin form reports `Invalid origin.`, compare the browser address with `APP_URL` in `.env`: scheme, hostname and port must match exactly. `localhost` and `127.0.0.1` are different origins. For the default local setup use `APP_URL=http://127.0.0.1:3000` and `NODE_ENV=development`, restart the server after changing `.env`, then reopen `/admin` and use its logout button. Do not disable origin or CSRF validation to bypass a configuration mismatch.

1. **Categories:** create a category, optional parent, description, SEO text and sort order. Active categories appear publicly; hidden categories do not. Cycles are rejected. Slugs generate when blank; retain existing slugs to preserve established URLs.
2. **Products:** create draft details, choose a category, save, then add variants and images. Vendor is always LOKKA. Set active when ready; archived/draft products are hidden publicly. Featured is an optional truthful label.
3. **Variants:** use a human-readable name (e.g. Ivory / M), unique SKU, whole-Rupiah price (e.g. 695000), optional compare-at price, positive gram weight and nonnegative whole stock. Inactive variants are hidden publicly. Sort order controls presentation. No option engine is implemented.
4. **Inventory:** /admin/inventory edits absolute quantities. LOW_STOCK_THRESHOLD defaults to 5. There are no reservations or order deductions yet.
5. **Images:** upload JPEG, PNG or WebP from the product editor, up to five per request and 20/product, 10 MiB each. Files must decode as static images under 40 megapixels. Set alt text, order and primary image. Deleting the primary promotes another. File inputs must be selected again after failed uploads.

CatalogImageStorage currently persists WebP derivatives under CATALOG_STORAGE_ROOT (default storage/uploads/catalog). The directory must remain private and application-writable; uploads are Git-ignored. Derivatives fit 400/800/1600 pixel bounds, preserve aspect ratio, never upscale, and strip metadata. Originals are discarded. Back up media with PostgreSQL. Active images are served through /media/catalog; draft previews require admin authentication. A future S3 adapter is possible.

The official /images/lokka_logo.png is unchanged and separate from product media. Owner specifications under docs/basic_concept are preserved and excluded from formatting. See [design review](docs/design-input.md) for interpretation, deferred scope and the large original logo's transfer-size limitation.

## Commercial administration (Milestone 2.5)

Apply migrations with `npm run db:migrate`. The existing variant price, compare-at and gram-weight columns are reused. Create a draft, add a usable active variant with positive price/weight, then publish. Inactive variants may leave price and weight blank. Compare-at must be greater than selling price.

- `/admin/finance/overhead`: manage global monthly/annual/one-time cost definitions, open monthly snapshots, plan forecast units remaining, append target additions/credits or explicitly labeled manual recovery, and deliberately close periods. Recovery is capped at target; reversals append entries. The next opened period receives the last closed deficit exactly once; skipped months do not accrue implicit costs.
- `/admin/products/:id/pricing`: manage direct costs per unit and analyze actual variant prices using the current open period's planned overhead allocation. Choose margin or markup, optional internal reserve (default 0%) and upward rounding. Recommendations never change selling prices or record recovery.
- `/admin/settings/fulfillment`: configure the actual LOKKA dispatch address and one active default origin. No address is seeded and no provider is called.

See [commercial accounting ADR](docs/decisions/003-commercial-pricing-overhead.md) for integer formulas, annual recognition/remainders, worked carry-forward examples, migration handling of legacy compare-at values, and the distinction between planned allocation and actual recovery. Commercial integration and browser verification use disposable migrated databases; the test PostgreSQL role needs CREATEDB.

## Production build and runtime ownership

LOKKA supports exactly two server runtime modes, selected through `APP_RUNTIME` in `.env` (validated at startup):

| `APP_RUNTIME`       | `npm start` behavior                                                                 |
| ------------------- | ------------------------------------------------------------------------------------ |
| `fastify` (default) | Launches the compiled Fastify app directly with Node                                 |
| `docker`            | Ensures the LOKKA application container runs (existing PostgreSQL data is untouched) |

Both modes use the identical workflow from the project root. Set `NODE_ENV`, `DATABASE_URL`/`DATABASE_URL_DOCKER` and `APP_URL` first.

```text
npm install
npm run build
npm start
```

`npm run build` runs clean → TypeScript compilation → runtime asset validation/copy → Vite browser build, and in Docker mode also builds the application image. `npm start` acts only as the deployment-runtime launcher: `fastify` spawns the direct app command (`npm run start:app` → `scripts/start-app.mjs` → `node dist/server.js`), while `docker` runs a non-destructive `docker compose up -d app` against `docker-compose.yml` plus `deploy/docker-compose.runtime.yml`. `npm run clean` removes only `dist/` and `public/build/`. It never removes `storage/uploads/`, `public/images/lokka_logo.png`, or `docs/basic_concept/`.

- `src/` is server source.
- `dist/` is generated server runtime. All JSON translations from `src/i18n/resources/` are validated and copied to `dist/i18n/resources/`. Required locales come from `src/i18n/locales.ts`, shared with the translator; English remains the default. Missing required resources, malformed JSON, and failed/different destination copies fail the build.
- `public/build/` is generated browser CSS/JavaScript.

Never manually edit generated outputs. Both output directories are Git-ignored and untracked. Always deploy a fresh build; TypeScript compilation alone is insufficient.

Deploy `dist/`, `views/`, `public/build/`, `public/images/` (including the optimized brand WebP), `package.json` and `package-lock.json` with production dependencies. The runtime needs neither `src/` nor Git. On every start, `scripts/start-app.mjs` applies **pending additive Drizzle migrations as a controlled, transactional startup step** (each pending migration runs in its own transaction; nothing is dropped or reset). Committed migrations are additive only. If migrations cannot be applied, `npm start` fails with an actionable message instead of resetting anything. `npm run db:migrate` remains available for explicit manual migration. Example Nginx configuration is in `deploy/nginx`; HTTPS is left for deployment setup.

After building, run `npm run test:production` against a migrated PostgreSQL database (`TEST_DATABASE_URL` overrides `DATABASE_URL`). This tests compiled translations, build validation/cleaning, and a packaged application without `src/` or `.git`. It checks English/Indonesian rendering, readiness, revision identity, port conflicts and restart. It defaults to port 3000; `PRODUCTION_TEST_PORT` can select another fixed test port. An existing listener causes the test to fail without stopping it. On Windows, the fixture delivers SIGINT/SIGTERM events through test-only IPC because Node's child-process signal API forcibly terminates Windows processes; Ubuntu CI uses real OS signals. The fixture is never deployed.

A passing build is not the startup acceptance gate. Run `npm start`, confirm that it stays running, and check `/health`, `/ready`, `/`, `/id`, and `/api/v1/version`. `/ready` must return 200 with PostgreSQL available (503 means unavailable). Stop with Ctrl+C afterward. `SIGINT` and `SIGTERM` handlers close Fastify and the database pool; shutdown has a ten-second failure timeout.

### Deployment examples

`HOST` is the Fastify bind address; `APP_URL` is the canonical external origin users actually access. `HOST` defaults to `0.0.0.0` so LAN/container access works; actual reachability still depends on the OS firewall, router, reverse proxy, DNS and TLS. LOKKA never modifies Firewall, router, DNS or TLS automatically. All four modes use only `npm install`, `npm run build`, `npm start`.

**1. Local loopback**

```env
APP_RUNTIME=fastify
HOST=0.0.0.0
PORT=3000
APP_URL=http://127.0.0.1:3000
DATABASE_URL=postgresql://lokka:development_only@127.0.0.1:5432/lokka
```

Open `http://127.0.0.1:3000`.

**2. LAN IP**

```env
APP_RUNTIME=fastify
HOST=0.0.0.0
PORT=3000
APP_URL=http://192.168.1.200:3000
DATABASE_URL=postgresql://lokka:development_only@127.0.0.1:5432/lokka
```

Other LAN devices reach `http://192.168.1.200:3000` if the OS firewall permits it. Use `APP_URL` only if `127.0.0.1` in the admin flows is not what you type in the browser; never weaken origin/CSRF validation to support extra addresses.

**3. Production domain**

```env
APP_RUNTIME=fastify
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
APP_URL=https://lokka.id
DATABASE_URL=postgresql://lokka:development_only@127.0.0.1:5432/lokka
TRUST_PROXY=true
```

Fastify binds `0.0.0.0:3000`. A reverse proxy such as Nginx handles `lokka.id:443 → 127.0.0.1:3000`; `TRUST_PROXY=true` trusts only loopback forwarding headers, keeping secure cookies, protocol detection and client IPs correct behind HTTPS. DNS, TLS and the live Nginx instance are separate infrastructure concerns, not managed by `npm start`.

**4. Docker runtime**

```env
APP_RUNTIME=docker
NODE_ENV=development
PORT=3000
APP_URL=http://192.168.1.200:3000
DATABASE_URL_DOCKER=postgresql://lokka:development_only@postgres:5432/lokka
```

`npm run build` builds the application image; `npm start` ensures the `app` container runs. The existing PostgreSQL service, its network and its `postgres_data` volume are preserved and never reset or recreated destructively. The app container binds `0.0.0.0` internally and publishes the configured `PORT`. Uploaded catalog media persists in the `catalog_uploads` Docker volume mounted at `/app/storage/uploads/catalog`. For production, set `NODE_ENV=production` and `APP_URL=https://lokka.id`.

**Docker database credentials.** Inside the container, PostgreSQL is reached through `DATABASE_URL_DOCKER` (host `postgres`, the Compose service name). If it is unset, the Compose development default `postgresql://lokka:development_only@postgres:5432/lokka` is used. That fallback is **development-only**: a Docker start with `NODE_ENV=production` and no `DATABASE_URL_DOCKER` fails immediately with an actionable error instead of silently using development credentials — production must set `DATABASE_URL_DOCKER` explicitly. LOKKA never prints credential values in errors, never rotates existing credentials, and never modifies the PostgreSQL container, volume, network or data.

**Docker build provenance.** Image builds bake the host Git revision: the host resolves `HEAD` and working-tree cleanliness and passes them as `LOKKA_GIT_COMMIT`/`LOKKA_GIT_DIRTY` build args (plus a `LOKKA_BUILD_TIMESTAMP` label), so `/api/v1/version` in the container reports the actual source commit instead of null. `.git` is never copied into the image; injected values are validated identifiers only, so no remote URLs, usernames, filesystem paths or secrets can leak.

Outside the two supported runtime modes, `docker compose up -d` on the base `docker-compose.yml` (via `npm run docker:up`) remains available to start the development PostgreSQL container only.

## Server identity and occupied ports

Successful startup logs `LOKKA Webstore`, runtime mode (`fastify`/`docker`), environment, bind address, public URL, package version, build commit, PID and configured port. `/api/v1/version` returns uncached public identity, for example:

```json
{
  "app": "lokka-webstore",
  "version": "0.1.0",
  "commit": "6b346b68dca5a888be352b7b500d9c4338b7562c",
  "dirty": false,
  "environment": "production",
  "runtime": "fastify"
}
```

Identity is resolved once. Builds record it in `dist/build-info.json`; compiled servers use that snapshot even if the checkout later changes. `dirty: true` means the build included local changes, so the commit alone does not describe every file. A source archive without Git reports `commit`/`dirty` as null. `runtime` reflects the configured `APP_RUNTIME`. No paths, credentials or Git remote URLs are exposed. Development snapshots the current checkout at process startup.

If a new server crashes before binding, the browser may still reach an older process. Check `/api/v1/version` and compare its commit with the startup log. `EADDRINUSE` now clearly reports the occupied configured port and asks you to stop the confirmed old process or configure another port. LOKKA never chooses a random fallback port or terminates another process.

On Windows, identify the listener first:

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen |
    Select-Object LocalAddress,LocalPort,OwningProcess

Get-CimInstance Win32_Process -Filter "ProcessId = <PID>" |
    Select-Object ProcessId,Name,ExecutablePath,CommandLine
```

Replace `<PID>` with the listener's actual PID. Only after confirming its command line belongs to the stale LOKKA checkout, stop it with Ctrl+C in its terminal. If that terminal is unavailable, `Stop-Process -Id <PID>` stops only that confirmed process (forced termination does not exercise graceful shutdown). Never kill every `node.exe`.

On Ubuntu Server 24.04:

```sh
ss -ltnp 'sport = :3000'
ps -p <PID> -o pid,args
```

Use the service manager to stop the confirmed service, or `kill -TERM <PID>` for a confirmed manually started LOKKA process. Restart normally and recheck identity. Development uses `tsx watch` plus Vite under `concurrently -k`; Ctrl+C should stop the watchers and release the server port. Verify the listener is gone before restarting.

## Routes

| Route           | Purpose                                          |
| --------------- | ------------------------------------------------ |
| /               | Branded LOKKA introduction                       |
| /koleksi        | Active catalog, 24 products per page             |
| /kategori/:slug | Active category and paginated products           |
| /produk/:slug   | Product gallery, variants, prices and SEO        |
| /sitemap.xml    | Homepage, collection, active categories/products |
| /robots.txt     | Crawler policy; excludes admin                   |
| /admin/login    | Secure catalog administrator sign-in             |
| /health         | Process liveness, HTTP 200                       |
| /ready          | PostgreSQL query succeeds: 200; unavailable: 503 |
| /api/v1/status  | Versioned API foundation                         |

## Structure and scope

- src/config, src/plugins, src/routes: application configuration, infrastructure and routes.
- src/db/schema, drizzle: vendors, categories, products and variants with migrations.
- src/modules: documented business boundaries for future milestones.
- src/app.ts, src/server.ts: testable app factory and process lifecycle.
- views, web/client, public: EJS, browser TypeScript/CSS and future owned assets.
- tests, docs, deploy, .github: verification, architecture decisions, deployment example and CI.

See [architecture](docs/architecture.md), [admin/media ADR](docs/decisions/002-admin-catalog-media.md) and [agent rules](AGENTS.md). Money uses bigint whole rupiah. Assets and design are original; photography must be owned or licensed. No cart, checkout, customers/orders, real DOKU/Biteship integration, marketplace, reviews, wishlist, coupons, Redis or deployment is implemented. Automatic old-slug redirects, large-admin-list pagination, image orphan maintenance and audit-event history are deferred.

Next milestone after review: **Milestone 3 — Cart, Checkout Foundation & Stock Reservation**.
