CREATE TYPE "public"."finance_direction" AS ENUM('INCOME', 'EXPENSE');--> statement-breakpoint
CREATE TYPE "public"."finance_status" AS ENUM('POSTED', 'VOIDED');--> statement-breakpoint
CREATE TYPE "public"."finance_category" AS ENUM('PRODUCT_SALES', 'OTHER_INCOME', 'PACKAGING', 'SUPPLIES', 'UTILITIES', 'RENT', 'SALARIES', 'MARKETING', 'TRANSPORT', 'MAINTENANCE', 'OTHER_EXPENSE', 'OPENING_BALANCE');--> statement-breakpoint
ALTER TABLE "financial_transactions" RENAME COLUMN "sale_date" TO "occurred_at";--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD COLUMN "direction" "public"."finance_direction" DEFAULT 'INCOME' NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD COLUMN "category" "public"."finance_category";--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD COLUMN "status" "public"."finance_status" DEFAULT 'POSTED' NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD COLUMN "voided_by_id" uuid REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD COLUMN "created_by" uuid REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
UPDATE "financial_transactions" SET "category" = 'PRODUCT_SALES' WHERE "category" IS NULL;--> statement-breakpoint
ALTER TABLE "financial_transactions" ALTER COLUMN "category" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_transactions" ALTER COLUMN "sale_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_transactions" DROP CONSTRAINT "financial_transactions_type_enum";--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_type_enum" CHECK ("type" IN ('REVENUE','CASH_INFLOW','MANUAL','OPENING_BALANCE'));--> statement-breakpoint
-- No double counting: the legacy second row per sale (cash tendered, including
-- change given back) is voided with a reason instead of being deleted.
UPDATE "financial_transactions"
SET "status" = 'VOIDED',
	"void_reason" = 'Superseded by the canonical sale income entry: one sale counts as income exactly once.',
	"voided_at" = now()
WHERE "type" = 'CASH_INFLOW' AND "status" = 'POSTED';--> statement-breakpoint
-- Keep only the earliest posted income row per sale, voiding any further copies.
WITH ranked AS (
	SELECT "id", row_number() OVER (PARTITION BY "sale_id" ORDER BY "created_at", "id") AS rank
	FROM "financial_transactions"
	WHERE "sale_id" IS NOT NULL AND "status" = 'POSTED' AND "direction" = 'INCOME'
)
UPDATE "financial_transactions" f
SET "status" = 'VOIDED',
	"void_reason" = 'Duplicate posted income for one sale; voided during the cash flow foundation migration.',
	"voided_at" = now()
FROM ranked r
WHERE f."id" = r."id" AND r.rank > 1;--> statement-breakpoint
-- Non-positive posted amounts are invalid ledger rows and must not survive.
UPDATE "financial_transactions"
SET "status" = 'VOIDED',
	"void_reason" = 'Non-positive amount voided during the cash flow foundation migration.',
	"voided_at" = now()
WHERE "status" = 'POSTED' AND "amount_rupiah" <= 0;--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_posted_amount_positive" CHECK ("status" = 'VOIDED' OR "amount_rupiah" > 0);--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_sale_reference" CHECK ("sale_id" IS NULL OR "source" <> 'MANUAL');--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_revenue_is_sale_income" CHECK ("type" <> 'REVENUE' OR ("sale_id" IS NOT NULL AND "direction" = 'INCOME' AND "source" <> 'MANUAL'));--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_void_fields" CHECK (("status" = 'POSTED' AND "void_reason" IS NULL AND "voided_at" IS NULL AND "voided_by_id" IS NULL) OR ("status" = 'VOIDED' AND "void_reason" IS NOT NULL AND "voided_at" IS NOT NULL));--> statement-breakpoint
CREATE UNIQUE INDEX "financial_transactions_posted_sale_income_uidx" ON "financial_transactions" USING btree ("sale_id") WHERE "status" = 'POSTED' AND "direction" = 'INCOME' AND "sale_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "financial_transactions_occurred_at_idx" ON "financial_transactions" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "financial_transactions_status_direction_idx" ON "financial_transactions" USING btree ("status","direction");
