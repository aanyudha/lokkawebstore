import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database } from '../../db/client.js';
import type { AppEnv } from '../../config/env.js';
import { token } from '../auth/service.js';
import { createPosAuth, tokenMatches, hashToken } from './auth.js';
import { renderPos, renderPosError } from './presentation.js';
import { createSalesService } from '../sales/service.js';
import type { Form } from '../catalog/validation.js';
import { FormError, textField } from '../catalog/validation.js';
import type { CatalogImageStorage } from '../catalog/storage.js';

const body = (request: FastifyRequest) => (request.body ?? {}) as Form;
type SaleItemForm = { variantId: string; quantity: number | string };

function stringify(data: unknown): string {
  return JSON.stringify(data, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
}

export async function registerPos(
  app: FastifyInstance,
  db: Database['db'],
  env: AppEnv,
  _storage: CatalogImageStorage, // eslint-disable-line @typescript-eslint/no-unused-vars
) {
  const posAuth = createPosAuth(db);
  const sales = createSalesService(db);
  const cookies = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.nodeEnv === 'production',
    path: '/pos',
  };
  const COOKIE = 'lokka_pos';
  const CSRF_COOKIE = 'lokka_pos_csrf';
  const LOGIN_CSRF_COOKIE = 'lokka_pos_login_csrf';

  await app.register(
    async (pos) => {
      pos.addHook('onRequest', async (_request, reply) => {
        reply.header('X-Robots-Tag', 'noindex, nofollow');
        reply.header('Cache-Control', 'no-store');
      });

      // ─── Login ──────────────────────────────────────────
      pos.get('/login', async (_request, reply) => {
        const loginCsrf = token();
        reply.setCookie(LOGIN_CSRF_COOKIE, loginCsrf, {
          ...cookies,
          maxAge: 600,
        });
        return renderPos(reply, 'login', { loginCsrf });
      });

      pos.post(
        '/login',
        { config: { rateLimit: { max: 8, timeWindow: '15 minutes' } } },
        async (request, reply) => {
          const form = body(request);
          const loginCsrf = request.cookies[LOGIN_CSRF_COOKIE] ?? '';
          if (!loginCsrf || !tokenMatches(form.csrf, hashToken(loginCsrf))) {
            return renderPosError(
              reply,
              403,
              'Form expired. Reload the login page.',
            );
          }
          try {
            if (
              typeof form.password !== 'string' ||
              !form.password ||
              form.password.length > 128
            )
              throw new FormError('password', 'Invalid password.');
            const result = await posAuth.login(
              textField(form, 'email', 254, true),
              form.password,
              request.ip,
              request.headers['user-agent'] ?? '',
              request.cookies[COOKIE],
            );
            if (!result) {
              const loginCsrfNew = token();
              reply.setCookie(LOGIN_CSRF_COOKIE, loginCsrfNew, {
                ...cookies,
                maxAge: 600,
              });
              reply.code(401);
              return renderPos(reply, 'login', {
                loginCsrf: loginCsrfNew,
                error: {
                  field: 'email',
                  message: 'Invalid email or password.',
                },
                values: { email: form.email },
              });
            }
            reply.setCookie(COOKIE, result.sessionToken, {
              ...cookies,
              expires: result.expiresAt,
            });
            reply.setCookie(CSRF_COOKIE, result.csrf, {
              ...cookies,
              expires: result.expiresAt,
            });
            reply.clearCookie(LOGIN_CSRF_COOKIE, { ...cookies });
            return reply.redirect('/pos', 303);
          } catch (error) {
            const loginCsrfNew = token();
            reply.setCookie(LOGIN_CSRF_COOKIE, loginCsrfNew, {
              ...cookies,
              maxAge: 600,
            });
            const msg =
              error instanceof FormError
                ? error.message
                : 'Login failed. Please try again.';
            const field = error instanceof FormError ? error.field : 'email';
            reply.code(401);
            return renderPos(reply, 'login', {
              loginCsrf: loginCsrfNew,
              error: { field, message: msg },
              values: { email: form.email },
            });
          }
        },
      );

      // ─── Logout ─────────────────────────────────────────
      pos.post('/logout', async (request, reply) => {
        const csrf = request.cookies[CSRF_COOKIE] ?? '';
        if (
          !request.body ||
          !('csrf' in (request.body as Record<string, unknown>))
        ) {
          return reply.callNotFound();
        }
        const form = body(request);
        if (!form.csrf || !tokenMatches(form.csrf, hashToken(csrf))) {
          return reply.callNotFound();
        }
        await posAuth.logout(request.cookies[COOKIE]);
        reply.clearCookie(COOKIE, { ...cookies });
        reply.clearCookie(CSRF_COOKIE, { ...cookies });
        return reply.redirect('/pos/login', 303);
      });

      // ─── Protected routes: auth in onRequest ────────────
      pos.addHook('onRequest', async (request, reply) => {
        const path = request.url.split('?')[0];
        if (path === '/pos/login' || path === '/pos/logout') return;
        const identity = await posAuth.session(request.cookies[COOKIE]);
        if (!identity) {
          if (request.method === 'GET' || request.method === 'HEAD') {
            return reply.redirect('/pos/login', 303);
          }
          return reply.code(401).send({ error: 'Authentication required' });
        }
        request.posPrincipal = identity.user;
      });

      // ─── Protected routes: CSRF + origin in preHandler ──
      pos.addHook('preHandler', async (request, reply) => {
        const path = request.url.split('?')[0];
        if (path === '/pos/login' || path === '/pos/logout') return;
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          const csrf = request.cookies[CSRF_COOKIE] ?? '';
          const form = body(request);
          if (!form.csrf || !tokenMatches(form.csrf, hashToken(csrf))) {
            return reply.code(403).send({ error: 'CSRF validation failed' });
          }
          const origin = request.headers.origin;
          if (origin) {
            try {
              const originUrl = new URL(origin);
              const appUrl = new URL(env.appUrl);
              const originHost = originUrl.hostname;
              const appHost = appUrl.hostname;
              const originMatch =
                originHost === appHost ||
                (env.nodeEnv !== 'production' &&
                  ((originHost === 'localhost' && appHost === '127.0.0.1') ||
                    (originHost === '127.0.0.1' && appHost === 'localhost')));
              if (!originMatch) {
                return reply.code(403).send({ error: 'Invalid origin' });
              }
            } catch {
              return reply.code(403).send({ error: 'Invalid origin' });
            }
          }
        }
      });

      // ─── Main register page ─────────────────────────────
      pos.get('/', async (request, reply) => {
        const principal = request.posPrincipal!;
        const csrf = request.cookies[CSRF_COOKIE] ?? '';
        return renderPos(reply, 'register', { principal, csrf });
      });

      // ─── Product search API ─────────────────────────────
      pos.get('/api/products', async (request, reply) => {
        const q =
          typeof request.query === 'object' && request.query !== null
            ? String((request.query as Record<string, unknown>).q ?? '')
            : '';
        const products = await sales.searchProducts(q || undefined);
        const json = stringify({ products });
        return reply.header('content-type', 'application/json').send(json);
      });

      // ─── Complete sale API ──────────────────────────────
      pos.post('/api/sales', async (request, reply) => {
        const principal = request.posPrincipal!;
        const form = body(request);
        const itemsRaw = form.items;
        if (!Array.isArray(itemsRaw) || !itemsRaw.length) {
          return reply
            .code(422)
            .send({ error: 'Sale must have at least one item' });
        }
        const items = (itemsRaw as SaleItemForm[]).map((item) => ({
          variantId: String(item.variantId),
          quantity: Number(item.quantity),
        }));
        const cashTendered = form.cashTendered
          ? BigInt(String(form.cashTendered))
          : undefined;
        try {
          const result = await sales.completeSale({
            source: 'POS',
            cashierId: principal.id,
            items,
            cashTendered,
          });
          const json = stringify(result);
          return reply.header('content-type', 'application/json').send(json);
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Sale failed';
          return reply.code(422).send({ error: msg });
        }
      });

      // ─── History page ───────────────────────────────────
      pos.get('/history', async (request, reply) => {
        const principal = request.posPrincipal!;
        const csrf = request.cookies[CSRF_COOKIE] ?? '';
        const { items: rawSales } = await sales.listSales({
          limit: 100,
          source: 'POS',
        });
        const enriched = rawSales.map((s) => ({
          ...s,
          totalFormatted: new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0,
          }).format(Number(s.total)),
          itemCount: 0,
          paymentMethod: 'CASH',
          cashierName: null as string | null,
        }));
        return renderPos(reply, 'history', {
          principal,
          csrf,
          sales: enriched,
        });
      });

      // ─── Sale detail page ──────────────────────────────
      pos.get('/sales/:id', async (request, reply) => {
        const principal = request.posPrincipal!;
        const csrf = request.cookies[CSRF_COOKIE] ?? '';
        const params = request.params as { id: string };
        const sale = await sales.getSale(params.id);
        if (!sale) return reply.callNotFound();
        return renderPos(reply, 'sale-detail', {
          principal,
          csrf,
          sale,
        });
      });
    },
    { prefix: '/pos' },
  );
}
