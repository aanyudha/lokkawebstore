# Homepage hero media audit and safe fix

2026-10-29. Starting state: clean `main`, HEAD
`eeba4edd51767a38f13713a345f5ea627f58f8ba`. All work continues in that checkout;
no reset, restore, clean, stash, checkout, switch, staging, commit or push.

## 1–5. Cause and owner flow

1. **Exact cause:** `views/pages/home.ejs` rendered only an empty
   `hero-placeholder` div inside `hero-visual`. The homepage routes supplied
   catalog text but no hero media model. There was no `<img>`, CSS background
   URL, missing asset request, or existing hero configuration to repair.
   Live Chrome GETs at `http://192.168.1.122:3000/` and `/id` returned 200,
   zero hero images and one placeholder each. Collections displayed its
   existing catalog WebP successfully. No page errors occurred.
2. **Previous source:** hardcoded neutral CSS gradient, not Product Media.
   Vite/browser caching was not the cause of the original blank visual.
3. **Final source:** one explicit `homepage_hero` singleton in PostgreSQL,
   owned by storefront, with its own image key and alt text. No first-product,
   collection or random-image fallback. EN and ID read the same configuration.
4. **Minimal new configuration:** migration `0009_homepage_hero` and
   Admin → Settings → Homepage. No hero title/body/CTA editor or generic CMS.
   Existing homepage text/localization, layout and product media ownership are
   preserved. `updated_at` is explicitly updated in configuration writes.
5. **Owner flow:** log in to Admin, choose Settings → Homepage, upload one
   image, enter alt text, save, then reload homepage. A new upload replaces
   the image; leaving the file empty updates only alt text. Remove clears the
   reference and restores the neutral placeholder. The owner explicitly chose
   to leave the live hero empty until they upload their own image.

## 6–8. Storage, fallback, accessibility

6. **Existing primitives reused:** `CatalogImageStorage` and
   `LocalCatalogImageStorage.save/read/removeWithSource/url`. The existing
   pipeline validates bytes, decodes static JPG/PNG/WebP, limits 10 MB and
   40 megapixels, rotates and emits bounding sizes 400/800/1600 as WebP.
   The source remains private with a separate UUID. Hero uses its own public
   `/media/homepage/:key/:size.webp` namespace, which only serves the current
   configured hero's derivatives. Product catalog public authorization and
   source-download handlers remain unchanged. Public view models contain no
   private source key/path. Product Media does not list hero originals.

   Singleton writes use a PostgreSQL transaction/advisory lock, including the
   initial insert, to serialize replacements. Files are prepared first; failed
   DB writes remove the new files. Old files are removed only after commit.
   A cleanup failure logs a warning and preserves the committed live reference.
   Clear deletes the reference transactionally before removing its files.

   New immutable UUID filenames avoid stale replacement content. Derivatives
   retain the existing five-minute public media caching policy; homepage HTML
   revalidates (`no-cache` in production, existing no-store in development).
   There is no global cache or CSP relaxation, and no Vite rebuild is needed
   when the owner subsequently changes hero media.

7. **Fallback:** empty configuration or an invalid persisted storage key
   renders the existing neutral div with no image request. Missing derivative
   files use the existing storage fallback (another WebP derivative, otherwise
   generated neutral WebP), never the private original. No random product image,
   broken image icon or repeated missing-image requests.
8. **Accessibility:** configurable escaped alt text, 300-character maximum;
   empty means decorative. Filename is not used as alt. Configured images
   are no longer inside an aria-hidden ancestor. Fallback is aria-hidden.
   Existing labels, focus styles and admin form-error conventions are reused.
   Preview styles are external CSS, compatible with existing strict CSP.

## 9–14. Browser and media regressions

9. **EN:** configured hero, alt text, successful WebP response, replacement
   after reload and remove/fallback verified.
10. **ID:** same hero/configuration, localized copy unchanged; configured and
    fallback paths verified.
11. **Responsive:** Chrome screenshots inspected at 1440, 820 and 390 px
    in both languages. No overflow; existing 4:5 visual retained with centered
    `object-fit: cover`. The existing design intentionally hides the visual
    below 700 px; that behavior was preserved. Responsive card/detail srcset
    and high fetch priority are applied to the hero.
