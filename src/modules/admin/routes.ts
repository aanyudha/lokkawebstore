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
import { registerFinanceAdmin } from './finance-routes.js';
import { renderAdmin, renderAdminError } from './presentation.js';
const body = (request: FastifyRequest) => (request.body ?? {}) as Form;
export async function registerAdmin(
  app: FastifyInstance,
  db: Database['db'],
  catalog: Catalog,
  env: AppEnv,
  storage: CatalogImageStorage,
) {
  const auth = createAuth(db);
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
          // Multipart CSRF is validated from the first part before processing any file.
          if (
            !['GET', 'HEAD'].includes(request.method) &&
            request.headers.origin
          ) {
            const origin = request.headers.origin;
            const allowed = new URL(env.appUrl).origin;
            let originOk = origin === allowed;
            // Development loopback alias: accept localhost ↔ 127.0.0.1
            if (!originOk && env.nodeEnv !== 'production') {
              try {
                const cfg = new URL(env.appUrl);
                const alias =
                  cfg.hostname === 'localhost'
                    ? `http://127.0.0.1:${cfg.port}`
                    : cfg.hostname === '127.0.0.1'
                      ? `http://localhost:${cfg.port}`
                      : '';
                if (alias && origin === alias) originOk = true;
              } catch {
                // invalid APP_URL — strict check above will fail
              }
            }
            if (!originOk)
              return renderAdminError(
                reply,
                403,
                'Invalid origin.',
                request.internalAdmin,
                request.cookies.lokka_admin_csrf,
              );
          }
        });
        protectedRoutes.addHook('preHandler', async (request, reply) => {
          if (
            request.isMultipart() &&
            request.routeOptions.url !== '/admin/products/:id/images'
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
          const [products, categories, inventory] = await Promise.all([
            catalog.adminProducts(),
            catalog.categoryList(),
            catalog.inventory(),
          ]);
          return page(request, reply, 'dashboard', {
            metrics: {
              'Active products': products.filter((p) => p.status === 'active')
                .length,
              'Draft products': products.filter((p) => p.status === 'draft')
                .length,
              Categories: categories.length,
              Variants: inventory.length,
              'Low stock': inventory.filter(
                (r) => r.variant.stockQuantity <= env.lowStockThreshold,
              ).length,
            },
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
        protectedRoutes.get('/products', async (request, reply) =>
          page(request, reply, 'products', {
            products: await catalog.adminProducts(),
          }),
        );
        protectedRoutes.get('/products/new', async (request, reply) =>
          page(request, reply, 'product-form', {
            categories: await catalog.categoryList(),
            values: { status: 'draft' },
            variants: [],
            images: [],
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
        protectedRoutes.get('/inventory', async (request, reply) =>
          page(request, reply, 'inventory', {
            inventory: await catalog.inventory(),
            threshold: env.lowStockThreshold,
          }),
        );
        protectedRoutes.post<{ Params: { id: string; variantId: string } }>(
          '/products/:id/variants/:variantId/stock',
          async (request, reply) => {
            try {
              await catalog.stock(
                request.params.id,
                request.params.variantId,
                body(request),
              );
              return reply.redirect('/admin/inventory', 303);
            } catch (error) {
              if (!(error instanceof FormError)) throw error;
              return page(request, reply.code(422), 'inventory', {
                inventory: await catalog.inventory(),
                threshold: env.lowStockThreshold,
                error,
                values: { ...body(request), id: request.params.variantId },
              });
            }
          },
        );
        protectedRoutes.get('/media', async (request, reply) => {
          const products = await catalog.adminProducts();
          return page(request, reply, 'media', {
            products,
            ...(await catalog.relations(products.map((p) => p.id))),
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
