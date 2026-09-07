import type { FastifyInstance } from 'fastify';
export async function registerRoutes(
  app: FastifyInstance,
  database: { check: () => Promise<void> },
) {
  app.get('/', async (_request, reply) =>
    reply.viewAsync('pages/home.ejs', {
      title: 'LOKKA — Indonesian heritage, everyday',
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
