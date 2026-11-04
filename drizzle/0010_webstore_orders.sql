CREATE TABLE carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL UNIQUE REFERENCES customers(id) ON DELETE RESTRICT,
  revision uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CONSTRAINT cart_quantity_positive CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cart_variant_unique ON cart_items(cart_id, variant_id);
--> statement-breakpoint
CREATE TYPE web_order_status AS ENUM ('PENDING_PAYMENT', 'CANCELLED', 'COMPLETED');
CREATE TABLE order_counters (date date PRIMARY KEY, next_sequence integer NOT NULL);
CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  source text NOT NULL DEFAULT 'WEBSTORE',
  status web_order_status NOT NULL DEFAULT 'PENDING_PAYMENT',
  idempotency_key uuid NOT NULL UNIQUE,
  currency text NOT NULL DEFAULT 'IDR',
  subtotal bigint NOT NULL,
  shipping_amount bigint NOT NULL DEFAULT 0,
  discount_amount bigint NOT NULL DEFAULT 0,
  grand_total bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_money_valid CHECK (subtotal >= 0 AND shipping_amount >= 0 AND discount_amount >= 0 AND grand_total >= 0 AND grand_total::numeric = subtotal::numeric + shipping_amount - discount_amount),
  CONSTRAINT orders_webstore_idr CHECK (source = 'WEBSTORE' AND currency = 'IDR')
);
CREATE INDEX orders_customer_created_idx ON orders(customer_id, created_at);
--> statement-breakpoint
CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES product_variants(id) ON DELETE SET NULL,
  product_name_snapshot text NOT NULL,
  variant_name_snapshot text NOT NULL,
  sku_snapshot text NOT NULL,
  unit_price_snapshot bigint NOT NULL,
  quantity integer NOT NULL,
  line_total_snapshot bigint NOT NULL,
  cost_snapshot bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_items_facts_valid CHECK (quantity > 0 AND unit_price_snapshot >= 0 AND line_total_snapshot::numeric = unit_price_snapshot::numeric * quantity AND (cost_snapshot IS NULL OR cost_snapshot >= 0))
);
CREATE INDEX order_items_order_idx ON order_items(order_id);
CREATE UNIQUE INDEX order_variant_unique ON order_items(order_id, variant_id);
