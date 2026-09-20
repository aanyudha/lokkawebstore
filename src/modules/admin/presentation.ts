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
    label: 'Finance',
    items: [
      {
        label: 'Global overhead',
        href: '/admin/finance/overhead',
        area: 'overhead',
      },
    ],
  },
  {
    label: 'Settings',
    items: [
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
