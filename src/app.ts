import Fastify, { LogController } from 'fastify';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import formbody from '@fastify/formbody';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import view from '@fastify/view';
import ejs from 'ejs';
import { resolve } from 'node:path';
import type { AppEnv } from './config/env.js';
import { createDatabase } from './db/client.js';
import { registerRoutes } from './routes/index.js';
import multipart from '@fastify/multipart';
import { createCatalog } from './modules/catalog/service.js';
import { LocalCatalogImageStorage } from './modules/catalog/storage.js';
import { registerCatalog } from './modules/catalog/routes.js';
import { registerAdmin } from './modules/admin/routes.js';
import { renderAdminError } from './modules/admin/presentation.js';
import { registerCustomer } from './modules/customer/routes.js';
import { getAssets, resetAssets } from './config/assets.js';
import { orderedLocales } from './i18n/index.js';
import { t } from './i18n/translator.js';
import type { Database } from './db/client.js';
export async function buildApp(
  env: AppEnv,
  options: {
    database?: {
      check: () => Promise<void>;
      close: () => Promise<void>;
      db?: Database['db'];
    };
    logger?: boolean;
  } = {},
) {
  const app = Fastify({
    routerOptions: { maxParamLength: 200 },
    bodyLimit: 64 * 1024,
    trustProxy: env.trustProxy ? ['127.0.0.1', '::1'] : false,
    logController: new LogController({ disableRequestLogging: true }),
    logger:
      options.logger === false
        ? false
        : {
            level: env.logLevel,
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
            ],
            serializers: {
              err: () => ({
                type: 'Error',
                message: 'Internal error',
                stack: '',
              }),
            },
          },
  });
  const database = options.database ?? createDatabase(env.databaseUrl);
  app.addHook('onClose', async () => {
    await database.close();
  });
  try {
    await app.register(helmet, {
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: env.nodeEnv === 'production' ? [] : null,
        },
      },
      hsts: env.nodeEnv === 'production',
    });
    await app.register(sensible);
    await app.register(formbody);
    await app.register(cookie);
    await app.register(multipart, {
      limits: {
        fileSize: 10 * 1024 * 1024,
        files: 5,
        fields: 4,
        parts: 9,
        fieldSize: 2048,
      },
    });
    await app.register(rateLimit, {
      global: false,
      max: 60,
      timeWindow: '1 minute',
    });
    // ─── Static asset serving with proper cache strategy ────
    // Content-hashed assets get immutable cache; unversioned get no-store.
    await app.register(fastifyStatic, {
      root: resolve('public/build'),
      prefix: '/build/',
      dotfiles: 'deny',
      index: false,
      maxAge: env.nodeEnv === 'production' ? 31536000 : 0,
      immutable: env.nodeEnv === 'production',
      setHeaders: (reply: import('fastify').FastifyReply) => {
        if (env.nodeEnv !== 'production') {
          // Development: prevent ALL browser caching of built assets
          reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
          reply.header('Pragma', 'no-cache');
        }
      },
    });
    await app.register(view, {
      engine: { ejs },
      root: resolve('views'),
      layout: 'layouts/base.ejs',
      defaultContext: {
        admin: false,
        categories: [],
        description: 'LOKKA — Contemporary Indonesian fashion.',
        canonical: env.appUrl,
        ogImage: undefined,
        jsonLd: undefined,
        locale: 'en',
        locales: orderedLocales,
        htmlLang: 'en',
        alternateLinks: '',
        customer: null,
        noindex: false,
        languagePaths: undefined,
        t: (key: string) => key,
        assets: getAssets(),
      },
    });
    // A separate renderer leaves the public global layout/context untouched.
    await app.register(view, {
      engine: { ejs },
      root: resolve('views'),
      propertyName: 'adminView',
    });
    // ─── Official logo route (original PNG, not for web delivery) ───
    app.get('/images/lokka_logo.png', async (_request, reply) =>
      reply
        .header('Cache-Control', 'public, max-age=86400')
        .sendFile('lokka_logo.png', resolve('public/images')),
    );
    // ─── Optimized brand logo ───
    app.get('/images/brand/lokka-logo.webp', async (_request, reply) =>
      reply
        .header(
          'Cache-Control',
          env.nodeEnv === 'production'
            ? 'public, max-age=31536000, immutable'
            : 'public, max-age=3600',
        )
        .sendFile('lokka-logo.webp', resolve('public/images/brand')),
    );
    // ─── HTML cache headers ───
    app.addHook('onSend', async (_request, reply) => {
      const contentType = reply.getHeader('content-type');
      if (contentType && String(contentType).includes('text/html')) {
        if (env.nodeEnv !== 'production') {
          reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
        }
      }
    });
    app.setNotFoundHandler(async (request, reply) => {
      reply.code(404);
      if (
        request.url.split('?')[0] === '/admin' ||
        request.url.startsWith('/admin/')
      )
        return renderAdminError(
          reply,
          404,
          'The requested admin page could not be found.',
          request.internalAdmin,
          request.cookies.lokka_admin_csrf,
        );
      if (request.url.startsWith('/api/')) return { error: 'Not found' };
      const locale = request.url.startsWith('/id') ? 'id' : 'en';
      return reply.viewAsync('errors/error.ejs', {
        title: t(locale, 'error.notFound'),
        status: 404,
        message: t(locale, 'error.notFoundMessage'),
        locale,
        locales: orderedLocales,
        htmlLang: locale === 'id' ? 'id-ID' : 'en',
        t: (key: string) => t(locale, key),
      });
    });
    app.setErrorHandler(async (error, request, reply) => {
      const code =
        error instanceof Error && 'statusCode' in error
          ? error.statusCode
          : undefined;
      const status =
        typeof code === 'number' && code >= 400 && code < 500 ? code : 500;
      app.log.error({ requestId: request.id, status }, 'Request failed');
      const locale = request.url.startsWith('/id') ? 'id' : 'en';
      const message =
        status === 500
          ? t(locale, 'error.serverError')
          : status === 429
            ? t(locale, 'error.tooManyRequests')
            : t(locale, 'error.requestError');
      reply.code(status);
      if (
        request.url.split('?')[0] === '/admin' ||
        request.url.startsWith('/admin/')
      )
        return renderAdminError(
          reply,
          status,
          message,
          request.internalAdmin,
          request.cookies.lokka_admin_csrf,
        );
      if (
        request.url.startsWith('/api/') ||
        request.url === '/ready' ||
        request.url === '/health'
      )
        return { error: message };
      return reply.viewAsync('errors/error.ejs', {
        title: t(locale, 'error.notFound'),
        status,
        message,
        locale,
        locales: orderedLocales,
        htmlLang: locale === 'id' ? 'id-ID' : 'en',
        t: (key: string) => t(locale, key),
      });
    });
    const storage = new LocalCatalogImageStorage(env.catalogStorageRoot);
    const catalog = database.db
      ? createCatalog(database.db, storage)
      : undefined;
    // Reset asset cache after build
    resetAssets();
    if (database.db) await registerCustomer(app, database.db, env);
    await registerRoutes(app, database, catalog, env);
    if (catalog && database.db) {
      await registerCatalog(app, catalog, storage, env);
      await registerAdmin(app, database.db, catalog, env, storage);
    }
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
