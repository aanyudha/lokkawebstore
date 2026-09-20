ALTER TABLE "product_images" ADD COLUMN "source_storage_key" text;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "source_format" text;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "source_mime_type" text;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "source_width" integer;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "source_height" integer;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "source_size_bytes" bigint;
