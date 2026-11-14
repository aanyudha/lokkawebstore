import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  CATEGORY_LABELS,
  MANUAL_CATEGORIES_BY_DIRECTION,
  SOURCE_LABELS,
  createLedger,
  resolvePeriod,
  type CashFlowPeriod,
} from '../finance/ledger.js';
import { FormError, formatIdr, type Form } from '../catalog/validation.js';
import type { Accounting } from '../finance/accounting.js';

type Page = (
  request: FastifyRequest,
  reply: FastifyReply,
  name: string,
  data?: Record<string, unknown>,
) => Promise<unknown>;

const options = (values: readonly string[]) =>
  values.map((value) => [value, CATEGORY_LABELS[value] ?? value] as const);

/** Period links keep the Cash Flow view on server-rendered, no-store GETs. */
function periodLinks(period: CashFlowPeriod) {
  const current = new URLSearchParams({ period: period.period });
  if (period.period === 'custom') {
    current.set('from', period.fromInput);
    current.set('to', period.toInput);
  }
  const link = (label: string, params: Record<string, string>) => {
    const search = new URLSearchParams(params);
    return {
      label,
      href: `?${search.toString()}`,
      active: search.toString() === current.toString(),
    };
  };
  return [
    link('Today', { period: 'today' }),
    link('This month', { period: 'month' }),
    link('Custom range', {
      period: 'custom',
      from: period.fromInput,
      to: period.toInput,
    }),
  ];
}

// Registered only inside the existing session/CSRF-protected admin scope.
export function registerFinanceAdmin(
  app: FastifyInstance,
  ledger: ReturnType<typeof createLedger>,
  page: Page,
  accounting: Accounting,
) {
  app.get('/finance/accounting', async (r, reply) => {
    let period: CashFlowPeriod;
    let error: FormError | null = null;
    try {
      period = resolvePeriod(r.query as Record<string, unknown>);
    } catch (failure) {
      if (!(failure instanceof FormError)) throw failure;
      error = failure;
      reply.code(422);
      period = resolvePeriod({});
    }
    return page(r, reply, 'accounting', {
      report: await accounting.report(period),
      period,
      periodLinks: periodLinks(period),
      error,
      formatIdr,
      sourceLabels: SOURCE_LABELS,
      categoryLabels: CATEGORY_LABELS,
    });
  });
  const body = (r: FastifyRequest) => (r.body ?? {}) as Form;
  /** Period can arrive as a query string or as hidden form fields on POST. */
  const periodInput = (r: FastifyRequest) => ({
    ...(r.query as Record<string, unknown>),
    ...((r.body as Record<string, unknown> | undefined) ?? {}),
  });
  const keepPeriod = (r: FastifyRequest) => {
    // The opening balance form carries the current period as hidden fields so
    // the redirect returns to the period the admin was reviewing.
    const source = periodInput(r);
    const search = new URLSearchParams();
    for (const key of ['period', 'from', 'to']) {
      const value = source[key];
      if (typeof value === 'string' && value) search.set(key, value);
    }
    const suffix = search.toString();
    return `/admin/finance/cash-flow${suffix ? `?${suffix}` : ''}`;
  };
  const renderCashFlow = async (
    r: FastifyRequest,
    reply: FastifyReply,
    error: FormError | null = null,
  ) => {
    let period: CashFlowPeriod;
    let periodError: FormError | null = null;
    try {
      period = resolvePeriod(periodInput(r));
    } catch (periodFailure) {
      if (!(periodFailure instanceof FormError)) throw periodFailure;
      periodError = periodFailure;
      period = resolvePeriod({});
    }
    return page(r, reply, 'cash-flow', {
      cashFlow: await ledger.cashFlow(period),
      period,
      periodLinks: periodLinks(period),
      openingBalances: await ledger.openingBalances(),
      sourceLabels: SOURCE_LABELS,
      categoryLabels: CATEGORY_LABELS,
      formatIdr,
      error: error ?? periodError,
      values: body(r),
      action: r.url.split('?')[0],
    });
  };
  app.get('/finance/cash-flow', renderCashFlow);
  app.post('/finance/opening-balance', async (r, reply) => {
    try {
      await ledger.setOpeningBalance(body(r), r.internalAdmin!.id);
      return reply.redirect(keepPeriod(r), 303);
    } catch (error) {
      if (!(error instanceof FormError)) throw error;
      return renderCashFlow(r, reply.code(422), error);
    }
  });
  const renderIncomeExpense = async (
    r: FastifyRequest,
    reply: FastifyReply,
    error: FormError | null = null,
  ) =>
    page(r, reply, 'income-expense', {
      history: await ledger.history(r.query as Record<string, unknown>),
      categoryOptionsByDirection: Object.fromEntries(
        Object.entries(MANUAL_CATEGORIES_BY_DIRECTION).map(
          ([direction, categories]) => [direction, options(categories)],
        ),
      ),
      categoryLabels: CATEGORY_LABELS,
      sourceLabels: SOURCE_LABELS,
      formatIdr,
      defaultOccurredAt: ledger.dateTimeInputValue(new Date()),
      error,
      values: body(r),
      action: r.url.split('?')[0],
    });
  app.get('/finance/income-expense', renderIncomeExpense);
  app.post('/finance/income-expense', async (r, reply) => {
    try {
      await ledger.recordManual(body(r), r.internalAdmin!.id);
      return reply.redirect('/admin/finance/income-expense', 303);
    } catch (error) {
      if (!(error instanceof FormError)) throw error;
      return renderIncomeExpense(r, reply.code(422), error);
    }
  });
  app.post<{ Params: { id: string } }>(
    '/finance/income-expense/:id/void',
    async (r, reply) => {
      try {
        await ledger.voidTransaction(body(r), r.params.id, r.internalAdmin!.id);
        return reply.redirect('/admin/finance/income-expense', 303);
      } catch (error) {
        if (!(error instanceof FormError)) throw error;
        return renderIncomeExpense(r, reply.code(422), error);
      }
    },
  );
}
