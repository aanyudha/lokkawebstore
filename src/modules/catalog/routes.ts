import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Catalog } from './service.js';
import type { AppEnv } from '../../config/env.js';
import type { CatalogImageStorage, ImageSize } from './storage.js';
import { formatIdr } from './validation.js';
import { locales, orderedLocales, type LocaleCode } from '../../i18n/index.js';
import { t } from '../../i18n/translator.js';

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
  async function getLocalizedCategories(locale: string) {
    const cats = await catalog.categoryListLocale(locale);
    return cats.map((c) => ({
      id: c.category.id,
      parentId: c.category.parentId,
      status: c.category.status,
      sortOrder: c.category.sortOrder,
      name: c.translation.name,
      slug: c.translation.slug,
      shortDescription: c.translation.shortDescription,
      seoTitle: c.translation.seoTitle,
      seoDescription: c.translation.seoDescription,
    }));
  }

  // ─── English collection routes (no prefix) ────────────────
  app.get('/collections', async (request, reply) =>
    listHandler(request, reply, 'en'),
  );
  app.get('/category/:slug', async (request, reply) =>
    listHandler(request, reply, 'en'),
  );

  // ─── Indonesian collection routes (with /id prefix) ───────
  app.get('/id/koleksi', async (request, reply) =>
    listHandler(request, reply, 'id'),
  );
  app.get('/id/kategori/:slug', async (request, reply) =>
    listHandler(request, reply, 'id'),
  );

  // ─── English product route ─────────────────────────────────
  app.get('/product/:slug', async (request, reply) =>
    productHandler(request, reply, 'en'),
  );

  // ─── Indonesian product route ──────────────────────────────
  app.get('/id/produk/:slug', async (request, reply) =>
    productHandler(request, reply, 'id'),
  );

  // Note: Redirects for old unprefixed Indonesian routes (/koleksi, /kategori/:slug, /produk/:slug)
  // are registered in the main routes (src/routes/index.ts) so they work without a database.

  // ─── List handler (shared) ─────────────────────────────────
  async function listHandler(
    request: FastifyRequest,
    reply: FastifyReply,
    locale: LocaleCode,
  ) {
    const { page: pageValue } = request.query as { page?: string };
    const { slug } = request.params as { slug?: string };
    const pv = pageValue ?? '1';
    if (!/^[1-9]\d{0,5}$/.test(pv))
      return reply.code(400).send('Invalid page.');
    const page = Number(pv);
    const categories = await getLocalizedCategories(locale);
    const category = slug ? categories.find((c) => c.slug === slug) : undefined;
    if (slug && !category) return reply.callNotFound();

    const data = await catalog.publicListLocale(page, locale, category?.id);
    if (page > 1 && (page - 1) * 24 >= data.total) return reply.callNotFound();

    const collectionPath = locale === 'id' ? '/id/koleksi' : '/collections';
    const categoryPath = slug
      ? `${locale === 'id' ? '/id/kategori' : '/category'}/${slug}`
      : collectionPath;
    const languagePaths: Record<string, string> = {};
    for (const loc of orderedLocales) {
      const translated = category
        ? await catalog.categoryTranslationFor(category.id, loc.code)
        : null;
      languagePaths[loc.code] = translated
        ? `${loc.code === 'id' ? '/id/kategori' : '/category'}/${translated.slug}`
        : loc.code === 'id'
          ? '/id/koleksi'
          : '/collections';
    }

    const titlePrefix =
      category?.seoTitle || category?.name || t(locale, 'catalog.title');
    const pageTitle = `${titlePrefix}${page > 1 ? ` — ${t(locale, 'pagination.page', { page })}` : ''} | LOKKA`;
    const description =
      category?.seoDescription ||
      category?.shortDescription ||
      t(locale, 'catalog.title');
    const canonical = new URL(
      categoryPath + (page > 1 ? `?page=${page}` : ''),
      env.appUrl,
    ).href;

    const alternateLinks = orderedLocales
      .map((loc) => {
        const locPrefix = loc.pathPrefix;
        let locPath: string;
        if (slug && category) {
          locPath = languagePaths[loc.code]!;
        } else {
          locPath = loc.code === 'id' ? `${locPrefix}/koleksi` : '/collections';
        }
        if (page > 1) locPath += `?page=${page}`;
        return `<link rel="alternate" hreflang="${loc.htmlLang}" href="${new URL(locPath, env.appUrl).href}" />`;
      })
      .filter(Boolean)
      .join('\n    ');

    return reply.viewAsync('pages/collection.ejs', {
      title: pageTitle,
      description,
      canonical,
      categories,
      category,
      page,
      path: categoryPath,
      ...data,
      formatIdr: (value: bigint) => formatIdr(value, locale),
      storage,
      locale,
      locales: orderedLocales,
      t: (key: string, interp?: Record<string, string | number>) =>
        t(locale, key, interp),
      alternateLinks,
      htmlLang: locales[locale].htmlLang,
      collectionPath,
      languagePaths,
    });
  }

  // ─── Product handler (shared) ──────────────────────────────
  async function productHandler(
    request: FastifyRequest,
    reply: FastifyReply,
    locale: LocaleCode,
  ) {
    const { slug } = request.params as { slug: string };
    const data = await catalog.localizedProduct(locale, slug);
    if (!data) return reply.callNotFound();

    const categories = await getLocalizedCategories(locale);
    const category = categories.find((c) => c.id === data.product.categoryId);

    const canonical = new URL(
      `${locale === 'id' ? '/id/produk' : '/product'}/${data.translation.slug}`,
      env.appUrl,
    ).href;

    const schema = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: data.translation.name,
      description:
        data.translation.description ||
        data.translation.shortDescription ||
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

    const translations = await catalog.productTranslationsList(data.product.id);
    const languagePaths: Record<string, string> = {};
    for (const loc of orderedLocales) {
      const translation = translations.find((row) => row.locale === loc.code);
      languagePaths[loc.code] = translation
        ? `${loc.code === 'id' ? '/id/produk' : '/product'}/${translation.slug}`
        : loc.pathPrefix || '/';
    }
    const alternateLinks = orderedLocales
      .map((loc) => {
        const translation = translations.find((row) => row.locale === loc.code);
        if (!translation) return '';
        const locPath = `${loc.code === 'id' ? '/id/produk' : '/product'}/${translation.slug}`;
        return `<link rel="alternate" hreflang="${loc.htmlLang}" href="${new URL(locPath, env.appUrl).href}" />`;
      })
      .join('\n    ');

    return reply.viewAsync('pages/product.ejs', {
      product: {
        ...data.product,
        name: data.translation.name,
        description: data.translation.description,
        shortDescription: data.translation.shortDescription,
        seoTitle: data.translation.seoTitle,
        seoDescription: data.translation.seoDescription,
      },
      translation: data.translation,
      variants: data.variants,
      images: data.images,
      categories,
      category,
      title: `${data.translation.seoTitle || data.translation.name} | LOKKA`,
      description:
        data.translation.seoDescription ||
        data.translation.shortDescription ||
        data.translation.name,
      canonical,
      ogImage: data.images[0]
        ? new URL(storage.url(data.images[0].storageKey, 'detail'), env.appUrl)
            .href
        : undefined,
      jsonLd,
      storage,
      formatIdr: (value: bigint) => formatIdr(value, locale),
      locale,
      locales: orderedLocales,
      t: (key: string, interp?: Record<string, string | number>) =>
        t(locale, key, interp),
      alternateLinks,
      htmlLang: locales[locale].htmlLang,
      languagePaths,
    });
  }

  // ─── Sitemap (localized) ──────────────────────────────────
  app.get('/sitemap.xml', async (_request, reply) => {
    const [categories, products] = await Promise.all([
      catalog.categoryList(),
      catalog.adminProducts(),
    ]);

    const urls: string[] = [];

    for (const loc of orderedLocales) {
      const homePath = loc.pathPrefix || '/';
      urls.push(
        `<url><loc>${xml(new URL(homePath, env.appUrl).href)}</loc></url>`,
      );
    }

    for (const cat of categories.filter((c) => c.status === 'active')) {
      for (const loc of orderedLocales) {
        const catTrans = await catalog.categoryTranslationFor(cat.id, loc.code);
        if (catTrans) {
          const catPath =
            loc.code === 'id'
              ? `/id/kategori/${catTrans.slug}`
              : `/category/${catTrans.slug}`;
          urls.push(
            `<url><loc>${xml(new URL(catPath, env.appUrl).href)}</loc></url>`,
          );
        }
      }
    }

    for (const p of products.filter((p) => p.status === 'active')) {
      for (const loc of orderedLocales) {
        const prodTrans = await catalog.productTranslationFor(p.id, loc.code);
        if (prodTrans) {
          const prodPath =
            loc.code === 'id'
              ? `/id/produk/${prodTrans.slug}`
              : `/product/${prodTrans.slug}`;
          urls.push(
            `<url><loc>${xml(new URL(prodPath, env.appUrl).href)}</loc></url>`,
          );
        }
      }
    }

    return reply
      .type('application/xml')
      .send(
        `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`,
      );
  });

  // ─── Robots ────────────────────────────────────────────────
  app.get('/robots.txt', async (_request, reply) =>
    reply
      .type('text/plain')
      .send(
        `User-agent: *\nDisallow: /admin\nDisallow: /account\nDisallow: /id/akun\nSitemap: ${new URL('/sitemap.xml', env.appUrl).href}\n`,
      ),
  );

  // ─── Media ─────────────────────────────────────────────────
  app.get('/media/catalog/:key/:size', async (request, reply) => {
    const { key, size: rawSize } = request.params as {
      key: string;
      size: string;
    };
    const size = rawSize.replace(/\.webp$/, '') as ImageSize;
    if (!/^(thumb|card|detail)\.webp$/.test(rawSize))
      return reply.callNotFound();
    const image = await catalog.publicImage(key);
    if (!image) return reply.callNotFound();
    try {
      return reply
        .type('image/webp')
        .header('Cache-Control', 'public, max-age=300')
        .send(await storage.read(image.storageKey, size));
    } catch {
      return reply.callNotFound();
    }
  });
}
