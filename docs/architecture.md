# Architecture

LOKKA is a single-vendor Indonesian fashion/batik store, built as a modular monolith. One Fastify process serves EJS pages and versioned JSON routes. Vite compiles small browser TypeScript and plain CSS into predictable main.js/main.css assets. No browser framework, Redis or external commerce calls are required.

## Boundaries

Catalog owns products, variants and categories. A minimal vendors table records ownership for later evolution; only LOKKA is seeded. Auth, customers, cart, checkout, orders, payments, shipping and admin are documented future boundaries. Route handlers will call domain services; modules should not reach into each other's database internals. Shared services must be infrastructure, not a catch-all for business logic.

Future PaymentService will depend on a provider contract implemented by DokuProvider in payments. Order domain code will not contain DOKU-specific request shapes. ShippingService will depend on a contract implemented by BiteshipProvider in shipping; checkout will consume domain quotes rather than Biteship payloads. Authentication, signature checks, idempotent webhooks, retries and reconciliation belong to later integration milestones. No fake transactions are implemented.

## Persistence

PostgreSQL 18 with node-postgres pooling and Drizzle. UUID keys, foreign keys, unique slugs/SKUs and checks protect core data. Money is bigint whole IDR, carried as JavaScript bigint and eventually serialized as decimal strings. Never convert to Number for arithmetic. Nonnegative stock/weight/prices are enforced. Category tree cycle prevention beyond self-parenting is deferred to catalog services. updated_at must be assigned explicitly on writes. Seed uses conflict-ignore on vendor slug and is repeatable without overwriting existing data.

Commit generated SQL and Drizzle snapshots together. Run migrations as a release step before starting the app, never implicitly on every server startup. The process closes its pool on Fastify close and termination signals. Readiness uses a bounded SELECT 1; liveness does not depend on the database. Readiness checks connectivity, not migration completeness.

## Security and deployment

TRUST_PROXY defaults to false. Set it true only behind a loopback Nginx proxy; it trusts 127.0.0.1 and ::1, never arbitrary forwarding headers. Bind Fastify to localhost. Nginx overwrites forwarding headers. Cloudflare addresses are not trusted automatically: configure Nginx real_ip with current official Cloudflare CIDRs before using client IPs from Cloudflare. Without that setup, rate limits see the edge IP.

Helmet supplies a self-only CSP, with HTTPS upgrade/HSTS disabled locally. No permissive CORS. API status is rate limited in process; health probes are not. Add authentication-specific limits and CSRF protection before cookie-authenticated writes. Cookies and form parsing are registered but no sessions are created yet. Body limit is 64 KiB. Static serving exposes only public/build, denies dotfiles, and uses revalidation because asset names are fixed. Production deployment must include dist, views, public/build, package files and production dependencies; start from the project root.

Logs remain structured JSON in all environments. Automatic request logging is disabled to avoid logging query-string credentials. Errors log only a request ID and status; responses never include stack traces or provider/database details. Add carefully redacted observability as features are introduced. TLS, production secrets, backups, database roles and production deployment are separate operational work.

## Source references

- [Fastify LTS policy](https://fastify.dev/docs/latest/Reference/LTS/)
- [Official PostgreSQL image and version 18 volume layout](https://hub.docker.com/_/postgres)

The development Compose volume mounts /var/lib/postgresql for PostgreSQL 18.
