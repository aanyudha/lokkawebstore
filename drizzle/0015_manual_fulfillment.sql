CREATE TABLE "order_fulfillments" (
  "order_id" uuid PRIMARY KEY REFERENCES "orders" ("id"),
  "courier_name" text NOT NULL,
  "service_name" text NOT NULL,
  "tracking_number" text NOT NULL,
  "fulfillment_status" text NOT NULL,
  "actual_shipping_cost" bigint,
  "shipped_at" timestamptz NOT NULL,
  "delivered_at" timestamptz,
  "shipped_by_id" uuid NOT NULL REFERENCES "admin_users" ("id"),
  "delivered_by_id" uuid REFERENCES "admin_users" ("id"),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "order_fulfillments_cost_nonnegative" CHECK ("actual_shipping_cost" >= 0),
  CONSTRAINT "order_fulfillments_delivery" CHECK (
    ("fulfillment_status" = 'SHIPPED' AND "delivered_at" IS NULL AND "delivered_by_id" IS NULL) OR
    ("fulfillment_status" = 'DELIVERED' AND "delivered_at" >= "shipped_at" AND "delivered_at" IS NOT NULL AND "delivered_by_id" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE TABLE "order_tracking_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" uuid NOT NULL REFERENCES "order_fulfillments" ("order_id"),
  "previous_tracking_number" text NOT NULL,
  "tracking_number" text NOT NULL,
  "changed_by_id" uuid NOT NULL REFERENCES "admin_users" ("id"),
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "order_tracking_changes_order_idx" ON "order_tracking_changes" ("order_id", "created_at");
--> statement-breakpoint
ALTER TABLE "financial_transactions"
  ADD COLUMN "shipment_order_id" uuid UNIQUE REFERENCES "order_fulfillments" ("order_id"),
  DROP CONSTRAINT "financial_transactions_type_enum",
  ADD CONSTRAINT "financial_transactions_type_enum" CHECK ("type" IN ('REVENUE', 'CASH_INFLOW', 'MANUAL', 'OPENING_BALANCE', 'SHIPPING_EXPENSE')),
  ADD CONSTRAINT "financial_transactions_shipment_expense" CHECK (
    ("type" <> 'SHIPPING_EXPENSE' AND "shipment_order_id" IS NULL) OR
    ("type" = 'SHIPPING_EXPENSE' AND "shipment_order_id" IS NOT NULL AND "source" = 'WEBSTORE'
      AND "direction" = 'EXPENSE' AND "category" = 'TRANSPORT' AND "sale_id" IS NULL AND "status" = 'POSTED')
  );
