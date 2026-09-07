# Project rules

- Keep a modular monolith: Fastify 5, strict TypeScript, PostgreSQL, Drizzle with pg.
- Render the storefront on the server with EJS. Vite builds browser assets only.
- No React/Next.js or alternative web frameworks unless the architecture is deliberately changed.
- Single vendor LOKKA only. Do not add marketplace onboarding to this foundation.
- Never commit secrets, environment files, logs, database data or dependencies.
- Keep payment integrations behind PaymentService/provider contracts; DokuProvider belongs in payments.
- Keep shipment integrations behind ShippingService/provider contracts; BiteshipProvider belongs in shipping.
- Indonesian Rupiah money must never use JavaScript floating-point arithmetic. Use bigint whole rupiah; serialize monetary values as decimal strings in future APIs.
- Add tests for business-critical changes and migrations for database changes.
- Update updated_at explicitly in domain writes; timestamps have insert defaults, not automatic update triggers.
- Avoid unnecessary dependencies; keep module ownership explicit.
- Maintain accessibility, semantic HTML, SEO and visible keyboard focus.
- Do not copy third-party website code, images, fonts or assets.
- Run formatting, lint, typecheck, tests and production build before committing.

Next milestone: LOKKA Catalog & Admin Product Management.
