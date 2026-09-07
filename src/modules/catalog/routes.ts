import type { FastifyInstance } from 'fastify';
import type { Catalog } from './service.js';
import type { AppEnv } from '../../config/env.js';
import type { CatalogImageStorage, ImageSize } from './storage.js';
import { formatIdr } from './validation.js';
const xml = (value: string) =>
  value.replace(
    /[<>&"']/g,
    (ch) =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&apos;',
      })[ch]!,
  );
export async function registerCatalog(
  app: FastifyInstance,
  catalog: Catalog,
  storage: CatalogImageStorage,
  env: AppEnv,
) {
  app.get<{ Querystring: { page?: string }; Params: { slug?: string } }>(
    '/koleksi',
    list,
  );
  app.get<{ Querystring: { page?: string }; Params: { slug?: string } }>(
    '/kategori/:slug',
    list,
  );
  async function list(
    request: { query: { page?: string }; params: { slug?: string } },
    reply: import('fastify').FastifyReply,
  ) {
    const pageValue = request.query.page ?? '1';
    if (!/^[1-9]\d{0,5}$/.test(pageValue))
      return reply.code(400).send('Halaman tidak valid.');
    const page = Number(pageValue);
    const categories = (await catalog.categoryList()).filter(
      (c) => c.status === 'active',
    );
    const category = request.params.slug
      ? categories.find((c) => c.slug === request.params.slug)
      : undefined;
    if (request.params.slug && !category) return reply.callNotFound();
    const data = await catalog.publicList(page, category?.id);
    if (page > 1 && (page - 1) * 24 >= data.total) return reply.callNotFound();
    const path = category ? `/kategori/${category.slug}` : '/koleksi';
    return reply.viewAsync('pages/collection.ejs', {
      title: `${category?.seoTitle || category?.name || 'Koleksi'}${page > 1 ? ` — Halaman ${page}` : ''} | LOKKA`,
      description:
        category?.seoDescription ||
        category?.shortDescription ||
        'Temukan koleksi busana dan batik LOKKA.',
      canonical: new URL(path + (page > 1 ? `?page=${page}` : ''), env.appUrl)
        .href,
      categories,
      category,
      page,
      path,
      ...data,
      formatIdr,
      storage,
    });
  }
  app.get<{ Params: { slug: string } }>(
    '/produk/:slug',
    async (request, reply) => {
      const data = await catalog.publicProduct(request.params.slug);
      if (!data) return reply.callNotFound();
      const categories = (await catalog.categoryList()).filter(
        (c) => c.status === 'active',
      );
      const category = categories.find((c) => c.id === data.product.categoryId);
      const canonical = new URL(`/produk/${data.product.slug}`, env.appUrl)
        .href;
      const schema = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: data.product.name,
        description:
          data.product.description ||
          data.product.shortDescription ||
          undefined,
        image: data.images.map(
          (i) => new URL(storage.url(i.storageKey, 'detail'), env.appUrl).href,
        ),
        brand: { '@type': 'Brand', name: 'LOKKA' },
        sku: data.variants[0]?.sku,
        offers: data.variants.map((v) => ({
          '@type': 'Offer',
          priceCurrency: 'IDR',
          price: v.price.toString(),
          sku: v.sku,
          availability: `https://schema.org/${v.stockQuantity > 0 ? 'InStock' : 'OutOfStock'}`,
          url: canonical,
        })),
      };
      const jsonLd = JSON.stringify(schema)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026');
      return reply.viewAsync('pages/product.ejs', {
        ...data,
        categories,
        category,
        title: `${data.product.seoTitle || data.product.name} | LOKKA`,
        description:
          data.product.seoDescription ||
          data.product.shortDescription ||
          data.product.name,
        canonical,
        ogImage: data.images[0]
          ? new URL(
              storage.url(data.images[0].storageKey, 'detail'),
              env.appUrl,
            ).href
          : undefined,
        jsonLd,
        storage,
        formatIdr,
      });
    },
  );
  app.get('/sitemap.xml', async (_request, reply) => {
    const [categories, products] = await Promise.all([
      catalog.categoryList(),
      catalog.adminProducts(),
    ]);
    const paths = [
      '/',
      '/koleksi',
      ...categories
        .filter((c) => c.status === 'active')
        .map((c) => `/kategori/${c.slug}`),
      ...products
        .filter((p) => p.status === 'active')
        .map((p) => `/produk/${p.slug}`),
    ];
    return reply
      .type('application/xml')
      .send(
        `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<url><loc>${xml(new URL(path, env.appUrl).href)}</loc></url>`).join('')}</urlset>`,
      );
  });
  app.get('/robots.txt', async (_request, reply) =>
    reply
      .type('text/plain')
      .send(
        `User-agent: *\nDisallow: /admin\nSitemap: ${new URL('/sitemap.xml', env.appUrl).href}\n`,
      ),
  );
  app.get<{ Params: { key: string; size: string } }>(
    '/media/catalog/:key/:size',
    async (request, reply) => {
      const size = request.params.size.replace(/\.webp$/, '') as ImageSize;
      if (!/^(thumb|card|detail)\.webp$/.test(request.params.size))
        return reply.callNotFound();
      // Do not expose draft media through predictable static paths; authorize against catalog state.
      const image = await catalog.publicImage(request.params.key);
      if (!image) return reply.callNotFound();
      try {
        return reply
          .type('image/webp')
          .header('Cache-Control', 'public, max-age=300')
          .send(await storage.read(image.storageKey, size));
      } catch {
        return reply.callNotFound();
      }
    },
  );
}
