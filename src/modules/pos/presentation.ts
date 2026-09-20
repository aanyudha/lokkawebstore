import type { FastifyReply } from 'fastify';
import { getAssets } from '../../config/assets.js';

export interface PosPrincipal {
  id: string;
  name: string;
  email: string;
}

declare module 'fastify' {
  interface FastifyReply {
    posViewAsync(
      page: string,
      data: Record<string, unknown>,
      options: { layout: string },
    ): Promise<string>;
  }
  interface FastifyRequest {
    posPrincipal?: PosPrincipal;
  }
}

export function renderPos(
  reply: FastifyReply,
  page: string,
  data: Record<string, unknown> = {},
) {
  return reply.posViewAsync(
    `pos/${page}.ejs`,
    {
      posAssets: getAssets('pos'),
      principal: null,
      csrf: '',
      error: null,
      values: {},
      ...data,
      title: `${page === 'login' ? 'POS sign in' : 'LOKKA POS'}`,
    },
    {
      layout:
        page === 'login' || !data.principal
          ? 'layouts/pos-auth.ejs'
          : 'layouts/pos.ejs',
    },
  );
}

export async function renderPosError(
  reply: FastifyReply,
  status: number,
  message: string,
  principal?: PosPrincipal,
  csrf = '',
) {
  reply
    .code(status)
    .header('Cache-Control', 'no-store')
    .header('X-Robots-Tag', 'noindex, nofollow');
  const html = await renderPos(reply, 'error', {
    principal,
    csrf,
    status,
    message,
  });
  return reply.send(html);
}
