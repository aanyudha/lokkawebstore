import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  index,
  check,
  boolean,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const recordStatus = pgEnum('record_status', [
  'draft',
  'active',
  'archived',
]);
export const categoryStatus = pgEnum('category_status', ['active', 'hidden']);
export const variantStatus = pgEnum('variant_status', ['active', 'inactive']);
export const adminStatus = pgEnum('admin_status', ['active', 'disabled']);
export const vendors = pgTable('vendors', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  status: recordStatus('status').default('draft').notNull(),
  ...timestamps(),
});
export const categories = pgTable(
  'categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    parentId: uuid('parent_id').references((): AnyPgColumn => categories.id, {
      onDelete: 'restrict',
    }),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    status: categoryStatus('status').default('hidden').notNull(),
    shortDescription: text('short_description'),
    seoTitle: text('seo_title'),
    seoDescription: text('seo_description'),
    sortOrder: integer('sort_order').default(0).notNull(),
    ...timestamps(),
  },
  (t) => [
    index('categories_parent_idx').on(t.parentId),
    check('categories_not_self_parent', sql`${t.parentId} <> ${t.id}`),
  ],
);
export const products = pgTable(
  'products',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'restrict' }),
    categoryId: uuid('category_id').references(() => categories.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    description: text('description'),
    shortDescription: text('short_description'),
    featured: boolean('featured').default(false).notNull(),
    seoTitle: text('seo_title'),
    seoDescription: text('seo_description'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    status: recordStatus('status').default('draft').notNull(),
    ...timestamps(),
  },
  (t) => [
    index('products_vendor_idx').on(t.vendorId),
    index('products_category_idx').on(t.categoryId),
    index('products_status_idx').on(t.status),
    index('products_category_status_idx').on(t.categoryId, t.status),
  ],
);
export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    sku: text('sku').notNull().unique(),
    name: text('name').notNull(),
    price: bigint('price', { mode: 'bigint' }).notNull(),
    compareAtPrice: bigint('compare_at_price', { mode: 'bigint' }),
    weightGrams: integer('weight_grams').notNull(),
    stockQuantity: integer('stock_quantity').default(0).notNull(),
    status: variantStatus('status').default('inactive').notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    ...timestamps(),
  },
  (t) => [
    index('variants_product_idx').on(t.productId),
    check('variants_price_nonnegative', sql`${t.price} >= 0`),
    check(
      'variants_compare_price_valid',
      sql`${t.compareAtPrice} >= ${t.price}`,
    ),
    check('variants_weight_nonnegative', sql`${t.weightGrams} >= 0`),
    check('variants_stock_nonnegative', sql`${t.stockQuantity} >= 0`),
  ],
);
export const adminUsers = pgTable('admin_users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  status: adminStatus('status').default('active').notNull(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  ...timestamps(),
});
export const adminSessions = pgTable(
  'admin_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    csrfTokenHash: text('csrf_token_hash').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('sessions_expiration_idx').on(t.expiresAt),
    index('sessions_user_idx').on(t.adminUserId),
  ],
);
export const productImages = pgTable(
  'product_images',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull().unique(),
    altText: text('alt_text'),
    sortOrder: integer('sort_order').default(0).notNull(),
    isPrimary: boolean('is_primary').default(false).notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('images_product_order_idx').on(t.productId, t.sortOrder),
    uniqueIndex('images_one_primary_idx')
      .on(t.productId)
      .where(sql`${t.isPrimary} = true`),
  ],
);
