ALTER TABLE "product_images" ADD COLUMN "source_storage_key" text;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "source_format" text;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "source_mime_type" text;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "source_width" integer;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "source_height" integer;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "source_size_bytes" bigint;--> statement-breakpoint
CREATE TABLE "product_showcases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_showcases_product_id_unique" UNIQUE("product_id")
);
--> statement-breakpoint
CREATE TABLE "product_showcase_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"showcase_id" uuid NOT NULL,
	"product_image_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_cover" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "showcase_images_unique_image" UNIQUE("showcase_id","product_image_id")
);
--> statement-breakpoint
ALTER TABLE "product_showcases" ADD CONSTRAINT "product_showcases_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_showcase_images" ADD CONSTRAINT "product_showcase_images_showcase_id_product_showcases_id_fk" FOREIGN KEY ("showcase_id") REFERENCES "public"."product_showcases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_showcase_images" ADD CONSTRAINT "product_showcase_images_product_image_id_product_images_id_fk" FOREIGN KEY ("product_image_id") REFERENCES "public"."product_images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "showcase_images_showcase_idx" ON "product_showcase_images" USING btree ("showcase_id");--> statement-breakpoint
CREATE UNIQUE INDEX "showcase_one_cover" ON "product_showcase_images" USING btree ("showcase_id") WHERE "is_cover" = true;
