# Origin validation and cross-module action audit

Date: 2026-10-29. Scope: existing functionality only. No schema, dependency,
checkout, tax, or UI redesign changes. Baseline: clean `main`, commit
`69f58aae79434f43e335d24f1e4c6a63a562a429`.

## 1–8. Diagnosis and security

1. **Exact root cause:** the owner opened
   `http://192.168.1.122:3000/admin/products/baae3e46-36c1-4bca-b207-ff6e7c0fd076/edit`.
   Saving posts to the same product URL without `/edit`. The configured
   `APP_URL=http://127.0.0.1:3000` did not allow the LAN origin. The three old
   module policies differed; admin and POS had limited loopback aliases,
   customer had canonical-only checking, and some public auth actions lacked
   origin checking.
2. **Captured browser request:** method `POST`; request URL
   `http://192.168.1.122:3000/admin/products/baae3e46-36c1-4bca-b207-ff6e7c0fd076`;
   `Origin: http://192.168.1.122:3000`; `Host: 192.168.1.122:3000`;
   `Referer` was the exact owner edit URL above. `X-Forwarded-Host` and
   `X-Forwarded-Proto` were absent. Before-fix response: **403 Invalid origin.**
   This was reproduced in Chrome at the exact address against an isolated,
   migrated QA database, with a controlled product using the same UUID;
   the actual owner's product was never submitted by automation.
3. **Configuration:** before, `APP_URL=http://127.0.0.1:3000`;
   `NODE_ENV=development`, `APP_RUNTIME=fastify`, `HOST=0.0.0.0`, `PORT=3000`,
   `TRUST_PROXY=false`. Local ignored `.env` now has
   `APP_URL=http://192.168.1.122:3000` and
   `DEV_ALLOWED_ORIGINS=http://127.0.0.1:3000,http://localhost:3000`.
   No database URL, password, or secret was changed or published.
4. **Central fix:** `src/security/origin.ts` supplies one validator;
   `src/app.ts` installs it before routes for every non-GET/non-HEAD request,
   including admin/POS/customer login, registration, and logout. The three
   duplicated origin blocks were removed. Locale and path do not determine
   origin membership. Unsupported/malformed origins are rejected before
   domain writes.
5. **Security retained:** exact configured HTTP(S) origins only; no wildcard,
   arbitrary Host/Referer inference, loopback range, or forwarding-header
   bypass. Missing `Origin` retains the existing non-browser policy, with
   independent session and CSRF checks. Empty, `null`, malformed, multiple,
   credential-bearing, path-bearing, wrong-host, wrong-port, and wrong-scheme
   Origin values fail. Auth, active database sessions, ownership, domain
   validation, and module-specific CSRF checks remain in place. Admin and POS
   session surfaces remain separate.
6. **Development equivalence:** configured localhost and 127.0.0.1 entries gain
   only their counterpart with the same protocol and port. LAN addresses need
   explicit canonical/extra configuration. Port 9999 and unconfigured LAN
   addresses remain forbidden. Production ignores `DEV_ALLOWED_ORIGINS` and
   accepts only the canonical `APP_URL` origin.
7. **Production/Nginx contract:** set `APP_URL` to the real public HTTPS URL.
   Comparison uses that configured public origin even when Nginx forwards an
   internal HTTP request to Fastify. Existing `TRUST_PROXY=true` trusts only
   loopback proxy addresses; it does not expand the origin list. Nginx must
   overwrite forwarding headers. The checked-in example is an HTTP template
   requiring a real TLS server block/certificates before production. Tests
   simulate the public HTTPS/internal HTTP contract; live Nginx, DNS, and TLS
   infrastructure were not deployed or certified here.
8. **CSRF regressions:** valid origin plus valid CSRF succeeds; valid origin
   plus missing/invalid CSRF is rejected; forged origin plus valid-looking
   tokens is rejected. Multipart still validates CSRF before file processing.
   These protections also cover EN and ID customer routes.

## 9–19. Existing actions exercised in a real browser

All rows below ran at the exact LAN, 127.0.0.1, and localhost addresses on
port 3000. A private QA proxy forwarded exclusively to disposable Fastify on
3031; a unique response marker was asserted before the first POST. Native
browser Origin/Host headers and every POST status were captured. This avoids
mutations on the separately running owner server at port 3000. Each host uses
a fresh migrated PostgreSQL database. Successful changes were checked after
reload and/or directly against that QA database. Dashboard and report pages
have no mutation of their own.

