import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '../../db/client.js';
import { FormError, formatIdr } from '../catalog/validation.js';
import {
  adminOrdersPath,
  createBackOfficeOrders,
  notificationLabels,
  orderFilters,
  orderLabels,
  paymentLabels,
} from '../orders/back-office.js';
import { t } from '../../i18n/translator.js';
import type { PaymentReadiness } from '../payments/config.js';
import { createOrderFulfillment } from '../shipping/order-fulfillment.js';
import {
  registerShipmentActions,
  validWebOrderNumber,
  type AdminPage,
} from './shipment-actions.js';

const route = '/orders';
const orderStatus = {
  PENDING_PAYMENT: 'Pending payment',
  PAID: 'Paid',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
};
const shipmentLabels = { SHIPPED: 'Shipped', DELIVERED: 'Delivered' };
const localTime = (date: Date | null) =>
  date
    ? date.toLocaleString('en-GB', { timeZone: 'Asia/Jakarta' }) + ' WIB'
    : '—';

export async function registerOrderAdmin(
  app: FastifyInstance,
  db: Database['db'],
  page: AdminPage,
  paymentReadiness: PaymentReadiness,
) {
  const read = createBackOfficeOrders(db);
  const shared = {
    url: adminOrdersPath,
    orderLabels,
    paymentLabels,
    shipmentLabels,
    formatIdr,
    localTime,
  };
  await app.register(async (secure) => {
    secure.addHook('onRequest', async (_request, reply) => {
      // Keep search terms out of referrers and preserve Origin on same-origin form posts.
      reply.header('Referrer-Policy', 'strict-origin');
    });
    secure.addHook('onSend', async (_request, reply) => {
      reply.header(
        'Cache-Control',
        'private, no-store, no-cache, must-revalidate',
      );
    });
    secure.get<{ Querystring: Record<string, unknown> }>(
      route,
      async (request, reply) => {
        try {
          return page(request, reply, 'orders', {
            ...shared,
            ...(await read.list(request.query)),
            filters: orderFilters,
          });
        } catch (error) {
          if (!(error instanceof FormError)) throw error;
          return page(request, reply.code(422), 'orders', {
            ...shared,
            rows: [],
            filter: 'all',
            listing: null,
            filters: orderFilters,
            error: error.message,
          });
        }
      },
    );
    async function detail(
      request: FastifyRequest,
      reply: FastifyReply,
      orderNumber: string,
      error: string | null = null,
    ) {
      if (!validWebOrderNumber.test(orderNumber)) return reply.callNotFound();
      const data = await read.detail(orderNumber);
      if (!data) return reply.callNotFound();
      return page(request, reply, 'order-detail', {
        ...shared,
        ...data,
        error,
        orderStatus,
        notificationLabels,
        paymentReadiness,
        customerStatus: t('en', 'shop.history.status.' + data.status),
      });
    }
    secure.get<{ Params: { orderNumber: string } }>(
      `${route}/:orderNumber`,
      (request, reply) => detail(request, reply, request.params.orderNumber),
    );
    registerShipmentActions(
      secure,
      `${route}/:orderNumber`,
      createOrderFulfillment(db),
      (number) => `${adminOrdersPath}/${number}`,
      detail,
    );
  });
}
