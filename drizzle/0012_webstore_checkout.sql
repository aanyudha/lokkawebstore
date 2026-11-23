CREATE TABLE customer_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label text,
  recipient_name text NOT NULL,
  phone text NOT NULL,
  address_line1 text NOT NULL,
  address_line2 text,
  subdistrict text,
  district text,
  city text NOT NULL,
  province text NOT NULL,
  postal_code text NOT NULL,
  country_code text NOT NULL DEFAULT 'ID',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_addresses_delivery_valid CHECK (country_code = 'ID' AND postal_code ~ '^[0-9]{5}$')
);
--> statement-breakpoint
CREATE INDEX customer_addresses_customer_idx ON customer_addresses(customer_id);
--> statement-breakpoint
CREATE UNIQUE INDEX customer_addresses_default_uidx ON customer_addresses(customer_id) WHERE is_default;
--> statement-breakpoint
CREATE TABLE shipping_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL CONSTRAINT shipping_methods_code_unique UNIQUE,
  name text NOT NULL,
  description text,
  amount_rupiah bigint NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipping_methods_amount_nonnegative CHECK (amount_rupiah >= 0),
  CONSTRAINT shipping_methods_code_valid CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$')
);
--> statement-breakpoint
ALTER TABLE orders
  ADD COLUMN shipping_address_snapshot jsonb,
  ADD COLUMN shipping_method_snapshot jsonb,
  ADD COLUMN shipment_weight_grams bigint,
  ADD CONSTRAINT orders_delivery_snapshot_valid CHECK (
    (shipping_address_snapshot IS NULL AND shipping_method_snapshot IS NULL AND shipment_weight_grams IS NULL)
    OR (
      jsonb_typeof(shipping_address_snapshot) = 'object' AND shipping_address_snapshot IS NOT NULL
      AND jsonb_typeof(shipping_method_snapshot) = 'object' AND shipping_method_snapshot IS NOT NULL
      AND shipment_weight_grams IS NOT NULL AND shipment_weight_grams > 0
    )
  );
--> statement-breakpoint
ALTER TABLE order_items ADD COLUMN unit_weight_grams integer,
  ADD CONSTRAINT order_items_weight_positive CHECK (unit_weight_grams > 0);
