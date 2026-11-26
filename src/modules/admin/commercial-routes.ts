import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import type { Finance } from '../finance/service.js';
import type { createFulfillment } from '../shipping/service.js';
import { FormError, formatIdr, type Form } from '../catalog/validation.js';
import { percentText } from '../finance/calculations.js';
type Page = (
  request: FastifyRequest,
  reply: FastifyReply,
  name: string,
  data?: Record<string, unknown>,
) => Promise<unknown>;
// Registered only inside the existing session/CSRF-protected admin scope.
export function registerCommercialAdmin(
  app: FastifyInstance,
  finance: Finance,
  fulfillment: ReturnType<typeof createFulfillment>,
  page: Page,
  shippingRateMode: AppEnv['shippingRateMode'],
) {
  const body = (r: FastifyRequest) => (r.body ?? {}) as Form;
  const renderOverhead = async (
    r: FastifyRequest,
    reply: FastifyReply,
    error: FormError | null = null,
  ) =>
    page(r, reply, 'overhead', {
      ...(await finance.dashboard((r.query as { period?: string }).period)),
      formatIdr,
      error,
      values: body(r),
      action: r.url.split('?')[0],
    });
  app.get('/finance/overhead', renderOverhead);
  const mutation = (
    path: string,
    work: (
      r: FastifyRequest<{ Params: { id: string; costId: string } }>,
    ) => Promise<unknown>,
    render: typeof renderOverhead,
    destination: (
      r: FastifyRequest<{ Params: { id: string; costId: string } }>,
    ) => string,
  ) => {
    app.post<{ Params: { id: string; costId: string } }>(
      path,
      async (r, reply) => {
        try {
          await work(r);
          return reply.redirect(destination(r), 303);
        } catch (error) {
          if (!(error instanceof FormError)) throw error;
          return render(r, reply.code(422), error);
        }
      },
    );
  };
  for (const path of ['/finance/overhead/costs', '/finance/overhead/costs/:id'])
    mutation(
      path,
      (r) => finance.saveOverhead(body(r), r.params.id),
      renderOverhead,
      () => '/admin/finance/overhead',
    );
  mutation(
    '/finance/overhead/periods',
    (r) => finance.openPeriod(body(r)),
    renderOverhead,
    () => '/admin/finance/overhead',
  );
  for (const action of ['forecast', 'adjustment', 'recovery', 'close'] as const)
    mutation(
      `/finance/overhead/periods/:id/${action}`,
      (r) => finance.changePeriod(r.params.id, action, body(r)),
      renderOverhead,
      (r) => `/admin/finance/overhead?period=${r.params.id}`,
    );
  const renderPricing = async (
    r: FastifyRequest,
    reply: FastifyReply,
    error: FormError | null = null,
  ) =>
    page(r, reply, 'pricing', {
      ...(await finance.analysis((r.params as { id: string }).id)),
      formatIdr,
      percentText,
      error,
      values: body(r),
      action: r.url,
    });
  app.get('/products/:id/pricing', renderPricing);
  for (const path of ['/products/:id/costs', '/products/:id/costs/:costId'])
    mutation(
      path,
      (r) => finance.saveProductCost(r.params.id, body(r), r.params.costId),
      renderPricing,
      (r) => `/admin/products/${r.params.id}/pricing`,
    );
  mutation(
    '/products/:id/costs/:costId/delete',
    (r) => finance.deleteProductCost(r.params.id, r.params.costId),
    renderPricing,
    (r) => `/admin/products/${r.params.id}/pricing`,
  );
  mutation(
    '/products/:id/pricing',
    (r) => finance.saveProfile(r.params.id, body(r)),
    renderPricing,
    (r) => `/admin/products/${r.params.id}/pricing`,
  );
  const renderFulfillment = async (
    r: FastifyRequest,
    reply: FastifyReply,
    error: FormError | null = null,
  ) =>
    page(r, reply, 'fulfillment', {
      origins: await fulfillment.list(),
      methods: await fulfillment.methods.list(),
      shippingRateMode,
      error,
      values: body(r),
      action: r.url,
    });
  app.get('/settings/fulfillment', renderFulfillment);
  for (const path of [
    '/settings/fulfillment/methods',
    '/settings/fulfillment/methods/:id',
  ])
    mutation(
      path,
      (r) => fulfillment.methods.save(body(r), r.params.id),
      renderFulfillment,
      () => '/admin/settings/fulfillment',
    );
  for (const path of ['/settings/fulfillment', '/settings/fulfillment/:id'])
    mutation(
      path,
      (r) => fulfillment.save(body(r), r.params.id),
      renderFulfillment,
      () => '/admin/settings/fulfillment',
    );
}