12. **Collections/Product detail/Admin Media:** fixture product images remain
    visible and publicly served through their existing catalog URLs. Original
    download/storage security stays covered by existing regression suites.
13. **POS:** separate login and product-image rendering/decoding verified
    after hero replacement. Existing sale/media regressions are included in
    the complete suite.
14. **Console/network:** targeted real Chrome flow passes with no pageerror,
    console error, unexpected 4xx/5xx, or CSP violation; favicon 404 excluded.
    The new QA flow uses the exact owner LAN address via a private proxy
    forwarding only to its migrated disposable DB/storage fixture. A unique
    response marker is checked before the first POST, protecting the owner
    listener. It uploads controlled generated test images only to that fixture.
    No owner administrator credential/session is created or borrowed.

## 15–16. Verification and isolation

15. **Automated:** `npm test` **275/275, 17 files PASS**, including 10 focused
    hero tests for empty/configured EN/ID, private original isolation, replace,
    invalid upload, auth/origin/CSRF, alt update, DB rollback/file cleanup,
    missing derivatives, invalid reference, and remove. The existing navigation
    contract test now includes the implemented Homepage link (12 links).
    Typecheck and lint PASS. Default production smoke safely refuses occupied
    port 3000 (Windows EACCES); the supported `PRODUCTION_TEST_PORT=3025`
    run passes **8/8** using a fresh migrated disposable production fixture.
    Final format/lint/typecheck checks: **PASS**.
16. **Playwright:** lists **15 tests / 11 files**. Targeted hero test PASS;
    full suite: **15/15 PASS**, 11 files, 3.2 minutes. Final production build **PASS**.

Owner database before suites: 26 tables / 42 rows including sequence state,
SHA-256 `2bb2bb84847d2f041cabf6449f0ad6147daeeca7e75ee0db4cf3f2895c134268`.
The comparison after unit/targeted browser/production tests is identical.
The same complete fingerprint remained identical after all automated suites,
immediately before intentional installation of the new migration. All automated mutations use disposable migrated
databases and dedicated storage roots. No owner business record or product
media was edited. The owner requested that their hero remain unconfigured.

Live installation: migration `0009_homepage_hero` was applied without seeding.
The owner database now has 27 tables: the additional `homepage_hero` table is
empty. A read-only integrity comparison verified every pre-existing row and
business sequence unchanged. The only other changes are the one verified
migration-registry row and its sequence increment by one. No product, sale,
financial entry, user or session was inserted, edited or removed.

The verified LOKKA listener PID 7964 was restarted to load the compiled build
and updated asset filenames. Current server PID **24288**, port **3000**.
No second listener was started. Live Chrome checks on `/`, `/id` and
`/collections` return 200, no console/page errors and no unexpected failed
requests. Both homepages retain the requested empty hero fallback; the owner's
existing Collections product image still decodes correctly. The new settings
route remains authenticated; no owner credential or administrative session
was created for QA. Full authenticated upload/replace/remove and POS rendering
were verified at the exact owner-visible LAN address with isolated fixtures;
live owner upload is intentionally deferred to their chosen image/session.

## 17–20. Files and Git

17. **Changed files:**
    - `README.md`, this report.
    - `drizzle/0009_homepage_hero.sql`, `drizzle/meta/_journal.json`,
      `src/db/schema/index.ts`.
    - `src/modules/storefront/hero.ts`,
      `src/modules/admin/homepage-routes.ts`,
      `src/modules/admin/routes.ts`, `src/modules/admin/presentation.ts`.
    - `src/app.ts`, `src/routes/index.ts`.
    - `views/pages/home.ejs`, `views/admin/homepage.ejs`.
    - `web/client/styles/catalog.css`, `web/client/styles/admin.css`.
    - `tests/homepage-hero.test.ts`, `tests/browser/homepage-hero.spec.ts`,
      `tests/admin-foundation.test.ts`.

    No dependency, environment, payment/shipping integration, financial
    business logic, official logo or owner concept-source changes.

18. **git diff --check:** **PASS**.
19. **git status:** modified/new files above, all unstaged. Starting tree was
    clean. No commit or push performed; existing user commits remain intact.
20. **Recommended commit message:** `fix: wire homepage hero media safely`.
    Recommendation only; not executed.
