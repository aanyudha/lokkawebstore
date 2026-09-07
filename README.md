# LOKKA Webstore

Technical foundation for LOKKA, an Indonesian fashion and batik brand. A modular monolith with Fastify 5, strict TypeScript, PostgreSQL 18, Drizzle/pg, EJS server rendering, Vite and plain CSS. This is a storefront shell, not a complete shop.

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

`format`, `lint:fix` and `test:watch` support daily development. `db:generate` creates committed migrations after schema edits; `db:migrate` applies them; `db:studio` opens local schema tooling. Seed is idempotent and inserts only the LOKKA vendor. Tests use Fastify inject and a database seam; no external providers or running database are needed. CI runs npm ci, formatting, lint, typecheck, tests and build on Node 24.

For production set NODE_ENV=production, configure real credentials and APP_URL, run migrations, then start the built server from the project root. Deploy dist/, views/, public/build/, package.json and package-lock.json with production dependencies; include drizzle/ for migration execution with the release tooling. The TypeScript migration CLI requires development dependencies in the release environment, or run `node dist/db/migrate.js` after building. Example Nginx configuration is in deploy/nginx; HTTPS is deliberately left for deployment setup.

## Routes

| Route          | Purpose                                          |
| -------------- | ------------------------------------------------ |
| /              | Minimal original LOKKA SSR storefront shell      |
| /health        | Process liveness, HTTP 200                       |
| /ready         | PostgreSQL query succeeds: 200; unavailable: 503 |
| /api/v1/status | Versioned API foundation                         |

## Structure and scope

- src/config, src/plugins, src/routes: application configuration, infrastructure and routes.
- src/db/schema, drizzle: vendors, categories, products and variants with migrations.
- src/modules: documented business boundaries for future milestones.
- src/app.ts, src/server.ts: testable app factory and process lifecycle.
- views, web/client, public: EJS, browser TypeScript/CSS and future owned assets.
- tests, docs, deploy, .github: verification, architecture decisions, deployment example and CI.

See [architecture](docs/architecture.md) and [agent rules](AGENTS.md). Money uses bigint whole rupiah. Assets and design are original; future photography should be owned or licensed. No final homepage, product CRUD, admin authentication, cart, checkout, customers/orders tables, real DOKU/Biteship integration, marketplace, Redis or deployment is implemented.

Next milestone: **LOKKA Catalog & Admin Product Management**.
