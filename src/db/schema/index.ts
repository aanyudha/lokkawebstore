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
    status: recordStatus('status').default('draft').notNull(),
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
    status: recordStatus('status').default('draft').notNull(),
    ...timestamps(),
  },
  (t) => [
    index('products_vendor_idx').on(t.vendorId),
    index('products_category_idx').on(t.categoryId),
    index('products_status_idx').on(t.status),
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
    status: recordStatus('status').default('draft').notNull(),
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
