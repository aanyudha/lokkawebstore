# customer

Owns storefront customer identity and authentication: registration, sign-in, opaque database sessions, profile name updates, password changes and sign-out.

- `service.ts` — `createCustomerAuth(db)` with `register`, `login`, `session`, `logout`, `updateName` and `changePassword`. Argon2id reuses the shared `argon2idOptions` contract from `src/modules/auth/service.ts`. Unknown emails are verified against a dummy hash so timing does not reveal account existence. Sessions live for 30 days and rotate on sign-in, registration and password change.
- `validation.ts` — deterministic email normalization (trim + lowercase), field validators that raise `FormError` with translation keys, and `safeReturnPath` open-redirect protection.
- `routes.ts` — English (`/account/*`) and Indonesian (`/id/akun/*`) routes, cookie/CSRF handling, tighter rate limits on credential endpoints, `noindex,nofollow` plus `private, no-store`, and a global `onRequest` hook that exposes the signed-in customer to EJS via `reply.locals.customer`.

Customer sessions never overlap with admin sessions: separate tables, cookies, CSRF tokens and route scopes. Account pages are excluded from the sitemap and disallowed in `robots.txt`. Email verification, password reset and rewards are deferred; the `customers.email_verified_at` column is reserved for a future milestone.
