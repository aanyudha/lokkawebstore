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
  date,
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
      sql`${t.compareAtPrice} > ${t.price}`,
    ),
    check('variants_weight_nonnegative', sql`${t.weightGrams} >= 0`),
    check('variants_stock_nonnegative', sql`${t.stockQuantity} >= 0`),
  ],
);
export const directCosts = pgTable(
  'product_direct_cost_components',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    category: text('category', {
      enum: ['DIRECT_MATERIAL', 'DIRECT_LABOR', 'PACKAGING', 'OTHER'],
    }).notNull(),
    amountRupiah: bigint('amount_rupiah', { mode: 'bigint' }).notNull(),
    notes: text('notes'),
    sortOrder: integer('sort_order').default(0).notNull(),
    ...timestamps(),
  },
  (t) => [
    index('direct_cost_product_idx').on(t.productId),
    check(
      'direct_cost_valid',
      sql`${t.amountRupiah} >= 0 AND ${t.sortOrder} >= 0 AND ${t.category} IN ('DIRECT_MATERIAL','DIRECT_LABOR','PACKAGING','OTHER')`,
    ),
  ],
);
export const pricingProfiles = pgTable(
  'product_pricing_profiles',
  {
    productId: uuid('product_id')
      .primaryKey()
      .references(() => products.id, { onDelete: 'cascade' }),
    method: text('method', { enum: ['TARGET_MARGIN', 'MARKUP'] })
      .default('TARGET_MARGIN')
      .notNull(),
    profitBps: integer('profit_bps').default(0).notNull(),
    taxBps: integer('tax_bps').default(0).notNull(),
    roundingRupiah: bigint('rounding_rupiah', { mode: 'bigint' })
      .default(sql`1000`)
      .notNull(),
    ...timestamps(),
  },
  (t) => [
    check(
      'pricing_profile_valid',
      sql`${t.profitBps} >= 0 AND ${t.taxBps} >= 0 AND ${t.taxBps} < 10000 AND ${t.roundingRupiah} IN (1,1000,5000,10000) AND (${t.method} = 'MARKUP' OR (${t.method} = 'TARGET_MARGIN' AND ${t.profitBps} + ${t.taxBps} < 10000))`,
    ),
  ],
);
export const overheadCosts = pgTable(
  'global_overhead_costs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id),
    name: text('name').notNull(),
    category: text('category').notNull(),
    amountRupiah: bigint('amount_rupiah', { mode: 'bigint' }).notNull(),
    billingFrequency: text('billing_frequency', {
      enum: ['MONTHLY', 'ANNUAL', 'ONE_TIME'],
    }).notNull(),
    recognitionMethod: text('recognition_method', {
      enum: ['SPREAD_MONTHLY', 'CHARGE_IN_BILLING_PERIOD'],
    }).notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date'),
    active: boolean('active').default(true).notNull(),
    notes: text('notes'),
    ...timestamps(),
  },
  (t) => [
    index('overhead_vendor_idx').on(t.vendorId),
    check(
      'overhead_cost_valid',
      sql`${t.amountRupiah} >= 0 AND (${t.endDate} IS NULL OR ${t.endDate} >= ${t.startDate}) AND ${t.category} IN ('INFRASTRUCTURE','SOFTWARE','FACILITY','ADMINISTRATION','MARKETING','OTHER') AND ${t.billingFrequency} IN ('MONTHLY','ANNUAL','ONE_TIME') AND ${t.recognitionMethod} IN ('SPREAD_MONTHLY','CHARGE_IN_BILLING_PERIOD')`,
    ),
  ],
);
export const overheadPeriods = pgTable(
  'global_overhead_periods',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id),
    periodMonth: date('period_month').notNull(),
    status: text('status', { enum: ['OPEN', 'CLOSED'] })
      .default('OPEN')
      .notNull(),
    openingCarryForwardRupiah: bigint('opening_carry_forward_rupiah', {
      mode: 'bigint',
    })
      .default(sql`0`)
      .notNull(),
    previousPeriodId: uuid('previous_period_id').references(
      (): AnyPgColumn => overheadPeriods.id,
    ),
    closingUnrecoveredRupiah: bigint('closing_unrecovered_rupiah', {
      mode: 'bigint',
    }),
    forecastUnitsRemaining: integer('forecast_units_remaining').notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex('overhead_vendor_month_unique').on(t.vendorId, t.periodMonth),
    uniqueIndex('overhead_one_open')
      .on(t.vendorId)
      .where(sql`${t.status} = 'OPEN'`),
    uniqueIndex('overhead_carry_once').on(t.previousPeriodId),
    check(
      'overhead_period_valid',
      sql`extract(day from ${t.periodMonth}) = 1 AND ${t.forecastUnitsRemaining} > 0 AND ${t.openingCarryForwardRupiah} >= 0 AND ((${t.status} = 'OPEN' AND ${t.closedAt} IS NULL AND ${t.closingUnrecoveredRupiah} IS NULL) OR (${t.status} = 'CLOSED' AND ${t.closedAt} IS NOT NULL AND ${t.closingUnrecoveredRupiah} IS NOT NULL AND ${t.closingUnrecoveredRupiah} >= 0))`,
    ),
  ],
);
export const overheadItems = pgTable(
  'global_overhead_period_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    periodId: uuid('period_id')
      .notNull()
      .references(() => overheadPeriods.id),
    overheadCostId: uuid('overhead_cost_id').references(() => overheadCosts.id),
    nameSnapshot: text('name_snapshot').notNull(),
    categorySnapshot: text('category_snapshot').notNull(),
    recognizedAmountRupiah: bigint('recognized_amount_rupiah', {
      mode: 'bigint',
    }).notNull(),
    sourceType: text('source_type', {
      enum: ['RECURRING_COST', 'MANUAL_ADJUSTMENT'],
    }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('overhead_items_period_idx').on(t.periodId),
    uniqueIndex('overhead_snapshot_once').on(t.periodId, t.overheadCostId),
    check(
      'overhead_item_valid',
      sql`(${t.sourceType} = 'RECURRING_COST' AND ${t.recognizedAmountRupiah} >= 0) OR (${t.sourceType} = 'MANUAL_ADJUSTMENT' AND length(trim(${t.nameSnapshot})) > 0)`,
    ),
  ],
);
export const recoveryEntries = pgTable(
  'global_overhead_recovery_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    periodId: uuid('period_id')
      .notNull()
      .references(() => overheadPeriods.id),
    sourceType: text('source_type', { enum: ['MANUAL'] })
      .default('MANUAL')
      .notNull(),
    amountRupiah: bigint('amount_rupiah', { mode: 'bigint' }).notNull(),
    reference: text('reference'),
    notes: text('notes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('recovery_period_idx').on(t.periodId),
    check(
      'recovery_entry_valid',
      sql`${t.amountRupiah} <> 0 AND length(trim(${t.notes})) > 0 AND ${t.sourceType} = 'MANUAL'`,
    ),
  ],
);
export const fulfillmentOrigins = pgTable(
  'fulfillment_origins',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id),
    name: text('name').notNull(),
    contactName: text('contact_name').notNull(),
    phone: text('phone').notNull(),
    addressLine1: text('address_line_1').notNull(),
    addressLine2: text('address_line_2'),
    district: text('district').notNull(),
    city: text('city').notNull(),
    province: text('province').notNull(),
    postalCode: text('postal_code').notNull(),
    countryCode: text('country_code').default('ID').notNull(),
    latitude: text('latitude'),
    longitude: text('longitude'),
    isDefault: boolean('is_default').default(false).notNull(),
    status: text('status', { enum: ['active', 'inactive'] })
      .default('active')
      .notNull(),
    ...timestamps(),
  },
  (t) => [
    index('origin_vendor_idx').on(t.vendorId),
    uniqueIndex('origin_default_unique')
      .on(t.vendorId)
      .where(sql`${t.isDefault} = true AND ${t.status} = 'active'`),
    check(
      'origin_valid',
      sql`${t.status} IN ('active','inactive') AND (NOT ${t.isDefault} OR ${t.status} = 'active') AND ${t.countryCode} = 'ID' AND (${t.latitude} IS NULL OR ${t.latitude}::numeric BETWEEN -90 AND 90) AND (${t.longitude} IS NULL OR ${t.longitude}::numeric BETWEEN -180 AND 180)`,
    ),
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
export const productTranslations = pgTable(
  'product_translations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    locale: text('locale').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    shortDescription: text('short_description'),
    description: text('description'),
    seoTitle: text('seo_title'),
    seoDescription: text('seo_description'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('product_translations_product_locale_idx').on(
      t.productId,
      t.locale,
    ),
    uniqueIndex('product_translations_locale_slug_idx').on(t.locale, t.slug),
  ],
);
export const categoryTranslations = pgTable(
  'category_translations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    locale: text('locale').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    shortDescription: text('short_description'),
    seoTitle: text('seo_title'),
    seoDescription: text('seo_description'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('category_translations_category_locale_idx').on(
      t.categoryId,
      t.locale,
    ),
    uniqueIndex('category_translations_locale_slug_idx').on(t.locale, t.slug),
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
