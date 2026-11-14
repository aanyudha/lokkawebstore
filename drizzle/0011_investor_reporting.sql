ALTER TABLE "product_variants" ADD COLUMN "stock_known" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "unit" text;
--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "variants_unknown_stock_placeholder" CHECK ("stock_known" OR "stock_quantity" = 0);
--> statement-breakpoint
CREATE TABLE "fixed_assets" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "vendor_id" uuid NOT NULL REFERENCES "vendors"("id"),
 "asset_name" text NOT NULL,
 "quantity" integer NOT NULL,
 "unit" text NOT NULL,
 "acquisition_cost_per_unit" bigint NOT NULL,
 "acquisition_date" date,
 "notes" text,
 "status" text DEFAULT 'ACTIVE' NOT NULL,
 "created_by" uuid NOT NULL REFERENCES "admin_users"("id"),
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
 CONSTRAINT "fixed_assets_valid" CHECK ("quantity" > 0 AND "acquisition_cost_per_unit" >= 0 AND "status" IN ('ACTIVE','DISPOSED'))
);
--> statement-breakpoint
CREATE INDEX "fixed_assets_vendor_idx" ON "fixed_assets" ("vendor_id");
--> statement-breakpoint
CREATE TABLE "owner_imports" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "source_identity" text NOT NULL,
 "workbook_hash" text NOT NULL,
 "sheet" text NOT NULL,
 "source_row" integer NOT NULL,
 "entity_id" uuid NOT NULL,
 "payload_hash" text NOT NULL,
 "created_by" uuid NOT NULL REFERENCES "admin_users"("id"),
 "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "owner_import_source_row_unique" ON "owner_imports" ("source_identity","sheet","source_row");
--> statement-breakpoint
CREATE TABLE "reporting_coverage" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "vendor_id" uuid NOT NULL REFERENCES "vendors"("id"),
 "month" date NOT NULL,
 "sales_complete" boolean DEFAULT false NOT NULL,
 "expenses_complete" boolean DEFAULT false NOT NULL,
 "evidence" text NOT NULL,
 "confirmed_by" uuid NOT NULL REFERENCES "admin_users"("id"),
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
 CONSTRAINT "reporting_coverage_month_start" CHECK (extract(day from "month") = 1 AND length(trim("evidence")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "reporting_coverage_month_unique" ON "reporting_coverage" ("vendor_id","month");
