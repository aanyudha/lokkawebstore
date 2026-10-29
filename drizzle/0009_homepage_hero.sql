CREATE TABLE "homepage_hero" (
  "id" text PRIMARY KEY NOT NULL,
  "storage_key" text NOT NULL,
  "source_storage_key" text NOT NULL,
  "source_format" text NOT NULL,
  "width" integer NOT NULL,
  "height" integer NOT NULL,
  "alt_text" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "homepage_hero_singleton" CHECK ("id" = 'homepage'),
  CONSTRAINT "homepage_hero_dimensions" CHECK ("width" > 0 AND "height" > 0)
);
