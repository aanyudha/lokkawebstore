import type { FastifyReply } from 'fastify';
import { getAssets } from '../../config/assets.js';

/** Set only by existing DB session/CSRF hooks. No persisted roles or grants. */
export interface InternalAdmin {
  id: string;
  name: string;
}
declare module 'fastify' {
  interface FastifyReply {
    adminViewAsync(
      page: string,
      data: Record<string, unknown>,
      options: { layout: string },
    ): Promise<string>;
  }
  interface FastifyRequest {
    internalAdmin?: InternalAdmin;
  }
}
export const adminNavigation = [
  {
    label: '',
    items: [{ label: 'Dashboard', href: '/admin', area: 'dashboard' }],
  },
  {
    label: 'Products',
    items: [
      { label: 'Products', href: '/admin/products', area: 'products' },
      { label: 'Categories', href: '/admin/categories', area: 'categories' },
      { label: 'Inventory', href: '/admin/inventory', area: 'inventory' },
      { label: 'Media', href: '/admin/media', area: 'media' },
    ],
  },
  {
    label: 'Sales',
    items: [{ label: 'POS', href: '/pos', area: 'pos' }],
  },
  {
    label: 'Finance',
    items: [
      {
        label: 'Fixed Assets',
        href: '/admin/finance/fixed-assets',
        area: 'fixed-assets',
      },
      {
        label: 'Cash Flow',
        href: '/admin/finance/cash-flow',
        area: 'cash-flow',
      },
      {
        label: 'Income & Expense',
        href: '/admin/finance/income-expense',
        area: 'income-expense',
      },
      {
        label: 'Accounting Lite',
        href: '/admin/finance/accounting',
        area: 'accounting',
      },
      {
        label: 'Global overhead',
        href: '/admin/finance/overhead',
        area: 'overhead',
      },
    ],
  },
  {
    label: 'Reports',
    items: [
      {
        label: 'Asset Register + Valuation',
        href: '/admin/reports/assets',
        area: 'asset-report',
      },
      {
        label: '12-month Plan + Prospective',
        href: '/admin/reports/12-month-plan',
        area: 'plan-report',
      },
    ],
  },
  {
    label: 'Settings',
    items: [
      { label: 'Homepage', href: '/admin/settings/homepage', area: 'homepage' },
      {
        label: 'Fulfillment',
        href: '/admin/settings/fulfillment',
        area: 'fulfillment',
      },
    ],
  },
];
type Crumb = { label: string; href?: string };
function metadata(page: string, data: Record<string, unknown>) {
  const values = (data.values ?? {}) as { id?: string };
  const product = data.product as { id: string; name: string } | undefined;
  const pages: Record<
    string,
    {
      title: string;
      description: string;
      area: string;
      breadcrumbs: Crumb[];
      action?: Crumb;
    }
  > = {
    'fixed-assets': {
      title: 'Fixed Assets',
      description:
        'Maintain acquisition records. No depreciation or book-value calculation.',
      area: 'fixed-assets',
      breadcrumbs: [{ label: 'Finance' }, { label: 'Fixed Assets' }],
    },
    'asset-report': {
      title: 'Asset Register + Valuation',
      description: 'Current inventory and fixed assets at recorded value.',
      area: 'asset-report',
      breadcrumbs: [
        { label: 'Reports' },
        { label: 'Asset Register + Valuation' },
      ],
    },
    'plan-report': {
      title: '12-month Plan + Prospective',
      description:
        'Factual operating position, priorities and evidence-based outlook.',
      area: 'plan-report',
      breadcrumbs: [
        { label: 'Reports' },
        { label: '12-month Plan + Prospective' },
      ],
    },
    homepage: {
      title: 'Homepage',
      description: 'Manage the storefront hero image.',
      area: 'homepage',
      breadcrumbs: [{ label: 'Settings' }, { label: 'Homepage' }],
    },
    dashboard: {
      title: 'Dashboard',
      description:
        'Your catalog at a glance. Keep products and daily operations in order.',
      area: 'dashboard',
      breadcrumbs: [{ label: 'Dashboard' }],
    },
    products: {
      title: 'Products',
      description: 'Manage the LOKKA catalog, variants and product details.',
      area: 'products',
      breadcrumbs: [{ label: 'Products' }],
      action: { label: 'Add product', href: '/admin/products/new' },
    },
    'product-form': {
      title: values.id ? 'Edit product' : 'New product',
      description: 'Product details, variants and images in one place.',
      area: 'products',
      breadcrumbs: [
        { label: 'Products', href: '/admin/products' },
        { label: values.id ? 'Edit product' : 'New product' },
      ],
    },
    categories: {
      title: 'Categories',
      description: 'Organize products into a clear catalog hierarchy.',
      area: 'categories',
      breadcrumbs: [{ label: 'Categories' }],
      action: { label: 'Add category', href: '/admin/categories/new' },
    },
    'category-form': {
      title: values.id ? 'Edit category' : 'New category',
      description: 'Manage category details and their place in the catalog.',
      area: 'categories',
      breadcrumbs: [
        { label: 'Categories', href: '/admin/categories' },
        { label: values.id ? 'Edit category' : 'New category' },
      ],
    },
    inventory: {
      title: 'Inventory',
      description: 'Review variant availability and update stock quantities.',
      area: 'inventory',
      breadcrumbs: [
        { label: 'Products', href: '/admin/products' },
        { label: 'Inventory' },
      ],
    },
    media: {
      title: 'Media',
      description:
        'Browse product photography. Manage images from the product editor.',
      area: 'media',
      breadcrumbs: [
        { label: 'Products', href: '/admin/products' },
        { label: 'Media' },
      ],
    },
    pricing: {
      title: 'Product costs & pricing',
      description: product?.name ?? '',
      area: 'products',
      breadcrumbs: [
        { label: 'Products', href: '/admin/products' },
        {
          label: 'Edit product',
          href: product
            ? `/admin/products/${product.id}/edit`
            : '/admin/products',
        },
        { label: 'Pricing' },
      ],
    },
    overhead: {
      title: 'Global overhead',
      description:
        'Manage business-wide costs, allocation and recovery periods.',
      area: 'overhead',
      breadcrumbs: [{ label: 'Finance' }, { label: 'Global overhead' }],
    },
    accounting: {
      title: 'Accounting Lite',
      description:
        'Revenue, historical cost of goods sold and actual operating expenses.',
      area: 'accounting',
      breadcrumbs: [{ label: 'Finance' }, { label: 'Accounting Lite' }],
    },
    'cash-flow': {
      title: 'Cash Flow',
      description:
        'Cash in, cash out and ending balance for a period, derived from the finance ledger.',
      area: 'cash-flow',
      breadcrumbs: [{ label: 'Finance' }, { label: 'Cash Flow' }],
    },
    'income-expense': {
      title: 'Income & Expense',
      description:
        'Record real income and expenses. POS income is posted automatically.',
      area: 'income-expense',
      breadcrumbs: [{ label: 'Finance' }, { label: 'Income & Expense' }],
      action: { label: 'Add transaction', href: '#add-transaction' },
    },
    fulfillment: {
      title: 'LOKKA fulfillment origin',
      description: 'Maintain the dispatch details used by your business.',
      area: 'fulfillment',
      breadcrumbs: [{ label: 'Settings' }, { label: 'Fulfillment' }],
    },
  };
  return (
    pages[page] ?? {
      title: 'LOKKA Admin',
      description: '',
      area: '',
      breadcrumbs: [],
    }
  );
}
export function renderAdmin(
  reply: FastifyReply,
  page: string,
  data: Record<string, unknown> = {},
) {
  const meta = metadata(page, data);
  return reply.adminViewAsync(
    `admin/${page}.ejs`,
    {
      admin: true,
      adminAssets: getAssets('admin'),
      navigation: adminNavigation,
      principal: null,
      csrf: '',
      error: null,
      values: {},
      pageTitle: meta.title,
      pageDescription: meta.description,
      activeArea: meta.area,
      breadcrumbs: meta.breadcrumbs,
      pageAction: meta.action ?? null,
      ...data,
      title: `${page === 'login' ? 'Internal sign in' : meta.title} | LOKKA`,
    },
    {
      layout:
        page === 'login' || !data.principal
          ? 'layouts/admin-auth.ejs'
          : 'layouts/admin-backoffice.ejs',
    },
  );
}
export async function renderAdminError(
  reply: FastifyReply,
  status: number,
  message: string,
  principal?: InternalAdmin,
  csrf = '',
) {
  reply
    .code(status)
    .header('Cache-Control', 'no-store')
    .header('X-Robots-Tag', 'noindex, nofollow');
  const html = await renderAdmin(reply, 'error', {
    principal,
    csrf,
    status,
    message,
    pageTitle:
      status === 404
        ? 'Page not found'
        : status === 403
          ? 'Access denied'
          : 'Unable to complete your request',
    pageDescription: '',
    breadcrumbs: [{ label: 'Error' }],
  });
  // Explicitly send: this helper also runs inside onRequest/preHandler hooks.
  // Returning rendered HTML alone would let a rejected mutation continue.
  return reply.send(html);
}
