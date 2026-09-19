# syntax=docker/dockerfile:1
# LOKKA Webstore production application image.
# Contains only the self-contained build (dist/), EJS views, browser assets,
# drizzle migrations, runtime translation assets and production dependencies.
# No .env secrets, repository metadata or development toolchain are included.
# The container runs the DIRECT application command (start-app.mjs), never the
# host deployment-runtime selector (scripts/start.mjs), which prevents any
# Docker-mode recursion.

FROM node:24-alpine AS build
WORKDIR /app

# Host build provenance passed through compose build args. The runtime-assets
# step (RUN below) prefers these validated values because this stage has no Git
# repository; they never leak into the final image's environment. Sentinel
# values (`unavailable`/`unknown`) resolve to a null commit in identity.
ARG LOKKA_GIT_COMMIT=unavailable
ARG LOKKA_GIT_DIRTY=unknown

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx tsc -p tsconfig.build.json \
    && node scripts/copy-runtime-assets.mjs \
    && npm run build:assets \
    && npm prune --omit=dev

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Image-level provenance only; not copied into /app. No remote URLs or secrets.
ARG LOKKA_GIT_COMMIT=unavailable
ARG LOKKA_BUILD_TIMESTAMP=unknown
LABEL org.opencontainers.image.revision=${LOKKA_GIT_COMMIT}
LABEL org.lokka.buildTimestamp=${LOKKA_BUILD_TIMESTAMP}

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
COPY --from=build /app/views ./views
COPY --from=build /app/public ./public
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts/start-app.mjs ./scripts/start-app.mjs

RUN addgroup -S lokka && adduser -S lokka -G lokka \
    && mkdir -p /app/storage/uploads/catalog \
    && chown -R lokka:lokka /app/storage

USER lokka
EXPOSE 3000
# start-app.mjs applies pending additive migrations, then starts compiled
# dist/server.js in this same process so Docker termination signals are handled.
CMD ["node", "scripts/start-app.mjs"]