# Architecture

LOKKA is a single-vendor Indonesian fashion/batik store, built as a modular monolith. One Fastify process serves EJS pages and versioned JSON routes. Vite compiles small browser TypeScript and plain CSS into predictable main.js/main.css assets. No browser framework, Redis or external commerce calls are required.

## Boundaries

Catalog owns products, variants, categories and image metadata/storage contracts. Auth owns administrator passwords and sessions; Customer owns storefront registration, sign-in, sessions, profile and password changes; admin renders management forms and calls catalog services. A minimal vendors table records ownership for later evolution; only LOKKA is seeded. Cart, checkout, orders, payments and shipping-provider integration remain deferred boundaries. Shared services must be infrastructure, not a catch-all for business logic. See ADR 002 for admin sessions, CSRF, lifecycle, transactions and media compensation, and ADR 004 for customer identity.

Future PaymentService will depend on a provider contract implemented by DokuProvider in payments. Order domain code will not contain DOKU-specific request shapes. ShippingService will depend on a contract implemented by BiteshipProvider in shipping; checkout will consume domain quotes rather than Biteship payloads. Authentication, signature checks, idempotent webhooks, retries and reconciliation belong to later integration milestones. No fake transactions are implemented.

## Persistence

Milestone D1: Finance owns the single canonical `financial_transactions` cash ledger: direction (INCOME/EXPENSE), source (POS/WEBSTORE/MANUAL), structured categories, POSTED/VOIDED status and an optional sale reference. One completed sale posts income exactly once, protected by a partial unique index plus idempotent insert. Cash Flow and Income & Expense are admin views derived from that ledger by server-side aggregation; the opening balance is itself a ledger event. Global Overhead remains a costing/planning model and never becomes a Cash Flow expense. Cash Flow is cash movement, not profit and loss; Accounting Lite and Tax Readiness are deferred consumers of the same rows. See [ADR 005](decisions/005-finance-ledger-cash-flow.md).

Milestone 2.6: Customer owns `customers` and `customer_sessions` with Argon2id credentials, deterministic normalized emails and 30-day opaque sessions isolated from admin sessions. Account pages are noindex/private and excluded from the sitemap. No cart, order, reward or email delivery is implemented. See [ADR 004](decisions/004-customer-identity-and-rewards.md).

Milestone 2.5: Finance owns direct product costing, pricing profiles, global overhead masters, period snapshots and an append-only manual recovery workflow. Shipping owns fulfillment-origin settings and an internal shipping-readiness resolver. Admin routes call these modules inside the existing session/CSRF boundary. No shipping provider or commerce integration is implemented. See [ADR 003](decisions/003-commercial-pricing-overhead.md) for formulas, ownership, history and concurrency rules.

PostgreSQL 18 with node-postgres pooling and Drizzle. UUID keys, foreign keys, unique slugs/SKUs and checks protect core data. Money is bigint whole IDR, carried as JavaScript bigint and serialized as decimal strings in structured data. Never convert to Number for arithmetic. Catalog writes validate positive prices/weights and nonnegative stock. Category services prevent cycles under a transaction advisory lock. updated_at is assigned explicitly on writes. Seed uses conflict-ignore on vendor slug and is repeatable without overwriting existing data. Public collections batch variant/image lookups for the 24-product page; there are no per-product DB queries.

Commit generated SQL and Drizzle snapshots together. Migrations are additive only; each pending migration is applied inside its own transaction and nothing is dropped or reset. On startup, `npm start`/`start-app.mjs` applies pending additive migrations as a controlled step and fails with an actionable message if the database is unavailable; `npm run db:migrate` remains available for explicit manual migration. The process closes its pool on Fastify close and termination signals. Readiness uses a bounded SELECT 1; liveness does not depend on the database. Readiness checks connectivity, not migration completeness.

## Security and deployment

TRUST_PROXY defaults to false. Set it true only behind a loopback Nginx proxy; it trusts 127.0.0.1 and ::1, never arbitrary forwarding headers. HOST defaults to 0.0.0.0 so LAN/container connections work; the canonical public origin is APP_URL, which is the only origin trusted by admin verb mutations. Nginx overwrites forwarding headers. Cloudflare addresses are not trusted automatically: configure Nginx real_ip with current official Cloudflare CIDRs before using client IPs from Cloudflare. Without that setup, rate limits see the edge IP.

Helmet supplies a self-only CSP, with HTTPS upgrade/HSTS disabled locally. No permissive CORS. API status, login and uploads are rate limited in process; health probes are not. Cookie-based admin writes require authenticated active users and verified CSRF tokens. Normal body limit is 64 KiB; uploads permit 51 MiB with per-file/part/decode bounds. Static serving exposes public/build plus the explicit official logo route, not arbitrary project files. Product media uses authorized lookup and storage contracts. Production deployment must include dist, views, public/build, public/images/lokka_logo.png, package files and production dependencies; start from the project root. Persist uploads outside ephemeral releases.

Logs remain structured JSON in all environments. Automatic request logging is disabled to avoid logging query-string credentials. Errors log only a request ID and status; responses never include stack traces or provider/database details. Add carefully redacted observability as features are introduced. TLS, production secrets, backups, database roles and production deployment are separate operational work.

## Source references

- [Fastify LTS policy](https://fastify.dev/docs/latest/Reference/LTS/)
- [Official PostgreSQL image and version 18 volume layout](https://hub.docker.com/_/postgres)

The development Compose volume mounts /var/lib/postgresql for PostgreSQL 18.
