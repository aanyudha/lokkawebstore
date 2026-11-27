import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '../../db/client.js';
import type { AppEnv } from '../../config/env.js';
import { orderedLocales, locales, type LocaleCode } from '../../i18n/index.js';
import { t } from '../../i18n/translator.js';
import { tokenMatches } from '../auth/service.js';
import { FormError, formatIdr, type Form } from '../catalog/validation.js';
import { createCartService } from './service.js';
import { createOrderService } from '../orders/service.js';
import {
  createOrderHistory,
  historyFilters,
  historySuffix,
} from '../orders/history.js';
import {
  createCheckout,
  ShippingSelectionChanged,
} from '../checkout/service.js';
import { createShippingRateService } from '../shipping/rates.js';
import { JntRateProvider } from '../shipping/jnt-rate-provider.js';
import { createCustomerAddresses } from '../customer/addresses.js';
import { safeReturnPath } from '../customer/validation.js';
import { localPaymentActions } from '../payments/local-provider.js';
import {
  isPayableWebstoreOrder,
  type createPaymentService,
} from '../payments/service.js';

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
  payments?: Pick<
    ReturnType<typeof createPaymentService>,
    'createPayment' | 'local'
  >,
  shippingFetch?: typeof fetch,
) {
  const cart = createCartService(db);
  const orders = createOrderService(db);
  const history = createOrderHistory(db);
  if (env.shippingRateMode === 'jnt_unavailable')
    app.log.warn(
      { provider: 'jnt', reason: 'configuration_unavailable' },
      'Shipping tariff unavailable',
    );
  const checkout = createCheckout(
    db,
    createShippingRateService(
      env.jntRate
        ? [
            new JntRateProvider(env.jntRate, shippingFetch, (reason) => {
              app.log.info(
                { provider: 'jnt', reason },
                'Shipping tariff unavailable',
              );
            }),
          ]
        : [],
    ),
  );
  const addresses = createCustomerAddresses(db);
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
      ) {
        const orderPage =
          request.method === 'GET' &&
          request.routeOptions.url?.startsWith(shopPaths[locale].orders);
        const target =
          (orderPage && safeReturnPath(request.url)) || shopPaths[locale].cart;
        return reply.redirect(
          `${shopPaths[locale].login}?returnTo=${encodeURIComponent(target)}`,
          303,
        );
      }
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
          title: `${t(locale, page.startsWith('order') ? 'shop.orders' : page === 'checkout' ? 'shop.checkout' : 'shop.cart')} | LOKKA`,
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
          localTime: (date: Date) =>
            date.toLocaleString(locale === 'id' ? 'id-ID' : 'en-GB', {
              timeZone: 'Asia/Jakarta',
            }) + ' WIB',
          ...data,
        });
      const renderCart = async (
        request: FastifyRequest,
        reply: FastifyReply,
        error: string | null = null,
      ) =>
        render(request, reply, 'cart', {
          ...(await cart.get(request.customerIdentity!.customer.id)),
          error,
        });
      secure.get(paths.cart, (request, reply) => renderCart(request, reply));
      const customerId = (r: FastifyRequest) => r.customerIdentity!.customer.id;
      const renderCheckout = async (
        r: FastifyRequest,
        reply: FastifyReply,
        data: Record<string, unknown> = {},
      ) =>
        render(
          r,
          reply,
          'checkout',
          {
            ...(await checkout.options(customerId(r))),
            selection: form(r),
            reviewed: null,
            shippingRates: null,
            addressForm: null,
            ...data,
          },
          '/review',
        );
      const shopError = (cause: FormError, fallback: string) =>
        cause.message.startsWith('shop.') ? cause.message : fallback;
      const checkoutError = (cause: FormError) =>
        cause instanceof ShippingSelectionChanged
          ? { shippingRates: { rates: cause.rates } }
          : { error: shopError(cause, 'shop.error.changed') };
      secure.get(`${paths.cart}/review`, (r, reply) =>
        renderCheckout(r, reply),
      );
      secure.post(`${paths.cart}/review/rates`, async (r, reply) => {
        try {
          const shippingRates = await checkout.rates(customerId(r), form(r));
          return renderCheckout(r, reply, { shippingRates });
        } catch (cause) {
          if (!(cause instanceof FormError)) throw cause;
          return renderCheckout(r, reply.code(422), checkoutError(cause));
        }
      });
      secure.post(`${paths.cart}/review`, async (r, reply) => {
        try {
          const reviewed = await checkout.review(customerId(r), form(r));
          return renderCheckout(r, reply, { reviewed });
        } catch (cause) {
          if (!(cause instanceof FormError)) throw cause;
          return renderCheckout(r, reply.code(422), checkoutError(cause));
        }
      });
      for (const suffix of ['', '/:id']) {
        secure.post(
          `${paths.cart}/review/addresses${suffix}`,
          async (r, reply) => {
            const addressId = (r.params as { id?: string }).id;
            try {
              await addresses.save(customerId(r), form(r), addressId);
              return reply.redirect(`${paths.cart}/review`, 303);
            } catch (cause) {
              if (!(cause instanceof FormError)) throw cause;
              return renderCheckout(r, reply.code(422), {
                error: shopError(cause, 'shop.error.addressFields'),
                addressForm: { id: addressId, values: form(r) },
              });
            }
          },
        );
      }
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
          const order = await checkout.place(
            customerId(request),
            form(request),
          );
          return reply.redirect(`${paths.orders}/${order.orderNumber}`, 303);
        } catch (error) {
          if (!(error instanceof FormError)) throw error;
          return renderCheckout(request, reply.code(422), checkoutError(error));
        }
      });
      secure.get<{ Querystring: { status?: unknown; page?: unknown } }>(
        paths.orders,
        async (request, reply) => {
          const list = await history.list(customerId(request), request.query);
          return render(
            request,
            reply,
            'orders',
            {
              ...list,
              filters: historyFilters,
              historySuffix,
              formatCount: (value: string) =>
                BigInt(value).toLocaleString(
                  locale === 'id' ? 'id-ID' : 'en-GB',
                ),
            },
            historySuffix(list.filter, list.page),
          );
        },
      );
      const renderOrder = async (
        request: FastifyRequest,
        reply: FastifyReply,
        error: string | null = null,
      ) => {
        const orderNumber = (request.params as { orderNumber: string })
          .orderNumber;
        const detail = await history.detail(customerId(request), orderNumber);
        if (!detail) return reply.callNotFound();
        const { order, payment, shipment } = detail;
        const payable = !shipment && isPayableWebstoreOrder(order);
        const canPay = Boolean(payments) && payable;
        const paymentAction = !canPay
          ? null
          : !payment
            ? 'paymentStart'
            : payment.status === 'PENDING'
              ? 'paymentContinue'
              : ['EXPIRED', 'FAILED', 'CANCELLED'].includes(payment.status)
                ? 'paymentRetry'
                : null;
        const timeline = [
          { event: 'placed', date: order.createdAt },
          {
            event: 'paid',
            date: payment?.status === 'PAID' ? payment.paidAt : null,
          },
          { event: 'shipped', date: shipment?.shippedAt },
          { event: 'delivered', date: shipment?.deliveredAt },
        ].filter(({ date }) => date);
        return render(
          request,
          reply,
          'order',
          {
            ...detail,
            error,
            paymentAction,
            localPaymentProvider: Boolean(payments?.local),
            paymentOffline:
              !payments &&
              payable &&
              payment?.status !== 'REVIEW' &&
              payment?.status !== 'PAID',
            timeline,
            canCancel:
              order.status === 'PENDING_PAYMENT' &&
              !shipment &&
              (!payment ||
                ['FAILED', 'EXPIRED', 'CANCELLED'].includes(payment.status)),
          },
          `/${orderNumber}`,
        );
      };
      secure.get(`${paths.orders}/:orderNumber`, (request, reply) =>
        renderOrder(request, reply),
      );
      secure.get(
        `${paths.orders}/:orderNumber/payment/return`,
        (request, reply) => renderOrder(request, reply),
      );
      if (payments) {
        secure.post(
          `${paths.orders}/:orderNumber/payment`,
          async (request, reply) => {
            const { orderNumber } = request.params as { orderNumber: string };
            const orderPath = `${paths.orders}/${encodeURIComponent(orderNumber)}`;
            const result = await payments.createPayment({
              customerId: customerId(request),
              orderNumber,
              locale,
              returnUrl: new URL(orderPath + '/payment/return', env.appUrl)
                .href,
            });
            if (result.status === 'missing') return reply.callNotFound();
            if (result.status === 'redirect') {
              if (payments.local)
                return reply.redirect(result.checkoutUrl, 303);
              reply.header('Referrer-Policy', 'no-referrer');
              return render(
                request,
                reply,
                'order-redirect',
                {
                  checkoutUrl: result.checkoutUrl,
                },
                `/${orderNumber}`,
              );
            }
            if (result.status === 'ineligible')
              return renderOrder(
                request,
                reply.code(422),
                'shop.error.paymentUnavailable',
              );
            return reply.redirect(orderPath, 303);
          },
        );
      }
      const local = payments?.local;
      if (local) {
        type LocalParams = { orderNumber: string; requestId: string };
        const path = `${paths.orders}/:orderNumber/payment/local/:requestId`;
        secure.get<{ Params: LocalParams }>(path, async (request, reply) => {
          const { orderNumber, requestId } = request.params;
          const checkout = await local.detail({
            ...request.params,
            customerId: customerId(request),
          });
          if (!checkout) return reply.callNotFound();
          return render(
            request,
            reply,
            'order-local-payment',
            { orderNumber, checkout, localPaymentActions },
            `/${encodeURIComponent(orderNumber)}/payment/local/${encodeURIComponent(requestId)}`,
          );
        });
        secure.post<{ Params: LocalParams }>(path, async (request, reply) => {
          const action = localPaymentActions.find(
            (value) => value === form(request).action,
          );
          if (!action)
            return reply.code(422).send('Invalid simulation action.');
          const result = await local.simulate(
            { ...request.params, customerId: customerId(request) },
            action,
          );
          if (result === 'missing') return reply.callNotFound();
          if (result === 'ineligible')
            return reply
              .code(409)
              .send('This checkout can no longer be simulated.');
          return reply.redirect(
            `${paths.orders}/${encodeURIComponent(request.params.orderNumber)}`,
            303,
          );
        });
      }
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
