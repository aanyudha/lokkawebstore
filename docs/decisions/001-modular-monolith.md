# ADR 001: Modular monolith

Status: accepted.

LOKKA needs a maintainable single-vendor commerce foundation without distributed systems overhead. Use one Fastify application, strict TypeScript, a PostgreSQL database, Drizzle, and server-rendered EJS with Vite assets. Organize future functionality into business modules. Keep payments and shipping behind provider abstractions.

This keeps deployment and local development straightforward, while a vendor ownership key allows later domain expansion. Modules share a process and database, so dependency discipline and service contracts matter. Marketplace flows, microservices, Redis, queues and browser frameworks are deferred until a demonstrated requirement justifies an explicit architecture decision.
