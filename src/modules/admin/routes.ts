import { createCatalogOperations } from '../catalog/operations.js';
import {
  listInput,
  listingQuery,
  type BulkResult,
} from '../catalog/listing.js';
import { readinessBadges } from '../catalog/sellability.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { products, productImages } from '../../db/schema/index.js';
import type { AppEnv } from '../../config/env.js';
import { createAuth, hashToken, token, tokenMatches } from '../auth/service.js';
import type { Catalog } from '../catalog/service.js';
import { FormError, type Form, textField, id } from '../catalog/validation.js';
import type { CatalogImageStorage, ImageSize } from '../catalog/storage.js';
import { createFinance } from '../finance/service.js';
import { createLedger } from '../finance/ledger.js';
import { createAccounting } from '../finance/accounting.js';
import { createFulfillment } from '../shipping/service.js';
import { registerCommercialAdmin } from './commercial-routes.js';
import { registerFulfillmentAdmin } from './fulfillment-routes.js';
import { registerInvestorAdmin } from './investor-routes.js';
import { registerFinanceAdmin } from './finance-routes.js';
import { renderAdmin, renderAdminError } from './presentation.js';
import { registerHomepageAdmin } from './homepage-routes.js';
import type { HomepageHero } from '../storefront/hero.js';
const body = (request: FastifyRequest) => (request.body ?? {}) as Form;
export async function registerAdmin(
  app: FastifyInstance,
  db: Database['db'],
  catalog: Catalog,
  env: AppEnv,
  storage: CatalogImageStorage,
  hero: HomepageHero,
) {
  const auth = createAuth(db);
  const operations = createCatalogOperations(db, storage);
  const cookies = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.nodeEnv === 'production',
    path: '/admin',
  };
  const render = renderAdmin;
  await app.register(
    async (admin) => {
      admin.addHook('onRequest', async (_request, reply) => {
        reply.header('X-Robots-Tag', 'noindex, nofollow');
        reply.header('Cache-Control', 'no-store');
      });
      admin.get('/login', async (_request, reply) => {
        const loginCsrf = token();
        reply.setCookie('lokka_login_csrf', loginCsrf, {
          ...cookies,
          maxAge: 600,
        });
        return render(reply, 'login', { loginCsrf });
      });
      admin.post(
        '/login',
        { config: { rateLimit: { max: 8, timeWindow: '15 minutes' } } },
        async (request, reply) => {
          const form = body(request);
          const loginCsrf = request.cookies.lokka_login_csrf ?? '';
          if (!loginCsrf || !tokenMatches(form.csrf, hashToken(loginCsrf)))
            return renderAdminError(
              reply,
              403,
              'Form expired. Reload the login page.',
              request.internalAdmin,
              request.cookies.lokka_admin_csrf,
            );
          try {
            if (
              typeof form.password !== 'string' ||
              !form.password ||
              form.password.length > 128
            )
              throw new FormError('password', 'Invalid password.');
            const result = await auth.login(
              textField(form, 'email', 254, true),
              form.password,
              request.ip,
              request.headers['user-agent'] ?? '',
              request.cookies.lokka_admin,
            );
            if (!result)
              return render(reply.code(401), 'login', {
                loginCsrf,
                error: {
                  field: 'email',
                  message: 'Invalid email or password.',
                },
                values: { email: form.email },
              });
            reply.setCookie('lokka_admin', result.sessionToken, {
              ...cookies,
              expires: result.expiresAt,
            });
            reply.setCookie('lokka_admin_csrf', result.csrf, {
              ...cookies,
              expires: result.expiresAt,
            });
            reply.clearCookie('lokka_login_csrf', cookies);
            return reply.redirect('/admin', 303);
          } catch (error) {
            if (!(error instanceof FormError)) throw error;
            return render(reply.code(422), 'login', {
              loginCsrf,
              error,
              values: { email: form.email },
            });
          }
        },
      );
      await admin.register(async (protectedRoutes) => {
        protectedRoutes.addHook('onRequest', async (request, reply) => {
          const session = await auth.session(request.cookies.lokka_admin);
          if (!session) return reply.redirect('/admin/login', 303);
          const csrf = request.cookies.lokka_admin_csrf;
          if (!tokenMatches(csrf, session.session.csrfTokenHash))
            return renderAdminError(
              reply,
              403,
              'Session invalid. Sign in again.',
            );
          request.internalAdmin = session.user;
        });
        protectedRoutes.addHook('preHandler', async (request, reply) => {
          if (
            request.isMultipart() &&
            ![
              '/admin/products/:id/images',
              '/admin/settings/homepage',
            ].includes(request.routeOptions.url ?? '')
          )
            return renderAdminError(
              reply,
              403,
              'Multipart is only accepted for image uploads.',
              request.internalAdmin,
              request.cookies.lokka_admin_csrf,
            );
          if (
            !['GET', 'HEAD'].includes(request.method) &&
            !request.isMultipart()
          ) {
            if (
              !tokenMatches(
                body(request).csrf,
                hashToken(request.cookies.lokka_admin_csrf ?? ''),
              )
            )
              return renderAdminError(
                reply,
                403,
                'CSRF token invalid.',
                request.internalAdmin,
                request.cookies.lokka_admin_csrf,
              );
          }
        });
        const page = (
          request: FastifyRequest,
          reply: FastifyReply,
          name: string,
          data: Record<string, unknown> = {},
        ) =>
          render(reply, name, {
            csrf: request.cookies.lokka_admin_csrf,
            principal: request.internalAdmin,
            ...data,
          });
        registerHomepageAdmin(protectedRoutes, hero, page);
        registerFulfillmentAdmin(protectedRoutes, db, page);
        registerInvestorAdmin(protectedRoutes, db, page);
        registerCommercialAdmin(
          protectedRoutes,
          createFinance(db, catalog),
          createFulfillment(db, catalog),
          page,
        );
        registerFinanceAdmin(
          protectedRoutes,
          createLedger(db),
          page,
          createAccounting(db),
        );
        protectedRoutes.get<{ Params: { id: string; imageId: string } }>(
          '/products/:id/images/:imageId/preview',
          async (request, reply) => {
            await catalog.product(request.params.id);
            const related = await catalog.relations([request.params.id]);
            const image = related.images.find(
              (i) => i.id === request.params.imageId,
            );
            if (!image) return reply.callNotFound();
            return reply
              .type('image/webp')
              .send(await storage.read(image.storageKey, 'thumb' as ImageSize));
          },
        );
        protectedRoutes.post('/logout', async (request, reply) => {
          await auth.logout(request.cookies.lokka_admin!);
          reply
            .clearCookie('lokka_admin', cookies)
            .clearCookie('lokka_admin_csrf', cookies);
          return reply.redirect('/admin/login', 303);
        });
        protectedRoutes.get('', async (request, reply) => {
          return page(request, reply, 'dashboard', {
            metrics: await operations.metrics(env.lowStockThreshold),
          });
        });
        protectedRoutes.get('/categories', async (request, reply) =>
          page(request, reply, 'categories', {
            categories: await catalog.categoryList(),
          }),
        );
        protectedRoutes.get('/categories/new', async (request, reply) =>
          page(request, reply, 'category-form', {
            categories: await catalog.categoryList(),
            values: { status: 'hidden', sortOrder: 0 },
          }),
        );
        protectedRoutes.get<{ Params: { id: string } }>(
          '/categories/:id/edit',
          async (request, reply) => {
            const categories = await catalog.categoryList();
            const category = categories.find(
              (c) => c.id === id(request.params.id),
            );
            if (!category) return reply.callNotFound();
            return page(request, reply, 'category-form', {
              categories,
              values: category,
            });
          },
        );
        for (const route of ['/categories', '/categories/:id'])
          protectedRoutes.post<{ Params: { id?: string } }>(
            route,
            async (request, reply) => {
              try {
                await catalog.saveCategory(body(request), request.params.id);
                return reply.redirect('/admin/categories', 303);
              } catch (error) {
                if (!(error instanceof FormError)) throw error;
                return page(request, reply.code(422), 'category-form', {
                  categories: await catalog.categoryList(),
                  values: { ...body(request), id: request.params.id },
                  error,
                });
              }
            },
          );
        const renderProducts = async (
          request: FastifyRequest,
          reply: FastifyReply,
          error: FormError | null = null,
          bulkResult: BulkResult | null = null,
        ) => {
          const data = await operations.productList(
            request.query as Record<string, unknown>,
          );
          return page(request, reply, 'products', {
            ...data,
            error,
            bulkResult,
            listQuery: listingQuery(data.listing),
          });
        };
        protectedRoutes.get('/products', renderProducts);
        protectedRoutes.post('/products/bulk', async (r, reply) => {
          try {
            listInput(r.query as Record<string, unknown>);
            return renderProducts(
              r,
              reply,
              null,
              await operations.bulkProducts(body(r)),
            );
          } catch (error) {
            if (!(error instanceof FormError)) throw error;
            return renderProducts(r, reply.code(422), error);
          }
        });
        protectedRoutes.get('/products/new', async (request, reply) =>
          page(request, reply, 'product-form', {
            categories: await catalog.categoryList(),
            values: { status: 'draft' },
            variants: [],
            images: [],
            readiness: [],
          }),
        );
        const productPage = async (
          request: FastifyRequest,
          reply: FastifyReply,
          productId: string,
          values?: Form,
          error?: FormError,
          variantValues?: Form,
        ) => {
          const product = await catalog.product(productId);
          const related = await catalog.relations([productId]);
          return page(request, reply, 'product-form', {
            categories: await catalog.categoryList(),
            values: values ?? product,
            ...related,
            readiness: readinessBadges(product, related.variants),
            error,
            variantValues,
          });
        };
        protectedRoutes.get<{ Params: { id: string } }>(
          '/products/:id/edit',
          async (request, reply) =>
            productPage(request, reply, request.params.id),
        );
        for (const route of ['/products', '/products/:id'])
          protectedRoutes.post<{ Params: { id?: string } }>(
            route,
            async (request, reply) => {
              try {
                const product = await catalog.saveProduct(
                  body(request),
                  request.params.id,
                );
                return reply.redirect(
                  `/admin/products/${product.id}/edit`,
                  303,
                );
              } catch (error) {
                if (!(error instanceof FormError)) throw error;
                if (request.params.id)
                  return productPage(
                    request,
                    reply.code(422),
                    request.params.id,
                    { ...body(request), id: request.params.id },
                    error,
                  );
                return page(request, reply.code(422), 'product-form', {
                  categories: await catalog.categoryList(),
                  values: body(request),
                  error,
                  variants: [],
                  images: [],
                  readiness: [],
                });
              }
            },
          );
        protectedRoutes.post<{ Params: { id: string } }>(
          '/products/:id/archive',
          async (request, reply) => {
            await catalog.archive(request.params.id);
            return reply.redirect('/admin/products', 303);
          },
        );
        for (const route of [
          '/products/:id/variants',
          '/products/:id/variants/:variantId',
        ])
          protectedRoutes.post<{ Params: { id: string; variantId?: string } }>(
            route,
            async (request, reply) => {
              try {
                await catalog.saveVariant(
                  request.params.id,
                  body(request),
                  request.params.variantId,
                );
                return reply.redirect(
                  `/admin/products/${request.params.id}/edit#variants`,
                  303,
                );
              } catch (error) {
                if (!(error instanceof FormError)) throw error;
                return productPage(
                  request,
                  reply.code(422),
                  request.params.id,
                  undefined,
                  error,
                  { ...body(request), id: request.params.variantId },
                );
              }
            },
          );
        const renderInventory = async (
          request: FastifyRequest,
          reply: FastifyReply,
          error: FormError | null = null,
          bulkResult: BulkResult | null = null,
          values: Form = {},
        ) => {
          const data = await operations.inventoryList(
            request.query as Record<string, unknown>,
          );
          return page(request, reply, 'inventory', {
            ...data,
            error,
            bulkResult,
            values,
            threshold: env.lowStockThreshold,
            listQuery: listingQuery(data.listing, data.stockFilter),
          });
        };
        protectedRoutes.get('/inventory', renderInventory);
        protectedRoutes.post('/inventory/bulk', async (r, reply) => {
          try {
            const q = r.query as Record<string, unknown>;
            listInput(q);
            if (
              q.stock !== undefined &&
              !(['', 'unknown', 'in', 'out'] as unknown[]).includes(q.stock)
            )
              throw new FormError('stock', 'Choose a valid stock filter.');
            return renderInventory(
              r,
              reply,
              null,
              await operations.bulkInventory(body(r)),
            );
          } catch (error) {
            if (!(error instanceof FormError)) throw error;
            return renderInventory(r, reply.code(422), error);
          }
        });
        protectedRoutes.post<{ Params: { id: string; variantId: string } }>(
          '/products/:id/variants/:variantId/stock',
          async (request, reply) => {
            try {
              const input = listInput(request.query as Record<string, unknown>);
              await catalog.stock(
                request.params.id,
                request.params.variantId,
                body(request),
              );
              const filter = (request.query as { stock?: string }).stock ?? '';
              return reply.redirect(
                '/admin/inventory' + listingQuery(input, filter),
                303,
              );
            } catch (error) {
              if (!(error instanceof FormError)) throw error;
              return renderInventory(request, reply.code(422), error, null, {
                ...body(request),
                id: request.params.variantId,
              });
            }
          },
        );
        protectedRoutes.get('/media', async (request, reply) => {
          const data = await operations.productList(
            request.query as Record<string, unknown>,
            '/admin/media',
          );
          return page(request, reply, 'media', {
            ...data,
            ...(await catalog.relations(data.products.map((p) => p.id))),
          });
        });
        protectedRoutes.get<{ Params: { imageId: string } }>(
          '/media/:imageId/source',
          async (request, reply) => {
            const imageIdVal = id(request.params.imageId);
            const [row] = await db
              .select({
                image: productImages,
                product: products,
              })
              .from(productImages)
              .innerJoin(products, eq(products.id, productImages.productId))
              .where(eq(productImages.id, imageIdVal))
              .limit(1);
            if (!row || !row.image.sourceStorageKey || !row.image.sourceFormat)
              return reply.callNotFound();
            const ext =
              row.image.sourceFormat === 'jpeg'
                ? 'jpg'
                : row.image.sourceFormat === 'png'
                  ? 'png'
                  : row.image.sourceFormat === 'webp'
                    ? 'webp'
                    : null;
            if (!ext) return reply.callNotFound();
            const source = await storage.readSource(row.image.sourceStorageKey);
            if (!source) return reply.callNotFound();
            const mime =
              row.image.sourceMimeType ??
              `image/${ext === 'jpg' ? 'jpeg' : ext}`;
            const safeName = `${row.product.slug || 'product'}-${row.image.sourceFormat}.${ext}`;
            return reply
              .header('Content-Type', mime)
              .header(
                'Content-Disposition',
                `attachment; filename="${safeName}"`,
              )
              .send(source);
          },
        );
        protectedRoutes.post<{ Params: { id: string } }>(
          '/products/:id/images',
          {
            bodyLimit: 51 * 1024 * 1024,
            config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
          },
          async (request, reply) => {
            try {
              if (!request.isMultipart())
                throw new FormError('images', 'Use the upload form.');
              const inputs: Buffer[] = [];
              let verified = false;
              let altText = '';
              for await (const part of request.parts()) {
                if (!verified) {
                  if (
                    part.type !== 'field' ||
                    part.fieldname !== 'csrf' ||
                    !tokenMatches(
                      part.value,
                      hashToken(request.cookies.lokka_admin_csrf!),
                    )
                  )
                    return renderAdminError(
                      reply,
                      403,
                      'CSRF token invalid.',
                      request.internalAdmin,
                      request.cookies.lokka_admin_csrf,
                    );
                  verified = true;
                  continue;
                }
                if (part.type === 'file') {
                  if (part.filename) inputs.push(await part.toBuffer());
                  else part.file.resume();
                } else if (part.fieldname === 'altText')
                  altText = textField({ altText: part.value }, 'altText', 300);
              }
              if (!verified || !inputs.length)
                throw new FormError('images', 'Select at least one image.');
              await catalog.addImages(request.params.id, inputs, altText);
              return reply.redirect(
                `/admin/products/${request.params.id}/edit#images`,
                303,
              );
            } catch (error) {
              const friendly =
                error instanceof FormError
                  ? error
                  : new FormError(
                      'images',
                      'Upload failed. Maximum 5 images, 10 MB per image.',
                    );
              return productPage(
                request,
                reply.code(422),
                request.params.id,
                undefined,
                friendly,
              );
            }
          },
        );
        for (const suffix of ['', '/delete'])
          protectedRoutes.post<{ Params: { id: string; imageId: string } }>(
            `/products/:id/images/:imageId${suffix}`,
            async (request, reply) => {
              try {
                await catalog.editImage(
                  request.params.id,
                  request.params.imageId,
                  body(request),
                  suffix === '/delete',
                );
                return reply.redirect(
                  `/admin/products/${request.params.id}/edit#images`,
                  303,
                );
              } catch (error) {
                if (!(error instanceof FormError)) throw error;
                return productPage(
                  request,
                  reply.code(422),
                  request.params.id,
                  undefined,
                  error,
                );
              }
            },
          );
      });
    },
    { prefix: '/admin' },
  );
}
