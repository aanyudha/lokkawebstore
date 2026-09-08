CREATE TABLE "category_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"short_description" text,
	"seo_title" text,
	"seo_description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"short_description" text,
	"description" text,
	"seo_title" text,
	"seo_description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "category_translations" ADD CONSTRAINT "category_translations_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_translations" ADD CONSTRAINT "product_translations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "category_translations_category_locale_idx" ON "category_translations" USING btree ("category_id","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "category_translations_locale_slug_idx" ON "category_translations" USING btree ("locale","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "product_translations_product_locale_idx" ON "product_translations" USING btree ("product_id","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "product_translations_locale_slug_idx" ON "product_translations" USING btree ("locale","slug");