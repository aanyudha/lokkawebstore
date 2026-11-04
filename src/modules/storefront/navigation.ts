import type { FastifyInstance } from 'fastify';
import type { Catalog } from '../catalog/service.js';

// Keep header data independent of page-specific category lists and filters.
export function registerStorefrontNavigation(
  app: FastifyInstance,
  catalog: Catalog,
) {
  app.addHook('onSend', async (_request, reply, payload) => {
    if (
      reply.locals?.customer &&
      String(reply.getHeader('content-type')).startsWith('text/html')
    )
      reply.header('Cache-Control', 'private, no-store');
    return payload;
  });
  app.addHook('preHandler', async (request, reply) => {
    const path = request.url.split('?')[0]!;
    if (
      !['GET', 'HEAD', 'POST'].includes(request.method) ||
      !/^\/(?:id\/?|(?:id\/)?(?:collections|koleksi|category|kategori|product|produk|account|akun|cart|keranjang)(?:\/[^?]*)?)?$/.test(
        path,
      )
    )
      return;
    const locale = path === '/id' || path.startsWith('/id/') ? 'id' : 'en';
    const categories = await catalog.categoryListLocale(locale);
    reply.locals = Object.assign({}, reply.locals, {
      navigationCategories: categories
        .filter(({ category }) => !category.parentId)
        .map(({ translation }) => ({
          name: translation.name,
          slug: translation.slug,
        })),
    });
  });
}
