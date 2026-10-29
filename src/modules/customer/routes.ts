import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '../../db/client.js';
import type { AppEnv } from '../../config/env.js';
import { hashToken, token, tokenMatches } from '../auth/service.js';
import { locales, orderedLocales, type LocaleCode } from '../../i18n/index.js';
import { t } from '../../i18n/translator.js';
import { FormError, type Form } from '../catalog/validation.js';
import { createCustomerAuth, type CustomerIdentity } from './service.js';
import {
  confirmPassword,
  customerEmail,
  customerName,
  customerPassword,
  safeReturnPath,
} from './validation.js';

const COOKIE = 'lokka_customer';
const CSRF_COOKIE = 'lokka_customer_csrf';
const LOGIN_CSRF_COOKIE = 'lokka_customer_login_csrf';

type CustomerPage = 'login' | 'register' | 'home' | 'profile' | 'password';

const paths: Record<LocaleCode, Record<CustomerPage | 'logout', string>> = {
  en: {
    home: '/account',
    login: '/account/login',
    register: '/account/register',
    profile: '/account/profile',
    password: '/account/password',
    logout: '/account/logout',
  },
  id: {
    home: '/id/akun',
    login: '/id/akun/masuk',
    register: '/id/akun/daftar',
    profile: '/id/akun/profil',
    password: '/id/akun/kata-sandi',
    logout: '/id/akun/keluar',
  },
};

const body = (request: FastifyRequest) => (request.body ?? {}) as Form;

declare module 'fastify' {
  interface FastifyReply {
    locals: Record<string, unknown> | null;
  }
  interface FastifyRequest {
    customerIdentity?: CustomerIdentity;
  }
}