| Item | Area             | Actions and persisted checks                                                                                                                                                                          | Result              |
| ---- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 9    | Products         | Create, edit, draft/deactivate, reactivate, archive; variant create/edit; unit direct-cost create/edit/delete; pricing-profile save. Historical sale cost remains unchanged after current cost edits. | FIXED / READY       |
| 10   | Categories       | Create, edit name and status; product category assignment.                                                                                                                                            | READY               |
| 11   | Inventory        | Adjust stock 5 to 6, reload; completed sale reduces it to 5 exactly once.                                                                                                                             | READY               |
| 12   | Media            | PNG/JPEG uploads, alt/primary update, protected original download, delete both; no owner media touched.                                                                                               | READY               |
| 13   | Cash Flow        | Opening balance Rp1,000,000; cash-only income, expense and sale reflected; ending cash Rp1,820,000 after expense void.                                                                                | READY               |
| 14   | Income & Expense | Manual income Rp25,000, expense Rp50,000, void expense; visible history and report effects.                                                                                                           | READY               |
| 15   | Accounting Lite  | Today, month, custom empty period, return to today; drill-down references and finance links; revenue Rp795,000, HPP Rp300,000, net Rp445,000, then Rp495,000 after void.                              | NO MUTATION / READY |
| 16   | Global Overhead  | Create and update planned cost, open/snapshot period, update forecast, adjustment, recovery, close. Planning creates no financial transactions.                                                       | READY               |
| 17   | Fulfillment      | Create origin, edit city, reload persisted settings.                                                                                                                                                  | READY               |
| 18   | POS              | Separate login/logout, SKU search GET, cart cancel, exact-cash payment submission and completed sale POST, receipt, reload; exactly one Rp795,000 sale finance entry.                                 | FIXED / READY       |
| 19   | Customer Auth    | EN and ID registration, profile edit, password change, logout, login with changed password, logout. Admin login/logout also exercised.                                                                | FIXED / READY       |

## 20–26. Verification evidence

20. **Attacks:** integration tests send invalid/malformed origins across every
    mutation surface, including public authentication, and spoof Host,
    Referer, X-Forwarded-Host, and X-Forwarded-Proto. Requests remain rejected;
    no sale, finance, or stock side effects. Production accepts canonical
    public HTTPS and rejects development extras despite spoofed forwarding.
21. **Console/network:** three-host browser regression passes with no page or
    console errors and no unexpected 4xx/5xx. Each captured POST has the
    expected native Origin/Host and status below 400. Browser favicon 404 is
    explicitly excluded. Chrome previously complained about COOP on HTTP LAN,
    where it cannot enforce that header. The app now omits that unsupported
    header only for non-production, non-trustworthy configured HTTP contexts;
    production, HTTPS, and loopback canonical contexts retain `same-origin`.
    CSP and other security controls are unchanged; production COOP is tested.
22. **Automated checks:** format, lint, typecheck pass; final `npm test` passes
    **16 files / 265 tests**. An earlier invocation raced the build's asset
    cleanup and produced two transient asset/timeout failures; the complete
    suite was rerun after build completion and passed. Production's default
    port 3000 probe safely fails with EACCES while the owner listener is
    present; supported `PRODUCTION_TEST_PORT=3025` passes **8/8**, using a fresh
    migrated `lokka_production_*` database. Playwright lists **14 tests / 10 files**.
23. **Full browser run #1:** **14/14 PASS**, 10 files, 3.1 minutes.
24. **Full browser run #2:** **14/14 PASS**, 10 files, 2.9 minutes.
25. **Owner database:** before snapshot includes all 26 tables, 28 rows, and
    sequence state. SHA-256:
    `36c457cb1249da1065d9fafa4379a63940186d02b6b2808d8e9fe01458862e79`.
    After both full suites, restart and live read-only HTTP checks: **identical**
    tables, rows, sequences and SHA-256. No automated mutation targets the owner DB;
    fixture data is dropped by disposable database cleanup. Two abandoned QA
    databases from an interrupted early harness run were identified by their
    exact UUID names and this task's unique product marker, then dropped only
    after confirming no active connections. QA screenshots,
    traces, captured headers, fingerprints and logs stay in ignored storage.
26. **Build/runtime:** final `npm run build` **PASS**. Rechecked the existing
    LOKKA runtime identity and listener, then restarted only PID 24176 using
    the verified compiled `dist/server.js`; current PID **28260**, listening
    on **0.0.0.0:3000**. Startup confirms the LAN public URL and development
    runtime. The version endpoint now reports `dirty=true` for these unstaged
    changes at the same baseline commit. Live read-only checks return **200**
    for version, Admin/POS login and EN/ID customer login on all three hosts.
    No owner migration, seed, login, sale or product mutation was executed.

## 27–29. Workspace

27. **Changed files:** `.env.example`, `README.md`,
    `deploy/nginx/lokka.conf.example`, `src/app.ts`, `src/config/env.ts`,
    `src/modules/admin/routes.ts`, `src/modules/customer/routes.ts`,
    `src/modules/pos/routes.ts`, new `src/security/origin.ts`,
    `tests/origin.test.ts`, `tests/origin-actions.test.ts`,
    `tests/browser/origin-actions.spec.ts`, and this report. Local ignored
    `.env` also changed as documented above. No schema/migration, dependency,
    UI template, owner concept, or official logo changes.
28. **git diff --check:** **PASS**.
29. **git status:** modified/new files listed above, all unstaged. No git add,
    commit, push, reset, clean, or restore performed.

## Owner menu readiness

| Menu             | Status              |
| ---------------- | ------------------- |
| Dashboard        | NO MUTATION / READY |
| Products         | FIXED / READY       |
| Categories       | READY               |
| Inventory        | READY               |
| Media            | READY               |
| POS              | FIXED / READY       |
| Cash Flow        | READY               |
| Income & Expense | READY               |
| Accounting Lite  | NO MUTATION / READY |
| Global Overhead  | READY               |
| Fulfillment      | READY               |
| Customer Auth    | FIXED / READY       |

Overall: **READY FOR OWNER USE** on the configured LAN development installation.
Final acceptance remains the owner's retest of their existing product through
their normal LAN browser session. No real owner product save was automated.
