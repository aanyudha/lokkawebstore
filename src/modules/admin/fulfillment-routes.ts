import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '../../db/client.js';
import { formatIdr } from '../catalog/validation.js';
import { createOrderFulfillment } from '../shipping/order-fulfillment.js';
import {
  registerShipmentActions,
  validWebOrderNumber,
  type AdminPage,
} from './shipment-actions.js';

const route = '/fulfillment/shipments';
const url = '/admin' + route;

export function registerFulfillmentAdmin(
  app: FastifyInstance,
  db: Database['db'],
  page: AdminPage,
) {
  const fulfillment = createOrderFulfillment(db);
  async function render(
    request: FastifyRequest,
    reply: FastifyReply,
    orderNumber: string,
    error: string | null = null,
  ) {
    const order = validWebOrderNumber.test(orderNumber)
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

  registerShipmentActions(
    app,
    `${route}/:orderNumber`,
    fulfillment,
    (orderNumber) => `${url}?orderNumber=${encodeURIComponent(orderNumber)}`,
    render,
  );
}
