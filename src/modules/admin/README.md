# admin

Owns admin SSR routes, session authorization, CSRF guards and catalog forms. Domain writes go through catalog services. Sales analytics and order administration are deferred.

Phase A uses independent `admin-auth.ejs` and `admin-backoffice.ejs` layouts, a dedicated Vite `admin` entry and admin-scoped CSS. Public/customer layouts and browser assets remain separate. `presentation.ts` owns real navigation and page metadata; product pricing remains contextual. Small browser TypeScript enhances the responsive navigation with focus containment, Escape/backdrop dismissal, scroll locking and focus restoration. Without JavaScript, navigation and forms remain available.

The existing database-session and CSRF hooks populate `request.internalAdmin` with only the validated admin id/name for presentation. All active legacy admins retain access to existing routes. There is no granular capability policy, persisted role assignment or new authorization grant: the existing protected route scope remains authoritative. No RBAC tables or migrations are introduced. Future staff permissions must be enforced server-side before exposing differentiated access.

Do not add future modules to navigation until their routes, domain behavior and authorization exist. Preserve mutation field names, actions, redirects and multipart CSRF ordering when editing templates. Internal errors render with admin assets and no storefront chrome.
