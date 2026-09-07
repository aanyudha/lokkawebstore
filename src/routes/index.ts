import type { FastifyInstance } from 'fastify';
import type { Catalog } from '../modules/catalog/service.js';
import type { AppEnv } from '../config/env.js';
export async function registerRoutes(
  app: FastifyInstance,
  database: { check: () => Promise<void> },
  catalog?: Catalog,
  env?: AppEnv,
) {
  app.get('/', async (_request, reply) =>
    reply.viewAsync('pages/home.ejs', {
      title: 'LOKKA — Warisan dalam keseharian',
      categories: catalog
        ? (await catalog.categoryList()).filter((c) => c.status === 'active')
        : [],
      canonical: env?.appUrl,
    }),
  );
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
