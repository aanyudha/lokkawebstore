# Bootstrap dependency review

Stable packages were resolved through npm and pinned exactly in package.json, with package-lock.json committed. Node is constrained to 24.x and Fastify to the selected 5.x release. No prerelease packages are intended.

At bootstrap, npm audit reported four moderate findings in the development-only chain drizzle-kit → @esbuild-kit/esm-loader → @esbuild-kit/core-utils → esbuild. They trace to [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99), concerning the esbuild development server. This project's asset workflow uses Vite build/watch, not an esbuild development server. npm audit --omit=dev reported zero vulnerabilities.

The offered fix downgraded Drizzle Kit to 0.18.1, an incompatible tooling change. No forced downgrade or unverified transitive override was applied. Recheck on dependency updates; keep Drizzle Studio local and do not expose development tooling publicly. The deprecated esbuild-kit packages are transitive Drizzle Kit dependencies, not direct project choices.
