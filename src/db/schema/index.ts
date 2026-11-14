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

// Webstore intent is independent of completed sales, payments and fulfillment.
export const carts = pgTable('carts', {
  id: uuid('id').defaultRandom().primaryKey(),
  customerId: uuid('customer_id')
    .notNull()
    .unique()
    .references(() => customers.id, { onDelete: 'restrict' }),
  revision: uuid('revision').defaultRandom().notNull(),
  ...timestamps(),
});
export const cartItems = pgTable(
  'cart_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    cartId: uuid('cart_id')
      .notNull()
      .references(() => carts.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('cart_variant_unique').on(t.cartId, t.variantId),
    check('cart_quantity_positive', sql`${t.quantity} > 0`),
  ],
);
export const webOrderStatus = pgEnum('web_order_status', [
  'PENDING_PAYMENT',
  'CANCELLED',
  'COMPLETED',
]);
export const orderCounters = pgTable('order_counters', {
  date: date('date').primaryKey(),
  nextSequence: integer('next_sequence').notNull(),
});
export const orders = pgTable(
  'orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderNumber: text('order_number').notNull().unique(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    source: text('source').default('WEBSTORE').notNull(),
    status: webOrderStatus('status').default('PENDING_PAYMENT').notNull(),
    idempotencyKey: uuid('idempotency_key').notNull().unique(),
    currency: text('currency').default('IDR').notNull(),
    subtotal: bigint('subtotal', { mode: 'bigint' }).notNull(),
    shippingAmount: bigint('shipping_amount', { mode: 'bigint' })
      .default(sql`0`)
      .notNull(),
    discountAmount: bigint('discount_amount', { mode: 'bigint' })
      .default(sql`0`)
      .notNull(),
    grandTotal: bigint('grand_total', { mode: 'bigint' }).notNull(),
    ...timestamps(),
  },
  (t) => [
    index('orders_customer_created_idx').on(t.customerId, t.createdAt),
    check(
      'orders_money_valid',
      sql`${t.subtotal} >= 0 AND ${t.shippingAmount} >= 0 AND ${t.discountAmount} >= 0 AND ${t.grandTotal} >= 0 AND ${t.grandTotal}::numeric = ${t.subtotal}::numeric + ${t.shippingAmount} - ${t.discountAmount}`,
    ),
    check(
      'orders_webstore_idr',
      sql`${t.source} = 'WEBSTORE' AND ${t.currency} = 'IDR'`,
    ),
  ],
);
export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    productId: uuid('product_id').references(() => products.id, {
      onDelete: 'set null',
    }),
    variantId: uuid('variant_id').references(() => productVariants.id, {
      onDelete: 'set null',
    }),
    productNameSnapshot: text('product_name_snapshot').notNull(),
    variantNameSnapshot: text('variant_name_snapshot').notNull(),
    skuSnapshot: text('sku_snapshot').notNull(),
    unitPriceSnapshot: bigint('unit_price_snapshot', {
      mode: 'bigint',
    }).notNull(),
    quantity: integer('quantity').notNull(),
    lineTotalSnapshot: bigint('line_total_snapshot', {
      mode: 'bigint',
    }).notNull(),
    costSnapshot: bigint('cost_snapshot', { mode: 'bigint' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('order_items_order_idx').on(t.orderId),
    uniqueIndex('order_variant_unique').on(t.orderId, t.variantId),
    check(
      'order_items_facts_valid',
      sql`${t.quantity} > 0 AND ${t.unitPriceSnapshot} >= 0 AND ${t.lineTotalSnapshot}::numeric = ${t.unitPriceSnapshot}::numeric * ${t.quantity} AND (${t.costSnapshot} IS NULL OR ${t.costSnapshot} >= 0)`,
    ),
  ],
);
// One independent storefront hero; never a reference to product media.
export const homepageHero = pgTable(
  'homepage_hero',
  {
    id: text('id').primaryKey(),
    storageKey: text('storage_key').notNull(),
    sourceStorageKey: text('source_storage_key').notNull(),
    sourceFormat: text('source_format').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    altText: text('alt_text').default('').notNull(),
    ...timestamps(),
  },
  (t) => [
    check('homepage_hero_singleton', sql`${t.id} = 'homepage'`),
    check('homepage_hero_dimensions', sql`${t.width} > 0 AND ${t.height} > 0`),
  ],
);
export const recordStatus = pgEnum('record_status', [
  'draft',
  'active',
  'archived',
]);
export const categoryStatus = pgEnum('category_status', ['active', 'hidden']);
export const variantStatus = pgEnum('variant_status', ['active', 'inactive']);
export const adminStatus = pgEnum('admin_status', ['active', 'disabled']);
export const customerStatus = pgEnum('customer_status', ['ACTIVE', 'DISABLED']);
export const financeDirection = pgEnum('finance_direction', [
  'INCOME',
  'EXPENSE',
]);
export const financeStatus = pgEnum('finance_status', ['POSTED', 'VOIDED']);
export const financeCategory = pgEnum('finance_category', [
  'PRODUCT_SALES',
  'OTHER_INCOME',
  'PACKAGING',
  'SUPPLIES',
  'UTILITIES',
  'RENT',
  'SALARIES',
  'MARKETING',
  'TRANSPORT',
  'MAINTENANCE',
  'OTHER_EXPENSE',
  'OPENING_BALANCE',
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
    stockKnown: boolean('stock_known').default(true).notNull(),
    unit: text('unit'),
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
    check(
      'variants_unknown_stock_placeholder',
      sql`${t.stockKnown} OR ${t.stockQuantity} = 0`,
    ),
  ],
);
// Operational assets, independent of cash movements and historical sale costs.
export const fixedAssets = pgTable(
  'fixed_assets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id),
    assetName: text('asset_name').notNull(),
    quantity: integer('quantity').notNull(),
    unit: text('unit').notNull(),
    acquisitionCostPerUnit: bigint('acquisition_cost_per_unit', {
      mode: 'bigint',
    }).notNull(),
    acquisitionDate: date('acquisition_date'),
    notes: text('notes'),
    status: text('status', { enum: ['ACTIVE', 'DISPOSED'] })
      .default('ACTIVE')
      .notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => adminUsers.id),
    ...timestamps(),
  },
  (t) => [
    index('fixed_assets_vendor_idx').on(t.vendorId),
    check(
      'fixed_assets_valid',
      sql`${t.quantity} > 0 AND ${t.acquisitionCostPerUnit} >= 0 AND ${t.status} IN ('ACTIVE','DISPOSED')`,
    ),
  ],
);
export const ownerImports = pgTable(
  'owner_imports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sourceIdentity: text('source_identity').notNull(),
    workbookHash: text('workbook_hash').notNull(),
    sheet: text('sheet').notNull(),
    sourceRow: integer('source_row').notNull(),
    entityId: uuid('entity_id').notNull(),
    payloadHash: text('payload_hash').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => adminUsers.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex('owner_import_source_row_unique').on(
      t.sourceIdentity,
      t.sheet,
      t.sourceRow,
    ),
  ],
);
// Explicit documentary coverage; no elapsed-time inference or forecasting input UI.
export const reportingCoverage = pgTable(
  'reporting_coverage',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id),
    month: date('month').notNull(),
    salesComplete: boolean('sales_complete').default(false).notNull(),
    expensesComplete: boolean('expenses_complete').default(false).notNull(),
    evidence: text('evidence').notNull(),
    confirmedBy: uuid('confirmed_by')
      .notNull()
      .references(() => adminUsers.id),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('reporting_coverage_month_unique').on(t.vendorId, t.month),
    check(
      'reporting_coverage_month_start',
      sql`extract(day from ${t.month}) = 1 AND length(trim(${t.evidence})) > 0`,
    ),
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
// Customer identity is deliberately isolated from admin authentication:
// separate tables, service, cookies, middleware and CSRF context.
export const customers = pgTable(
  'customers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    emailNormalized: text('email_normalized').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    status: customerStatus('status').default('ACTIVE').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('customers_email_normalized_unique').on(t.emailNormalized),
    check('customer_name_present', sql`length(btrim(${t.name})) > 0`),
    check(
      'customer_email_normalized_lower',
      sql`${t.emailNormalized} = lower(btrim(${t.emailNormalized}))`,
    ),
  ],
);
export const customerSessions = pgTable(
  'customer_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
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
    index('customer_sessions_expiration_idx').on(t.expiresAt),
    index('customer_sessions_customer_idx').on(t.customerId),
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
    sourceStorageKey: text('source_storage_key'),
    sourceFormat: text('source_format'),
    sourceMimeType: text('source_mime_type'),
    sourceWidth: integer('source_width'),
    sourceHeight: integer('source_height'),
    sourceSizeBytes: bigint('source_size_bytes', { mode: 'number' }),
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
// ─── Transaction Foundation ──────────────────────────────────
export const saleSource = pgEnum('sale_source', [
  'POS',
  'WEBSTORE',
  'MARKETPLACE',
  'MANUAL',
]);
export const saleStatus = pgEnum('sale_status', [
  'pending',
  'completed',
  'cancelled',
  'refunded',
]);
export const paymentMethod = pgEnum('payment_method', [
  'CASH',
  'QRIS',
  'CARD',
  'BANK_TRANSFER',
  'E_WALLET',
]);
export const paymentStatus = pgEnum('payment_status', [
  'PENDING',
  'COMPLETED',
  'FAILED',
  'REFUNDED',
]);
export const inventoryMovementType = pgEnum('inventory_movement_type', [
  'SALE',
  'RETURN',
  'MANUAL_ADJUSTMENT',
  'CORRECTION',
]);
export const inventoryMovementRefType = pgEnum(
  'inventory_movement_reference_type',
  ['SALE', 'RETURN', 'MANUAL'],
);
// ─── POS Sessions (isolated from admin sessions) ────────────
export const posSessions = pgTable(
  'pos_sessions',
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
    index('pos_sessions_expiration_idx').on(t.expiresAt),
    index('pos_sessions_user_idx').on(t.adminUserId),
  ],
);
// ─── Transaction Counter (collision-safe numbering) ─────────
export const transactionCounters = pgTable('transaction_counters', {
  date: date('date').primaryKey(),
  nextSequence: integer('next_sequence').default(1).notNull(),
});
// ─── Sales ──────────────────────────────────────────────────
export const sales = pgTable(
  'sales',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    transactionNumber: text('transaction_number').notNull().unique(),
    source: saleSource('source').notNull(),
    status: saleStatus('status').default('pending').notNull(),
    customerId: uuid('customer_id').references(() => customers.id),
    cashierId: uuid('cashier_id').references(() => adminUsers.id),
    subtotal: bigint('subtotal', { mode: 'bigint' }).notNull(),
    discountAmount: bigint('discount_amount', { mode: 'bigint' })
      .default(sql`0`)
      .notNull(),
    total: bigint('total', { mode: 'bigint' }).notNull(),
    ...timestamps(),
  },
  (t) => [
    index('sales_source_idx').on(t.source),
    index('sales_status_idx').on(t.status),
    index('sales_cashier_idx').on(t.cashierId),
    index('sales_customer_idx').on(t.customerId),
    index('sales_created_at_idx').on(t.createdAt),
  ],
);
// ─── Sale Items (historical snapshot) ───────────────────────
export const saleItems = pgTable(
  'sale_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id),
    skuSnapshot: text('sku_snapshot').notNull(),
    productNameSnapshot: text('product_name_snapshot').notNull(),
    variantNameSnapshot: text('variant_name_snapshot').notNull(),
    quantity: integer('quantity').notNull(),
    unitPrice: bigint('unit_price', { mode: 'bigint' }).notNull(),
    lineTotal: bigint('line_total', { mode: 'bigint' }).notNull(),
    costSnapshot: bigint('cost_snapshot', { mode: 'bigint' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('sale_items_sale_idx').on(t.saleId),
    index('sale_items_product_idx').on(t.productId),
    index('sale_items_variant_idx').on(t.variantId),
    check('sale_items_quantity_positive', sql`${t.quantity} > 0`),
  ],
);
// ─── Sale Payments ──────────────────────────────────────────
export const salePayments = pgTable(
  'sale_payments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    method: paymentMethod('method').notNull(),
    status: paymentStatus('status').default('PENDING').notNull(),
    amountDue: bigint('amount_due', { mode: 'bigint' }).notNull(),
    amountTendered: bigint('amount_tendered', { mode: 'bigint' }).notNull(),
    changeAmount: bigint('change_amount', { mode: 'bigint' })
      .default(sql`0`)
      .notNull(),
    ...timestamps(),
  },
  (t) => [
    index('sale_payments_sale_idx').on(t.saleId),
    index('sale_payments_method_idx').on(t.method),
    index('sale_payments_status_idx').on(t.status),
  ],
);
// ─── Inventory Movements ────────────────────────────────────
export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id),
    type: inventoryMovementType('type').notNull(),
    quantityChange: integer('quantity_change').notNull(),
    referenceType: inventoryMovementRefType('reference_type').notNull(),
    referenceId: uuid('reference_id'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('inventory_movements_variant_idx').on(t.variantId),
    index('inventory_movements_type_idx').on(t.type),
    index('inventory_movements_reference_idx').on(
      t.referenceType,
      t.referenceId,
    ),
    index('inventory_movements_created_at_idx').on(t.createdAt),
  ],
);
// ─── Financial Transactions (canonical cash ledger) ─────────
// One table feeds Cash Flow and future consumers (Accounting Lite, Tax).
// Cash Flow is always derived from these rows; it is never a second ledger.
export const financialTransactions = pgTable(
  'financial_transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Automated entries reference their originating sale; manual entries do not.
    saleId: uuid('sale_id').references(() => sales.id),
    source: saleSource('source').notNull(),
    direction: financeDirection('direction').default('INCOME').notNull(),
    type: text('type', {
      enum: ['REVENUE', 'CASH_INFLOW', 'MANUAL', 'OPENING_BALANCE'],
    }).notNull(),
    category: financeCategory('category').notNull(),
    amountRupiah: bigint('amount_rupiah', { mode: 'bigint' }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    periodMonth: date('period_month').notNull(),
    status: financeStatus('status').default('POSTED').notNull(),
    voidReason: text('void_reason'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedById: uuid('voided_by_id').references(() => adminUsers.id),
    createdBy: uuid('created_by').references(() => adminUsers.id),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('financial_transactions_sale_idx').on(t.saleId),
    index('financial_transactions_source_idx').on(t.source),
    index('financial_transactions_type_idx').on(t.type),
    index('financial_transactions_period_idx').on(t.periodMonth),
    index('financial_transactions_created_at_idx').on(t.createdAt),
    index('financial_transactions_occurred_at_idx').on(t.occurredAt),
    index('financial_transactions_status_direction_idx').on(
      t.status,
      t.direction,
    ),
    // One sale contributes income exactly once: DB-level no-double-counting.
    uniqueIndex('financial_transactions_posted_sale_income_uidx')
      .on(t.saleId)
      .where(
        sql`${t.status} = 'POSTED' AND ${t.direction} = 'INCOME' AND ${t.saleId} IS NOT NULL`,
      ),
    check(
      'financial_transactions_posted_amount_positive',
      sql`${t.status} = 'VOIDED' OR ${t.amountRupiah} > 0`,
    ),
    check(
      'financial_transactions_sale_reference',
      sql`${t.saleId} IS NULL OR ${t.source} <> 'MANUAL'`,
    ),
    check(
      'financial_transactions_revenue_is_sale_income',
      sql`${t.type} <> 'REVENUE' OR (${t.saleId} IS NOT NULL AND ${t.direction} = 'INCOME' AND ${t.source} <> 'MANUAL')`,
    ),
    check(
      'financial_transactions_void_fields',
      sql`(${t.status} = 'POSTED' AND ${t.voidReason} IS NULL AND ${t.voidedAt} IS NULL AND ${t.voidedById} IS NULL) OR (${t.status} = 'VOIDED' AND ${t.voidReason} IS NOT NULL AND ${t.voidedAt} IS NOT NULL)`,
    ),
  ],
);
