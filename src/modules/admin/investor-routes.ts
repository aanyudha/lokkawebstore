import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '../../db/client.js';
import { createFixedAssets } from '../finance/fixed-assets.js';
import { createInvestorReports } from '../finance/investor-reports.js';
import { FormError, formatIdr, type Form } from '../catalog/validation.js';
type Page = (
  request: FastifyRequest,
  reply: FastifyReply,
  name: string,
  data?: Record<string, unknown>,
) => Promise<unknown>;
export function registerInvestorAdmin(
  app: FastifyInstance,
  db: Database['db'],
  page: Page,
) {
  const fixed = createFixedAssets(db);
  const reports = createInvestorReports(db);
  const render = async (
    request: FastifyRequest,
    reply: FastifyReply,
    values: Record<string, unknown> = {},
    assetId: string | null = null,
    error: FormError | null = null,
  ) =>
    page(request, reply, 'fixed-assets', {
      assets: await fixed.list(),
      values,
      assetId,
      error,
      formatIdr,
    });
  app.get('/finance/fixed-assets', (r, reply) => render(r, reply));
  app.get<{ Params: { id: string } }>(
    '/finance/fixed-assets/:id/edit',
    async (r, reply) => {
      try {
        return render(r, reply, await fixed.get(r.params.id), r.params.id);
      } catch (error) {
        if (!(error instanceof FormError)) throw error;
        return reply.callNotFound();
      }
    },
  );
  for (const url of ['/finance/fixed-assets', '/finance/fixed-assets/:id']) {
    app.post<{ Params: { id?: string } }>(url, async (r, reply) => {
      try {
        await fixed.save(
          (r.body ?? {}) as Form,
          r.internalAdmin!.id,
          r.params.id,
        );
        return reply.redirect('/admin/finance/fixed-assets', 303);
      } catch (error) {
        if (!(error instanceof FormError)) throw error;
        return render(
          r,
          reply.code(422),
          (r.body ?? {}) as Form,
          r.params.id ?? null,
          error,
        );
      }
    });
  }
  app.get('/reports/assets', async (r, reply) =>
    page(r, reply, 'asset-report', {
      report: await reports.report(),
      formatIdr,
    }),
  );
  app.get('/reports/12-month-plan', async (r, reply) =>
    page(r, reply, 'plan-report', {
      report: await reports.report(new Date(), true),
      formatIdr,
    }),
  );
}
