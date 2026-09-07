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
          imgSrc: ["'self'"],
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
    await app.register(fastifyStatic, {
      root: resolve('public/build'),
      prefix: '/build/',
      dotfiles: 'deny',
      index: false,
      maxAge: 0,
    });
    await app.register(view, {
      engine: { ejs },
      root: resolve('views'),
      layout: 'layouts/base.ejs',
      defaultContext: {
        admin: false,
        categories: [],
        description: 'LOKKA — busana dan batik Indonesia.',
        canonical: env.appUrl,
        ogImage: undefined,
        jsonLd: undefined,
      },
    });
    app.get('/images/lokka_logo.png', async (_request, reply) =>
      reply
        .header('Cache-Control', 'public, max-age=86400')
        .sendFile('lokka_logo.png', resolve('public/images')),
    );
    app.setNotFoundHandler(async (request, reply) => {
      reply.code(404);
      if (request.url.startsWith('/api/')) return { error: 'Not found' };
      return reply.viewAsync('errors/error.ejs', {
        title: 'Page not found',
        status: 404,
        message: 'The page you are looking for could not be found.',
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
      const message =
        status === 500
          ? 'Something went wrong. Please try again later.'
          : status === 429
            ? 'Too many requests. Please try again later.'
            : 'The request could not be processed.';
      reply.code(status);
      if (
        request.url.startsWith('/api/') ||
        request.url === '/ready' ||
        request.url === '/health'
      )
        return { error: message };
      return reply.viewAsync('errors/error.ejs', {
        title: 'Request error',
        status,
        message,
      });
    });
    const storage = new LocalCatalogImageStorage(env.catalogStorageRoot);
    const catalog = database.db
      ? createCatalog(database.db, storage)
      : undefined;
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
