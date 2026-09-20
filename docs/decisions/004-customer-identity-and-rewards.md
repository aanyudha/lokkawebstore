# ADR 004: Customer identity and authentication

Status: accepted for Milestone 2.6.

## Scope and separation

This milestone adds the storefront customer boundary: self-service registration, sign-in, an account overview, profile name editing, password change and sign-out, in both English and Indonesian. It deliberately does not add cart, checkout, orders, payments, shipping, email delivery, email verification, password reset or rewards. No customer is seeded and there is no default credential.

Customer authentication is isolated from administrator authentication. They use separate tables (`customers` / `customer_sessions` versus `admin_users` / `admin_sessions`), separate cookie names (`lokka_customer`, `lokka_customer_csrf`, `lokka_customer_login_csrf`), separate CSRF checks and separate route scopes. A customer session can never reach `/admin`, and an admin session grants nothing on `/account`. `src/modules/customer` owns customer identity; `src/modules/auth` continues to own admin identity and exports only the shared `argon2idOptions` hashing contract.

## Identity and credentials

`customers.email` stores the trimmed original address for display. `customers.email_normalized` stores the deterministic identity: the trimmed value lowercased as a whole. Provider-specific rewriting (Gmail dot removal, plus-address stripping) is intentionally not applied because it can merge distinct identities. A unique index on `email_normalized` enforces one account per normalized address; a database check requires the normalized value to equal `lower(btrim(...))`, and a check rejects blank names. Registration maps the PostgreSQL unique-violation to a friendly "email already exists" error.

Passwords are hashed with Argon2id using the shared parameters (memoryCost 65536, timeCost 3, parallelism 1). Customer passwords are 10–128 characters and are validated as raw strings, never trimmed. Sign-in verifies unknown accounts against a dummy hash so response timing does not disclose whether an address exists, and always returns a single generic error. `email_verified_at` stays nullable and unused: verification is deferred, and no verification email is ever faked.

## Sessions and request safety

`customer_sessions` stores an opaque 32-byte token hashed with SHA-256, plus a hashed CSRF token, IP, user agent, expiry and last-seen timestamp. Sessions last 30 days and are rotated on registration, sign-in and password change; the previous session row is deleted, preventing session fixation. Changing a password deletes every session for the customer and issues a new one, signing out other devices. Sign-out deletes the current session. A database session that expires or whose customer is disabled resolves to no session.

Cookies are httpOnly, `SameSite=Lax`, `Secure` in production and scoped to `/`. Protected routes require both a valid session cookie and a CSRF cookie matching the session's hashed token, validate the request origin on non-GET methods, and verify a CSRF field in the body. Sign-in, registration and password change carry tighter rate limits than the global default. `returnTo` accepts only same-site `/account` and `/id/akun` paths, rejecting absolute URLs, scheme-relative URLs (`//host`), backslashes, control characters and any other path, which prevents open redirects.

## Localization and rendering

English is canonical with no prefix; Indonesian uses `/id/akun`. Shared handlers render per locale and pass a `languagePaths` map so the header language switcher links to the equivalent account page instead of the homepage. All customer-facing copy, labels, notices and errors live in `src/i18n/resources/en.json` and `id.json` under `account.*`; validation raises translation keys, never locale conditionals in templates.

A global `onRequest` hook resolves the session and sets `reply.locals.customer`, so the storefront header renders the account link and the signed-in name on every page without threading customer state through each route. Account views use an editorial, premium layout distinct from the admin UI, reuse the shared design tokens and buttons, keep labels and autocomplete attributes, show visible keyboard focus, and provide an accessible show/hide password control that announces its state.

## Privacy, SEO and caching

Account pages send `X-Robots-Tag: noindex, nofollow` and `Cache-Control: private, no-store`, carry no canonical/OpenGraph block and are excluded from `sitemap.xml`. `robots.txt` disallows `/account` and `/id/akun` in addition to `/admin`. No customer data, email or session value appears in public HTML, metadata, JSON-LD or APIs.

## Future rewards boundary

**No rewards are implemented.** When rewards arrive, ownership belongs to a `RewardService` backed by a separate reward account and an append-only ledger with `EARN`, `REDEEM`, `EXPIRE`, `REVERSAL`, `REFUND` and `MANUAL_ADJUSTMENT` entry types. Customer records must not carry a mutable points balance column; balances are derived from the ledger. Future cart and checkout work will accept a nullable `customer_id` so guest ownership remains possible.

## Migration and verification

`0005_customer_identity.sql` adds the `customer_status` enum plus the `customers` and `customer_sessions` tables with their unique indexes, checks, foreign key and expiration/customer indexes. It is additive; existing catalog, commercial and admin data are untouched. The migration is applied to the native development database and is applied automatically on startup in production.

`tests/customer.test.ts` runs against a uniquely named disposable migrated database and covers open-redirect rejection, registration, duplicate-email rejection, CSRF enforcement, password mismatch, authenticated-only access, case-insensitive sign-in, safe/unsafe `returnTo`, profile update, password change with session rotation and old-session invalidation, Indonesian routes, sign-out and admin/customer isolation. `tests/browser/customer-account.spec.ts` verifies the account pages and the show/hide password control across 1440, 1024, 768, 430, 390, 375 and 360 pixel widths without horizontal overflow, then cleans up its fixture. Existing catalog and commercial suites continue to pass.
