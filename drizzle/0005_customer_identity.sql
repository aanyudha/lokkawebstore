CREATE TYPE "public"."customer_status" AS ENUM('ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TABLE "customer_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"csrf_token_hash" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_normalized" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"status" "customer_status" DEFAULT 'ACTIVE' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_name_present" CHECK (length(btrim("customers"."name")) > 0),
	CONSTRAINT "customer_email_normalized_lower" CHECK ("customers"."email_normalized" = lower(btrim("customers"."email_normalized")))
);
--> statement-breakpoint
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_email_normalized_unique" ON "customers" USING btree ("email_normalized");--> statement-breakpoint
CREATE INDEX "customer_sessions_expiration_idx" ON "customer_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "customer_sessions_customer_idx" ON "customer_sessions" USING btree ("customer_id");
