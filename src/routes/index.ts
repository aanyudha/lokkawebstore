import type { FastifyInstance } from 'fastify';
import type { Catalog } from '../modules/catalog/service.js';
import type { AppEnv } from '../config/env.js';
import { locales, orderedLocales } from '../i18n/index.js';
import { t } from '../i18n/translator.js';
import { runtimeIdentity } from '../config/identity.js';

export async function registerRoutes(
  app: FastifyInstance,
  database: { check: () => Promise<void> },
  catalog?: Catalog,
  env?: AppEnv,
) {
  const identity = runtimeIdentity(
    env?.nodeEnv ?? 'development',
    env?.appRuntime ?? 'fastify',
  );
  app.get('/api/v1/version', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return identity;
  });
  // ─── English homepage (default, no prefix) ─────────────────
  app.get('/', async (_request, reply) => {
    const categories = catalog
      ? (await catalog.categoryListLocale('en')).map((c) => ({
          id: c.category.id,
          name: c.translation.name,
          slug: c.translation.slug,
        }))
      : [];
    const products = catalog
      ? (await catalog.publicListLocale(1, 'en')).rows.slice(0, 4)
      : [];
    return reply.viewAsync('pages/home.ejs', {
      title: 'LOKKA — Contemporary Indonesian fashion',
      categories,
      canonical: env?.appUrl,
      locale: 'en',
      locales: orderedLocales,
      t: (key: string, interp?: Record<string, string | number>) =>
        t('en', key, interp),
      alternateLinks: `<link rel="alternate" hreflang="en" href="${env?.appUrl}" />\n    <link rel="alternate" hreflang="id-ID" href="${env?.appUrl ? new URL('/id', env.appUrl).href : '/id'}" />\n    <link rel="alternate" hreflang="x-default" href="${env?.appUrl}" />`,
      htmlLang: locales.en.htmlLang,
      featuredProducts: products,
      storage: catalog ? undefined : undefined,
      formatIdr: undefined,
    });
  });

  // ─── Indonesian homepage (with /id prefix) ─────────────────
  app.get('/id', async (_request, reply) => {
    const categories = catalog
      ? (await catalog.categoryListLocale('id')).map((c) => ({
          id: c.category.id,
          name: c.translation.name,
          slug: c.translation.slug,
        }))
      : [];
    const products = catalog
      ? (await catalog.publicListLocale(1, 'id')).rows.slice(0, 4)
      : [];
    return reply.viewAsync('pages/home.ejs', {
      title: 'LOKKA — Fashion Indonesia kontemporer',
      categories,
      canonical: env?.appUrl ? new URL('/id', env.appUrl).href : undefined,
      locale: 'id',
      locales: orderedLocales,
      t: (key: string, interp?: Record<string, string | number>) =>
        t('id', key, interp),
      alternateLinks: `<link rel="alternate" hreflang="en" href="${env?.appUrl}" />\n    <link rel="alternate" hreflang="id-ID" href="${env?.appUrl ? new URL('/id', env.appUrl).href : '/id'}" />\n    <link rel="alternate" hreflang="x-default" href="${env?.appUrl}" />`,
      htmlLang: locales.id.htmlLang,
      featuredProducts: products,
      storage: catalog ? undefined : undefined,
      formatIdr: undefined,
    });
  });

  // ─── Redirect old unprefixed Indonesian routes ─────────────
  app.get('/koleksi', async (_request, reply) =>
    reply.redirect('/id/koleksi', 301),
  );
  app.get('/id/collections', async (_request, reply) =>
    reply.redirect('/id/koleksi', 301),
  );
  app.get('/kategori/:slug', async (request, reply) =>
    reply.redirect(
      `/id/kategori/${(request.params as { slug: string }).slug}`,
      301,
    ),
  );
  app.get('/produk/:slug', async (request, reply) =>
    reply.redirect(
      `/id/produk/${(request.params as { slug: string }).slug}`,
      301,
    ),
  );

  // ─── Health and API ────────────────────────────────────────
  app.get('/health', async () => ({ status: 'ok', service: 'lokka-webstore' }));
  app.get('/ready', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      await database.check();
      return { status: 'ok', service: 'lokka-webstore' };
    } catch {
      reply.code(503);
      return { status: 'unavailable', service: 'lokka-webstore' };
    }
  });
  await app.register(
    async (api) => {
      api.get(
        '/status',
        {
          config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
          schema: {
            querystring: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
          },
        },
        async () => ({
          status: 'ok',
          service: 'lokka-webstore',
          version: 'v1',
        }),
      );
    },
    { prefix: '/api/v1' },
  );
}
