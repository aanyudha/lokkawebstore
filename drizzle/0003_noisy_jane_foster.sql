CREATE TABLE "product_direct_cost_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"amount_rupiah" bigint NOT NULL,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "direct_cost_valid" CHECK ("product_direct_cost_components"."amount_rupiah" >= 0 AND "product_direct_cost_components"."sort_order" >= 0 AND "product_direct_cost_components"."category" IN ('DIRECT_MATERIAL','DIRECT_LABOR','PACKAGING','OTHER'))
);
--> statement-breakpoint
CREATE TABLE "fulfillment_origins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"contact_name" text NOT NULL,
	"phone" text NOT NULL,
	"address_line_1" text NOT NULL,
	"address_line_2" text,
	"district" text NOT NULL,
	"city" text NOT NULL,
	"province" text NOT NULL,
	"postal_code" text NOT NULL,
	"country_code" text DEFAULT 'ID' NOT NULL,
	"latitude" text,
	"longitude" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "origin_valid" CHECK ("fulfillment_origins"."status" IN ('active','inactive') AND (NOT "fulfillment_origins"."is_default" OR "fulfillment_origins"."status" = 'active') AND "fulfillment_origins"."country_code" = 'ID' AND ("fulfillment_origins"."latitude" IS NULL OR "fulfillment_origins"."latitude"::numeric BETWEEN -90 AND 90) AND ("fulfillment_origins"."longitude" IS NULL OR "fulfillment_origins"."longitude"::numeric BETWEEN -180 AND 180))
);
--> statement-breakpoint
CREATE TABLE "global_overhead_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"amount_rupiah" bigint NOT NULL,
	"billing_frequency" text NOT NULL,
	"recognition_method" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "overhead_cost_valid" CHECK ("global_overhead_costs"."amount_rupiah" >= 0 AND ("global_overhead_costs"."end_date" IS NULL OR "global_overhead_costs"."end_date" >= "global_overhead_costs"."start_date") AND "global_overhead_costs"."category" IN ('INFRASTRUCTURE','SOFTWARE','FACILITY','ADMINISTRATION','MARKETING','OTHER') AND "global_overhead_costs"."billing_frequency" IN ('MONTHLY','ANNUAL','ONE_TIME') AND "global_overhead_costs"."recognition_method" IN ('SPREAD_MONTHLY','CHARGE_IN_BILLING_PERIOD'))
);
--> statement-breakpoint
CREATE TABLE "global_overhead_period_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_id" uuid NOT NULL,
	"overhead_cost_id" uuid,
	"name_snapshot" text NOT NULL,
	"category_snapshot" text NOT NULL,
	"recognized_amount_rupiah" bigint NOT NULL,
	"source_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "overhead_item_valid" CHECK (("global_overhead_period_items"."source_type" = 'RECURRING_COST' AND "global_overhead_period_items"."recognized_amount_rupiah" >= 0) OR ("global_overhead_period_items"."source_type" = 'MANUAL_ADJUSTMENT' AND length(trim("global_overhead_period_items"."name_snapshot")) > 0))
);
--> statement-breakpoint
CREATE TABLE "global_overhead_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"period_month" date NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"opening_carry_forward_rupiah" bigint DEFAULT 0 NOT NULL,
	"previous_period_id" uuid,
	"closing_unrecovered_rupiah" bigint,
	"forecast_units_remaining" integer NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "overhead_period_valid" CHECK (extract(day from "global_overhead_periods"."period_month") = 1 AND "global_overhead_periods"."forecast_units_remaining" > 0 AND "global_overhead_periods"."opening_carry_forward_rupiah" >= 0 AND (("global_overhead_periods"."status" = 'OPEN' AND "global_overhead_periods"."closed_at" IS NULL AND "global_overhead_periods"."closing_unrecovered_rupiah" IS NULL) OR ("global_overhead_periods"."status" = 'CLOSED' AND "global_overhead_periods"."closed_at" IS NOT NULL AND "global_overhead_periods"."closing_unrecovered_rupiah" >= 0)))
);
--> statement-breakpoint
CREATE TABLE "product_pricing_profiles" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"method" text DEFAULT 'TARGET_MARGIN' NOT NULL,
	"profit_bps" integer DEFAULT 0 NOT NULL,
	"tax_bps" integer DEFAULT 0 NOT NULL,
	"rounding_rupiah" bigint DEFAULT 1000 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_profile_valid" CHECK ("product_pricing_profiles"."profit_bps" >= 0 AND "product_pricing_profiles"."tax_bps" >= 0 AND "product_pricing_profiles"."tax_bps" < 10000 AND "product_pricing_profiles"."rounding_rupiah" IN (1,1000,5000,10000) AND ("product_pricing_profiles"."method" = 'MARKUP' OR ("product_pricing_profiles"."method" = 'TARGET_MARGIN' AND "product_pricing_profiles"."profit_bps" + "product_pricing_profiles"."tax_bps" < 10000)))
);
--> statement-breakpoint
CREATE TABLE "global_overhead_recovery_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_id" uuid NOT NULL,
	"source_type" text DEFAULT 'MANUAL' NOT NULL,
	"amount_rupiah" bigint NOT NULL,
	"reference" text,
	"notes" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recovery_entry_valid" CHECK ("global_overhead_recovery_entries"."amount_rupiah" <> 0 AND length(trim("global_overhead_recovery_entries"."notes")) > 0 AND "global_overhead_recovery_entries"."source_type" = 'MANUAL')
);
--> statement-breakpoint
ALTER TABLE "product_variants" DROP CONSTRAINT "variants_compare_price_valid";--> statement-breakpoint
ALTER TABLE "product_direct_cost_components" ADD CONSTRAINT "product_direct_cost_components_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_origins" ADD CONSTRAINT "fulfillment_origins_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_overhead_costs" ADD CONSTRAINT "global_overhead_costs_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_overhead_period_items" ADD CONSTRAINT "global_overhead_period_items_period_id_global_overhead_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."global_overhead_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_overhead_period_items" ADD CONSTRAINT "global_overhead_period_items_overhead_cost_id_global_overhead_costs_id_fk" FOREIGN KEY ("overhead_cost_id") REFERENCES "public"."global_overhead_costs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_overhead_periods" ADD CONSTRAINT "global_overhead_periods_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_overhead_periods" ADD CONSTRAINT "global_overhead_periods_previous_period_id_global_overhead_periods_id_fk" FOREIGN KEY ("previous_period_id") REFERENCES "public"."global_overhead_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_pricing_profiles" ADD CONSTRAINT "product_pricing_profiles_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_overhead_recovery_entries" ADD CONSTRAINT "global_overhead_recovery_entries_period_id_global_overhead_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."global_overhead_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "direct_cost_product_idx" ON "product_direct_cost_components" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "origin_vendor_idx" ON "fulfillment_origins" USING btree ("vendor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "origin_default_unique" ON "fulfillment_origins" USING btree ("vendor_id") WHERE "fulfillment_origins"."is_default" = true AND "fulfillment_origins"."status" = 'active';--> statement-breakpoint
CREATE INDEX "overhead_vendor_idx" ON "global_overhead_costs" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "overhead_items_period_idx" ON "global_overhead_period_items" USING btree ("period_id");--> statement-breakpoint
CREATE UNIQUE INDEX "overhead_snapshot_once" ON "global_overhead_period_items" USING btree ("period_id","overhead_cost_id");--> statement-breakpoint
CREATE UNIQUE INDEX "overhead_vendor_month_unique" ON "global_overhead_periods" USING btree ("vendor_id","period_month");--> statement-breakpoint
CREATE UNIQUE INDEX "overhead_one_open" ON "global_overhead_periods" USING btree ("vendor_id") WHERE "global_overhead_periods"."status" = 'OPEN';--> statement-breakpoint
CREATE UNIQUE INDEX "overhead_carry_once" ON "global_overhead_periods" USING btree ("previous_period_id");--> statement-breakpoint
CREATE INDEX "recovery_period_idx" ON "global_overhead_recovery_entries" USING btree ("period_id");--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "variants_compare_price_valid" CHECK ("product_variants"."compare_at_price" > "product_variants"."price") NOT VALID;