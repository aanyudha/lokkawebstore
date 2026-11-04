import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '../../db/client.js';
import type { AppEnv } from '../../config/env.js';
import { orderedLocales, locales, type LocaleCode } from '../../i18n/index.js';
import { t } from '../../i18n/translator.js';
import { tokenMatches } from '../auth/service.js';
import { FormError, formatIdr, type Form } from '../catalog/validation.js';
import { createCartService } from './service.js';
import { createOrderService } from '../orders/service.js';

export const shopPaths = {
  en: {
    cart: '/cart',
    orders: '/account/orders',
    login: '/account/login',
    account: '/account',
    shopping: '/collections',
  },
  id: {
    cart: '/id/keranjang',
    orders: '/id/akun/pesanan',
    login: '/id/akun/masuk',
    account: '/id/akun',
    shopping: '/id/koleksi',
  },
};
const form = (request: FastifyRequest) => (request.body ?? {}) as Form;

export async function registerCart(
  app: FastifyInstance,
  db: Database['db'],
  env: AppEnv,
) {
  const cart = createCartService(db);
  const orders = createOrderService(db);
  app.addHook('onRequest', async (request, reply) => {
    reply.locals = Object.assign({}, reply.locals, {
      cartCount: request.customerIdentity
        ? await cart.count(request.customerIdentity.customer.id)
        : '0',
    });
    if (request.customerIdentity)
      reply.header('Cache-Control', 'private, no-store');
  });
  await app.register(async (secure) => {
    secure.addHook('onRequest', async (request, reply) => {
      reply
        .header('Cache-Control', 'private, no-store')
        .header('X-Robots-Tag', 'noindex, nofollow');
      const locale = request.url.startsWith('/id/') ? 'id' : 'en';
      if (
        !request.customerIdentity ||
        !tokenMatches(
          request.cookies.lokka_customer_csrf,
          request.customerIdentity.session.csrfTokenHash,
        )
      )
        return reply.redirect(
          `${shopPaths[locale].login}?returnTo=${encodeURIComponent(shopPaths[locale].cart)}`,
          303,
        );
    });
    secure.addHook('preHandler', async (request, reply) => {
      if (
        !['GET', 'HEAD'].includes(request.method) &&
        !tokenMatches(
          form(request).csrf,
          request.customerIdentity!.session.csrfTokenHash,
        )
      )
        return reply.code(403).send('CSRF token invalid.');
    });
    for (const locale of ['en', 'id'] as LocaleCode[]) {
      const paths = shopPaths[locale];
      const render = (
        request: FastifyRequest,
        reply: FastifyReply,
        page: string,
        data: Record<string, unknown>,
        suffix = '',
      ) =>
        reply.viewAsync(`cart/${page}.ejs`, {
          title: `${t(locale, page === 'orders' || page === 'order' ? 'shop.orders' : 'shop.cart')} | LOKKA`,
          locale,
          locales: orderedLocales,
          htmlLang: locales[locale].htmlLang,
          languagePaths: {
            en:
              (page.startsWith('order')
                ? shopPaths.en.orders
                : shopPaths.en.cart) + suffix,
            id:
              (page.startsWith('order')
                ? shopPaths.id.orders
                : shopPaths.id.cart) + suffix,
          },
          noindex: true,
          canonical: new URL(
            (page.startsWith('order') ? paths.orders : paths.cart) + suffix,
            env.appUrl,
          ).href,
          paths,
          csrf: request.cookies.lokka_customer_csrf,
          error: null,
          t: (key: string) => t(locale, key),
          formatIdr: (value: bigint) => formatIdr(value, locale),
          ...data,
        });
      const renderCart = async (
        request: FastifyRequest,
        reply: FastifyReply,
        review = false,
        error: string | null = null,
      ) =>
        render(
          request,
          reply,
          'cart',
          {
            ...(await cart.get(request.customerIdentity!.customer.id)),
            review,
            error,
          },
          review ? '/review' : '',
        );
      secure.get(paths.cart, (request, reply) => renderCart(request, reply));
      secure.get(`${paths.cart}/review`, (request, reply) =>
        renderCart(request, reply, true),
      );
      for (const action of ['add', 'update', 'remove'] as const) {
        secure.post(
          action === 'add'
            ? `${paths.cart}/items`
            : `${paths.cart}/items/:id/${action}`,
          async (request, reply) => {
            try {
              await cart.mutate(
                request.customerIdentity!.customer.id,
                action,
                action === 'add'
                  ? (form(request).variantId as string)
                  : (request.params as { id: string }).id,
                form(request).quantity,
              );
              return reply.redirect(paths.cart, 303);
            } catch (error) {
              if (!(error instanceof FormError)) throw error;
              return renderCart(
                request,
                reply.code(422),
                false,
                error.message.startsWith('shop.')
                  ? error.message
                  : 'shop.error.item',
              );
            }
          },
        );
      }
      secure.post(`${paths.cart}/orders`, async (request, reply) => {
        try {
          const order = await orders.create(
            request.customerIdentity!.customer.id,
            form(request).revision as string,
          );
          return reply.redirect(`${paths.orders}/${order.orderNumber}`, 303);
        } catch (error) {
          if (!(error instanceof FormError)) throw error;
          return renderCart(
            request,
            reply.code(422),
            true,
            error.message.startsWith('shop.')
              ? error.message
              : 'shop.error.changed',
          );
        }
      });
      secure.get(paths.orders, async (request, reply) =>
        render(request, reply, 'orders', {
          orders: await orders.list(request.customerIdentity!.customer.id),
        }),
      );
      secure.get(`${paths.orders}/:orderNumber`, async (request, reply) => {
        const orderNumber = (request.params as { orderNumber: string })
          .orderNumber;
        const order = await orders.get(
          request.customerIdentity!.customer.id,
          orderNumber,
        );
        if (!order) return reply.callNotFound();
        return render(request, reply, 'order', { order }, `/${orderNumber}`);
      });
      secure.post(
        `${paths.orders}/:orderNumber/cancel`,
        async (request, reply) => {
          const orderNumber = (request.params as { orderNumber: string })
            .orderNumber;
          try {
            await orders.cancel(
              request.customerIdentity!.customer.id,
              orderNumber,
            );
          } catch (error) {
            if (!(error instanceof FormError)) throw error;
            return reply.callNotFound();
          }
          return reply.redirect(`${paths.orders}/${orderNumber}`, 303);
        },
      );
    }
  });
}
