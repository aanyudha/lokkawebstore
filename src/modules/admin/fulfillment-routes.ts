import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '../../db/client.js';
import { FormError, formatIdr, type Form } from '../catalog/validation.js';
import { createOrderFulfillment } from '../shipping/order-fulfillment.js';

type Page = (
  request: FastifyRequest,
  reply: FastifyReply,
  name: string,
  data: Record<string, unknown>,
) => Promise<unknown>;
const route = '/fulfillment/shipments';
const url = '/admin' + route;
const validOrderNumber = /^WEB-\d{8}-\d{6,10}$/;

export function registerFulfillmentAdmin(
  app: FastifyInstance,
  db: Database['db'],
  page: Page,
) {
  const fulfillment = createOrderFulfillment(db);
  async function render(
    request: FastifyRequest,
    reply: FastifyReply,
    orderNumber: string,
    error: string | null = null,
  ) {
    const order = validOrderNumber.test(orderNumber)
      ? await fulfillment.lookup(orderNumber)
      : null;
    if (orderNumber && !order && !error) reply.code(404);
    return page(request, reply, 'shipments', {
      order,
      orderNumber,
      error,
      formatIdr,
      url,
      readyOrders: orderNumber ? [] : await fulfillment.ready(),
    });
  }
  app.get<{ Querystring: { orderNumber?: string } }>(
    route,
    (request, reply) => {
      const input = request.query.orderNumber;
      const orderNumber =
        typeof input === 'string'
          ? input.trim().toUpperCase().slice(0, 40)
          : '';
      return render(request, reply, orderNumber);
    },
  );

  for (const action of ['ship', 'tracking', 'deliver'] as const) {
    app.post<{ Params: { orderNumber: string } }>(
      `${route}/:orderNumber/${action}`,
      async (request, reply) => {
        const { orderNumber } = request.params;
        if (!validOrderNumber.test(orderNumber)) return reply.callNotFound();
        const actor = request.internalAdmin!.id;
        const form = (request.body ?? {}) as Form;
        try {
          if (action === 'ship')
            await fulfillment.markShipped(orderNumber, form, actor);
          if (action === 'tracking')
            await fulfillment.correctTracking(orderNumber, form, actor);
          if (action === 'deliver')
            await fulfillment.markDelivered(orderNumber, actor);
          return reply.redirect(
            `${url}?orderNumber=${encodeURIComponent(orderNumber)}`,
            303,
          );
        } catch (error) {
          if (!(error instanceof FormError)) throw error;
          return render(request, reply.code(422), orderNumber, error.message);
        }
      },
    );
  }
}
