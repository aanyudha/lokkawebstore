import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { FormError, type Form } from '../catalog/validation.js';
import type { createOrderFulfillment } from '../shipping/order-fulfillment.js';

export type AdminPage = (
  request: FastifyRequest,
  reply: FastifyReply,
  name: string,
  data: Record<string, unknown>,
) => Promise<unknown>;
export const validWebOrderNumber = /^WEB-\d{8}-\d{6,10}$/;

export function registerShipmentActions(
  app: FastifyInstance,
  path: string,
  fulfillment: ReturnType<typeof createOrderFulfillment>,
  destination: (orderNumber: string) => string,
  invalid: (
    request: FastifyRequest,
    reply: FastifyReply,
    orderNumber: string,
    error: string,
  ) => Promise<unknown>,
) {
  for (const action of ['ship', 'tracking', 'deliver'] as const) {
    app.post<{ Params: { orderNumber: string } }>(
      `${path}/${action}`,
      async (request, reply) => {
        const { orderNumber } = request.params;
        if (!validWebOrderNumber.test(orderNumber)) return reply.callNotFound();
        const actor = request.internalAdmin!.id;
        const form = (request.body ?? {}) as Form;
        try {
          if (action === 'ship')
            await fulfillment.markShipped(orderNumber, form, actor);
          if (action === 'tracking')
            await fulfillment.correctTracking(orderNumber, form, actor);
          if (action === 'deliver')
            await fulfillment.markDelivered(orderNumber, actor);
          return reply.redirect(destination(orderNumber), 303);
        } catch (error) {
          if (!(error instanceof FormError)) throw error;
          return invalid(request, reply.code(422), orderNumber, error.message);
        }
      },
    );
  }
}
