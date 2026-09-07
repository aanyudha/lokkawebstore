# LOKKA Webstore

LOKKA is an Indonesian fashion and batik brand. This modular monolith uses Fastify 5, strict TypeScript, PostgreSQL 18, Drizzle/pg, EJS server rendering, Vite and plain CSS. Milestone 2 provides secure catalog administration and public browsing. Purchasing is not enabled.

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

Open http://localhost:3000. Development first builds assets, then watches server TypeScript and frontend assets concurrently. Refresh the browser after frontend edits; there is no HMR server. The asset directory is intentionally ignored by Git.

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

Enter and confirm a password of 12–128 characters; input is not echoed. There is no default administrator or password. Open http://localhost:3000/admin/login using the host configured in APP_URL (origin checks protect form submissions). Production requires HTTPS and NODE_ENV=production for Secure cookies. Sessions expire after eight hours; logout revokes the current session. To revoke all access operationally, set the admin user's status to disabled in the database. Password recovery, MFA and user-management UI are deferred.

1. **Categories:** create a category, optional parent, description, SEO text and sort order. Active categories appear publicly; hidden categories do not. Cycles are rejected. Slugs generate when blank; retain existing slugs to preserve established URLs.
2. **Products:** create draft details, choose a category, save, then add variants and images. Vendor is always LOKKA. Set active when ready; archived/draft products are hidden publicly. Featured is an optional truthful label.
3. **Variants:** use a human-readable name (e.g. Ivory / M), unique SKU, whole-Rupiah price (e.g. 695000), optional compare-at price, positive gram weight and nonnegative whole stock. Inactive variants are hidden publicly. Sort order controls presentation. No option engine is implemented.
4. **Inventory:** /admin/inventory edits absolute quantities. LOW_STOCK_THRESHOLD defaults to 5. There are no reservations or order deductions yet.
5. **Images:** upload JPEG, PNG or WebP from the product editor, up to five per request and 20/product, 10 MiB each. Files must decode as static images under 40 megapixels. Set alt text, order and primary image. Deleting the primary promotes another. File inputs must be selected again after failed uploads.

CatalogImageStorage currently persists WebP derivatives under CATALOG_STORAGE_ROOT (default storage/uploads/catalog). The directory must remain private and application-writable; uploads are Git-ignored. Derivatives fit 400/800/1600 pixel bounds, preserve aspect ratio, never upscale, and strip metadata. Originals are discarded. Back up media with PostgreSQL. Active images are served through /media/catalog; draft previews require admin authentication. A future S3 adapter is possible.

The official /images/lokka_logo.png is unchanged and separate from product media. Owner specifications under docs/basic_concept are preserved and excluded from formatting. See [design review](docs/design-input.md) for interpretation, deferred scope and the large original logo's transfer-size limitation.

For production set NODE_ENV=production, configure real credentials and APP_URL, run migrations, then start the built server from the project root. Deploy dist/, views/, public/build/, package.json and package-lock.json with production dependencies; include drizzle/ for migration execution with the release tooling. The TypeScript migration CLI requires development dependencies in the release environment, or run `node dist/db/migrate.js` after building. Example Nginx configuration is in deploy/nginx; HTTPS is deliberately left for deployment setup.

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
