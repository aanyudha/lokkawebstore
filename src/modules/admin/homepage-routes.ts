import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { HomepageHero } from '../storefront/hero.js';
import { FormError } from '../catalog/validation.js';
import { hashToken, tokenMatches } from '../auth/service.js';
import { renderAdminError } from './presentation.js';

type Page = (
  request: FastifyRequest,
  reply: FastifyReply,
  name: string,
  data?: Record<string, unknown>,
) => Promise<unknown>;
// Registered inside the existing active-admin-session/CSRF protected scope.
export function registerHomepageAdmin(
  app: FastifyInstance,
  hero: HomepageHero,
  page: Page,
) {
  const render = async (
    request: FastifyRequest,
    reply: FastifyReply,
    error: FormError | null = null,
  ) =>
    page(request, reply, 'homepage', { hero: await hero.publicImage(), error });
  app.get('/settings/homepage', render);
  app.post(
    '/settings/homepage',
    {
      bodyLimit: 11 * 1024 * 1024,
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      try {
        if (!request.isMultipart())
          throw new FormError('images', 'Use the upload form.');
        let verified = false;
        let image: Buffer | undefined;
        let altText: unknown = '';
        for await (const part of request.parts({
          limits: { files: 1, fields: 2, parts: 3, fileSize: 10 * 1024 * 1024 },
        })) {
          if (!verified) {
            if (
              part.type !== 'field' ||
              part.fieldname !== 'csrf' ||
              !tokenMatches(
                part.value,
                hashToken(request.cookies.lokka_admin_csrf ?? ''),
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
            if (part.fieldname !== 'image')
              throw new FormError('images', 'Use the hero image field.');
            if (part.filename) image = await part.toBuffer();
            else part.file.resume();
          } else if (part.fieldname === 'altText') altText = part.value;
        }
        if (!verified)
          return renderAdminError(
            reply,
            403,
            'CSRF token invalid.',
            request.internalAdmin,
            request.cookies.lokka_admin_csrf,
          );
        await hero.save(image, altText);
        return reply.redirect('/admin/settings/homepage', 303);
      } catch (error) {
        return render(
          request,
          reply.code(422),
          error instanceof FormError
            ? error
            : new FormError(
                'images',
                'Upload failed. Use one static JPG, PNG or WebP image, maximum 10 MB.',
              ),
        );
      }
    },
  );
  app.post('/settings/homepage/remove', async (_request, reply) => {
    await hero.clear();
    return reply.redirect('/admin/settings/homepage', 303);
  });
}
