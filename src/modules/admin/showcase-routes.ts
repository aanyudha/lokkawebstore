import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Showcase } from '../catalog/showcase.js';
import type { Catalog } from '../catalog/service.js';
import type { CatalogImageStorage } from '../catalog/storage.js';
import { hashToken, tokenMatches } from '../auth/service.js';
import { FormError, type Form, textField } from '../catalog/validation.js';
import { renderAdminError } from './presentation.js';
type Page = (
  request: FastifyRequest,
  reply: FastifyReply,
  name: string,
  data?: Record<string, unknown>,
) => Promise<unknown>;
export function registerShowcaseAdmin(
  app: FastifyInstance,
  showcase: Showcase,
  catalog: Catalog,
  storage: CatalogImageStorage,
  page: Page,
) {
  const body = (r: FastifyRequest) => (r.body ?? {}) as Form;
  const uuid = (value: unknown, field = 'id'): string => {
    if (
      typeof value !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
      )
    )
      throw new FormError(field, 'Invalid ID.');
    return value;
  };
  async function renderEditor(
    request: FastifyRequest,
    reply: FastifyReply,
    productId: string,
    error?: FormError,
  ) {
    const product = await catalog.product(productId);
    const showcaseRow = await showcase.getOrCreateShowcase(product.id);
    const selections = await showcase.showcaseSelections(showcaseRow.id);
    const readiness = await showcase.computeReadiness(showcaseRow.id);
    const related = await catalog.relations([product.id]);
    return page(request, reply.code(error ? 422 : 200), 'showcase-editor', {
      product,
      showcase: showcaseRow,
      selections,
      readiness,
      images: related.images,
      error,
    });
  }
  app.get('/showcase', async (request, reply) => {
    const items = await showcase.showcaseIndex();
    return page(request, reply, 'showcase-index', { items });
  });
  app.get<{ Params: { id: string } }>(
    '/products/:id/showcase',
    async (request, reply) => renderEditor(request, reply, request.params.id),
  );
  app.post<{ Params: { id: string } }>(
    '/products/:id/showcase/select',
    async (request, reply) => {
      try {
        const imageId = uuid(body(request).imageId, 'imageId');
        await showcase.addSelection(request.params.id, imageId);
        return reply.redirect(
          `/admin/products/${request.params.id}/showcase`,
          303,
        );
      } catch (error) {
        if (!(error instanceof FormError)) throw error;
        return renderEditor(request, reply, request.params.id, error);
      }
    },
  );
  app.post<{ Params: { id: string; selectionId: string } }>(
    '/products/:id/showcase/remove/:selectionId',
    async (request, reply) => {
      try {
        await showcase.removeSelection(request.params.selectionId);
        return reply.redirect(
          `/admin/products/${request.params.id}/showcase`,
          303,
        );
      } catch (error) {
        if (!(error instanceof FormError)) throw error;
        return renderEditor(request, reply, request.params.id, error);
      }
    },
  );
  app.post<{ Params: { id: string } }>(
    '/products/:id/showcase/reorder',
    async (request, reply) => {
      try {
        const ordered = body(request).order;
        if (!Array.isArray(ordered))
          throw new FormError('order', 'Invalid order data.');
        const showcaseRow = await showcase.getOrCreateShowcase(
          request.params.id,
        );
        await showcase.reorder(showcaseRow.id, ordered.map(String));
        return reply.redirect(
          `/admin/products/${request.params.id}/showcase`,
          303,
        );
      } catch (error) {
        if (!(error instanceof FormError)) throw error;
        return renderEditor(request, reply, request.params.id, error);
      }
    },
  );
  app.post<{ Params: { id: string } }>(
    '/products/:id/showcase/cover',
    async (request, reply) => {
      try {
        const imageId = uuid(body(request).imageId, 'imageId');
        const showcaseRow = await showcase.getOrCreateShowcase(
          request.params.id,
        );
        await showcase.setCover(showcaseRow.id, imageId);
        return reply.redirect(
          `/admin/products/${request.params.id}/showcase`,
          303,
        );
      } catch (error) {
        if (!(error instanceof FormError)) throw error;
        return renderEditor(request, reply, request.params.id, error);
      }
    },
  );
  app.post<{ Params: { id: string } }>(
    '/products/:id/showcase/status',
    async (request, reply) => {
      try {
        const form = body(request);
        const status = String(form.status ?? 'draft');
        if (!['draft', 'active', 'archived'].includes(status))
          throw new FormError('status', 'Invalid status.');
        const notes =
          form.notes !== undefined ? textField(form, 'notes', 2000) : undefined;
        await showcase.setStatus(request.params.id, status, notes);
        return reply.redirect(
          `/admin/products/${request.params.id}/showcase`,
          303,
        );
      } catch (error) {
        if (!(error instanceof FormError)) throw error;
        return renderEditor(request, reply, request.params.id, error);
      }
    },
  );
  app.post<{ Params: { id: string } }>(
    '/products/:id/showcase/upload',
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
          `/admin/products/${request.params.id}/showcase`,
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
        return renderEditor(request, reply, request.params.id, friendly);
      }
    },
  );
}