export async function registerCustomer(
  app: FastifyInstance,
  db: Database['db'],
  env: AppEnv,
) {
  const auth = createCustomerAuth(db);
  const cookies = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.nodeEnv === 'production',
    path: '/',
  };

  // Runs after the view plugin resets reply.locals, so the header can render
  // the signed-in state on every storefront page without touching each route.
  app.addHook('onRequest', async (request, reply) => {
    const identity = await auth.session(request.cookies[COOKIE]);
    reply.locals = Object.assign({}, reply.locals, {
      customer: identity?.customer ?? null,
    });
  });

  const render = (
    reply: FastifyReply,
    locale: LocaleCode,
    page: CustomerPage,
    data: Record<string, unknown> = {},
  ) => {
    const routes = paths[locale];
    return reply.viewAsync(`account/${page}.ejs`, {
      title: `${t(locale, 'account.title')} | LOKKA`,
      description: t(locale, 'account.metaDescription'),
      canonical: new URL(routes[page], env.appUrl).href,
      noindex: true,
      alternateLinks: '',
      locale,
      locales: orderedLocales,
      htmlLang: locales[locale].htmlLang,
      languagePaths: {
        en: paths.en[page],
        id: paths.id[page],
      },
      routes,
      t: (key: string, interp?: Record<string, string | number>) =>
        t(locale, key, interp),
      csrf: '',
      loginCsrf: '',
      error: null,
      notice: null,
      values: {},
      ...data,
    });
  };

  const markPrivate = (reply: FastifyReply) => {
    reply.header('X-Robots-Tag', 'noindex, nofollow');
    reply.header('Cache-Control', 'private, no-store');
  };

  const statusNotice = (request: FastifyRequest, locale: LocaleCode) => {
    const status = ((request.query ?? {}) as { status?: string }).status;
    if (status === 'profileUpdated')
      return t(locale, 'account.notice.profileUpdated');
    if (status === 'passwordUpdated')
      return t(locale, 'account.notice.passwordUpdated');
    return null;
  };

  const loginHandler = (locale: LocaleCode) => {
    const routes = paths[locale];
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const form = body(request);
      const loginCsrf = request.cookies[LOGIN_CSRF_COOKIE] ?? '';
      const returnTo = safeReturnPath(form.returnTo) ?? routes.home;
      const values = { email: form.email ?? '', returnTo };
      if (!loginCsrf || !tokenMatches(form.csrf, hashToken(loginCsrf)))
        return render(reply.code(403), locale, 'login', {
          loginCsrf,
          values,
          error: {
            field: 'form',
            message: 'account.error.sessionExpired',
          },
        });
      try {
        const email = customerEmail(form);
        const password =
          typeof form.password === 'string' && form.password.length <= 128
            ? form.password
            : '';
        if (!password)
          throw new FormError('password', 'account.error.invalidCredentials');
        const result = await auth.login(
          email,
          password,
          request.ip,
          request.headers['user-agent'] ?? '',
          request.cookies[COOKIE],
        );
        if (!result)
          return render(reply.code(401), locale, 'login', {
            loginCsrf,
            values,
            error: {
              field: 'email',
              message: 'account.error.invalidCredentials',
            },
          });
        reply.setCookie(COOKIE, result.sessionToken, {
          ...cookies,
          expires: result.expiresAt,
        });
        reply.setCookie(CSRF_COOKIE, result.csrfToken, {
          ...cookies,
          expires: result.expiresAt,
        });
        reply.clearCookie(LOGIN_CSRF_COOKIE, cookies);
        return reply.redirect(returnTo, 303);
      } catch (error) {
        if (!(error instanceof FormError)) throw error;
        return render(reply.code(422), locale, 'login', {
          loginCsrf,
          values,
          error,
        });
      }
    };
  };

  const registerHandler = (locale: LocaleCode) => {
    const routes = paths[locale];
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const form = body(request);
      const loginCsrf = request.cookies[LOGIN_CSRF_COOKIE] ?? '';
      const values = { name: form.name ?? '', email: form.email ?? '' };
      if (!loginCsrf || !tokenMatches(form.csrf, hashToken(loginCsrf)))
        return render(reply.code(403), locale, 'register', {
          loginCsrf,
          values,
          error: {
            field: 'form',
            message: 'account.error.sessionExpired',
          },
        });
      try {
        const name = customerName(form);
        const email = customerEmail(form);
        const password = customerPassword(form);
        confirmPassword(form, password);
        const result = await auth.register(
          { name, email, password },
          request.ip,
          request.headers['user-agent'] ?? '',
        );
        reply.setCookie(COOKIE, result.sessionToken, {
          ...cookies,
          expires: result.expiresAt,
        });
        reply.setCookie(CSRF_COOKIE, result.csrfToken, {
          ...cookies,
          expires: result.expiresAt,
        });
        reply.clearCookie(LOGIN_CSRF_COOKIE, cookies);
        return reply.redirect(routes.home, 303);
      } catch (error) {
        if (!(error instanceof FormError)) throw error;
        return render(reply.code(422), locale, 'register', {
          loginCsrf,
          values,
          error,
        });
      }
    };
  };

  await app.register(async (open) => {
    open.addHook('onRequest', async (_request, reply) => markPrivate(reply));

    for (const locale of ['en', 'id'] as LocaleCode[]) {
      const routes = paths[locale];

      open.get(routes.login, async (_request, reply) => {
        const current = (reply.locals as { customer?: unknown } | null)
          ?.customer;
        if (current) return reply.redirect(routes.home, 303);
        const loginCsrf = token();
        reply.setCookie(LOGIN_CSRF_COOKIE, loginCsrf, {
          ...cookies,
          maxAge: 600,
        });
        const returnTo = safeReturnPath(
          ((_request.query ?? {}) as { returnTo?: string }).returnTo,
        );
        return render(reply, locale, 'login', {
          loginCsrf,
          values: { returnTo: returnTo ?? '' },
        });
      });
      open.post(
        routes.login,
        { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
        loginHandler(locale),
      );

      open.get(routes.register, async (request, reply) => {
        const current = (reply.locals as { customer?: unknown } | null)
          ?.customer;
        if (current) return reply.redirect(routes.home, 303);
        const loginCsrf = token();
        reply.setCookie(LOGIN_CSRF_COOKIE, loginCsrf, {
          ...cookies,
          maxAge: 600,
        });
        return render(reply, locale, 'register', { loginCsrf });
      });
      open.post(
        routes.register,
        { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
        registerHandler(locale),
      );
    }
  });

  await app.register(async (secure) => {
    secure.addHook('onRequest', async (request, reply) => {
      markPrivate(reply);
      const identity = await auth.session(request.cookies[COOKIE]);
      const locale: LocaleCode = request.url.startsWith('/id/akun')
        ? 'id'
        : 'en';
      const routes = paths[locale];
      if (!identity) {
        const pathname = (request.url.split(/[?#]/)[0] ??
          routes.home) as string;
        const returnTo = safeReturnPath(pathname) ?? routes.home;
        return reply.redirect(
          `${routes.login}?returnTo=${encodeURIComponent(returnTo)}`,
          303,
        );
      }
      if (
        !tokenMatches(
          request.cookies[CSRF_COOKIE],
          identity.session.csrfTokenHash,
        )
      )
        return reply.redirect(routes.login, 303);
      request.customerIdentity = identity;
    });

    secure.addHook('preHandler', async (request, reply) => {
      if (
        !['GET', 'HEAD'].includes(request.method) &&
        !tokenMatches(
          body(request).csrf,
          hashToken(request.cookies[CSRF_COOKIE] ?? ''),
        )
      )
        return reply.code(403).send('CSRF token invalid.');
    });

    for (const locale of ['en', 'id'] as LocaleCode[]) {
      const routes = paths[locale];

      secure.get(routes.home, async (request, reply) => {
        const identity = request.customerIdentity!;
        return render(reply, locale, 'home', {
          csrf: request.cookies[CSRF_COOKIE] ?? '',
          notice: statusNotice(request, locale),
          profile: { name: identity.customer.name },
          values: {
            name: identity.customer.name,
            email: identity.customer.email,
          },
        });
      });

      secure.get(routes.profile, async (request, reply) => {
        const identity = request.customerIdentity!;
        return render(reply, locale, 'profile', {
          csrf: request.cookies[CSRF_COOKIE] ?? '',
          notice: statusNotice(request, locale),
          values: {
            name: identity.customer.name,
            email: identity.customer.email,
          },
        });
      });
      secure.post(
        routes.profile,
        { config: { rateLimit: { max: 30, timeWindow: '15 minutes' } } },
        async (request, reply) => {
          const identity = request.customerIdentity!;
          try {
            const name = customerName(body(request));
            await auth.updateName(identity.customer.id, name);
            return reply.redirect(
              `${routes.profile}?status=profileUpdated`,
              303,
            );
          } catch (error) {
            if (!(error instanceof FormError)) throw error;
            return render(reply.code(422), locale, 'profile', {
              csrf: request.cookies[CSRF_COOKIE] ?? '',
              values: {
                name: body(request).name ?? '',
                email: identity.customer.email,
              },
              error,
            });
          }
        },
      );

      secure.get(routes.password, async (request, reply) =>
        render(reply, locale, 'password', {
          csrf: request.cookies[CSRF_COOKIE] ?? '',
          values: {},
        }),
      );
      secure.post(
        routes.password,
        { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
        async (request, reply) => {
          const identity = request.customerIdentity!;
          const form = body(request);
          try {
            const current =
              typeof form.currentPassword === 'string'
                ? form.currentPassword
                : '';
            if (!current)
              throw new FormError(
                'currentPassword',
                'account.error.currentPassword',
              );
            const next = customerPassword(form, 'newPassword');
            if (form.confirmPassword !== next)
              throw new FormError(
                'confirmPassword',
                'account.error.passwordMismatch',
              );
            const result = await auth.changePassword(
              identity,
              current,
              next,
              request.ip,
              request.headers['user-agent'] ?? '',
            );
            reply.setCookie(COOKIE, result.sessionToken, {
              ...cookies,
              expires: result.expiresAt,
            });
            reply.setCookie(CSRF_COOKIE, result.csrfToken, {
              ...cookies,
              expires: result.expiresAt,
            });
            return reply.redirect(`${routes.home}?status=passwordUpdated`, 303);
          } catch (error) {
            if (!(error instanceof FormError)) throw error;
            return render(reply.code(422), locale, 'password', {
              csrf: request.cookies[CSRF_COOKIE] ?? '',
              values: {},
              error,
            });
          }
        },
      );

      secure.post(routes.logout, async (request, reply) => {
        await auth.logout(request.cookies[COOKIE]);
        reply
          .clearCookie(COOKIE, cookies)
          .clearCookie(CSRF_COOKIE, cookies)
          .clearCookie(LOGIN_CSRF_COOKIE, cookies);
        return reply.redirect(routes.login, 303);
      });
    }
  });
}
