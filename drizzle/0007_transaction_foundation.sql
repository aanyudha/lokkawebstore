CREATE TYPE "sale_source" AS ENUM ('POS','WEBSTORE','MARKETPLACE','MANUAL');--> statement-breakpoint
CREATE TYPE "sale_status" AS ENUM ('pending','completed','cancelled','refunded');--> statement-breakpoint
CREATE TYPE "payment_method" AS ENUM ('CASH','QRIS','CARD','BANK_TRANSFER','E_WALLET');--> statement-breakpoint
CREATE TYPE "payment_status" AS ENUM ('PENDING','COMPLETED','FAILED','REFUNDED');--> statement-breakpoint
CREATE TYPE "inventory_movement_type" AS ENUM ('SALE','RETURN','MANUAL_ADJUSTMENT','CORRECTION');--> statement-breakpoint
CREATE TYPE "inventory_movement_reference_type" AS ENUM ('SALE','RETURN','MANUAL');--> statement-breakpoint
CREATE TABLE "pos_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"csrf_token_hash" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE INDEX "pos_sessions_expiration_idx" ON "pos_sessions" ("expires_at");--> statement-breakpoint
CREATE INDEX "pos_sessions_user_idx" ON "pos_sessions" ("admin_user_id");--> statement-breakpoint
CREATE TABLE "transaction_counters" (
	"date" date PRIMARY KEY NOT NULL,
	"next_sequence" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_number" text NOT NULL,
	"source" "sale_source" NOT NULL,
	"status" "sale_status" DEFAULT 'pending' NOT NULL,
	"customer_id" uuid,
	"cashier_id" uuid,
	"subtotal" bigint NOT NULL,
	"discount_amount" bigint DEFAULT 0 NOT NULL,
	"total" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_transaction_number_unique" UNIQUE("transaction_number")
);
--> statement-breakpoint
CREATE INDEX "sales_source_idx" ON "sales" ("source");--> statement-breakpoint
CREATE INDEX "sales_status_idx" ON "sales" ("status");--> statement-breakpoint
CREATE INDEX "sales_cashier_idx" ON "sales" ("cashier_id");--> statement-breakpoint
CREATE INDEX "sales_customer_idx" ON "sales" ("customer_id");--> statement-breakpoint
CREATE INDEX "sales_created_at_idx" ON "sales" ("created_at");--> statement-breakpoint
CREATE TABLE "sale_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"sku_snapshot" text NOT NULL,
	"product_name_snapshot" text NOT NULL,
	"variant_name_snapshot" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" bigint NOT NULL,
	"line_total" bigint NOT NULL,
	"cost_snapshot" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_items_quantity_positive" CHECK ("quantity" > 0)
);
--> statement-breakpoint
CREATE INDEX "sale_items_sale_idx" ON "sale_items" ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_items_product_idx" ON "sale_items" ("product_id");--> statement-breakpoint
CREATE INDEX "sale_items_variant_idx" ON "sale_items" ("variant_id");--> statement-breakpoint
CREATE TABLE "sale_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"amount_due" bigint NOT NULL,
	"amount_tendered" bigint NOT NULL,
	"change_amount" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sale_payments_sale_idx" ON "sale_payments" ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_payments_method_idx" ON "sale_payments" ("method");--> statement-breakpoint
CREATE INDEX "sale_payments_status_idx" ON "sale_payments" ("status");--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"type" "inventory_movement_type" NOT NULL,
	"quantity_change" integer NOT NULL,
	"reference_type" "inventory_movement_reference_type" NOT NULL,
	"reference_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "inventory_movements_variant_idx" ON "inventory_movements" ("variant_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_type_idx" ON "inventory_movements" ("type");--> statement-breakpoint
CREATE INDEX "inventory_movements_reference_idx" ON "inventory_movements" ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_created_at_idx" ON "inventory_movements" ("created_at");--> statement-breakpoint
CREATE TABLE "financial_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"source" "sale_source" NOT NULL,
	"type" text NOT NULL,
	"amount_rupiah" bigint NOT NULL,
	"sale_date" timestamp with time zone NOT NULL,
	"period_month" date NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_transactions_type_enum" CHECK ("type" IN ('REVENUE','CASH_INFLOW'))
);
--> statement-breakpoint
CREATE INDEX "financial_transactions_sale_idx" ON "financial_transactions" ("sale_id");--> statement-breakpoint
CREATE INDEX "financial_transactions_source_idx" ON "financial_transactions" ("source");--> statement-breakpoint
CREATE INDEX "financial_transactions_type_idx" ON "financial_transactions" ("type");--> statement-breakpoint
CREATE INDEX "financial_transactions_period_idx" ON "financial_transactions" ("period_month");--> statement-breakpoint
CREATE INDEX "financial_transactions_created_at_idx" ON "financial_transactions" ("created_at");
