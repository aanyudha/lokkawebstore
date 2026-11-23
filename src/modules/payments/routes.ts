import type { FastifyInstance } from 'fastify';
import { dokuNotificationPath } from './config.js';
import { PaymentNotificationError } from './provider.js';
import type { createPaymentService } from './service.js';

export async function registerPaymentNotifications(
  app: FastifyInstance,
  payments: Pick<ReturnType<typeof createPaymentService>, 'handleNotification'>,
) {
  await app.register(async (notifications) => {
    notifications.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (_request, body, done) => done(null, body),
    );
    notifications.post(dokuNotificationPath, async (request, reply) => {
      if (!Buffer.isBuffer(request.body)) return reply.code(415).send();
      try {
        const result = await payments.handleNotification(
          request.headers,
          request.body,
        );
        if (result === 'STOCK_REVIEW') return reply.code(503).send();
        if (result === 'UNKNOWN_PAYMENT') return reply.code(404).send();
        if (
          ['EVENT_CONFLICT', 'MONEY_MISMATCH', 'REQUEST_MISMATCH'].includes(
            result,
          )
        )
          return reply.code(409).send();
        return reply.code(200).send();
      } catch (error) {
        if (error instanceof PaymentNotificationError)
          return reply.code(error.statusCode).send();
        throw error;
      }
    });
  });
}
