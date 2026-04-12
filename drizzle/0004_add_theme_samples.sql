-- Create theme_samples table
CREATE TABLE IF NOT EXISTS "theme_samples" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" varchar(30) NOT NULL,
	"language" varchar(20) NOT NULL,
	"data" text NOT NULL,
	"status" varchar(20) DEFAULT 'available' NOT NULL,
	"assigned_capture_id" varchar(12),
	"assigned_at" timestamp with time zone,
	"public_token" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "theme_samples_public_token_unique" UNIQUE("public_token")
);
--> statement-breakpoint

-- Add theme_sample_id column to captures_v2
ALTER TABLE "captures_v2" ADD COLUMN "theme_sample_id" integer;
--> statement-breakpoint

-- Foreign key: captures_v2.theme_sample_id -> theme_samples.id
ALTER TABLE "captures_v2" ADD CONSTRAINT "captures_v2_theme_sample_id_theme_samples_id_fk" FOREIGN KEY ("theme_sample_id") REFERENCES "public"."theme_samples"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

-- Foreign key: theme_samples.assigned_capture_id -> captures_v2.id
ALTER TABLE "theme_samples" ADD CONSTRAINT "theme_samples_assigned_capture_id_captures_v2_id_fk" FOREIGN KEY ("assigned_capture_id") REFERENCES "public"."captures_v2"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

-- Indexes on theme_samples
CREATE INDEX IF NOT EXISTS "theme_samples_status_language_idx" ON "theme_samples" USING btree ("status","language");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "theme_samples_public_token_idx" ON "theme_samples" USING btree ("public_token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "theme_samples_assigned_capture_idx" ON "theme_samples" USING btree ("assigned_capture_id");
--> statement-breakpoint

-- Index on captures_v2 for theme_sample_id
CREATE INDEX IF NOT EXISTS "captures_theme_sample_idx" ON "captures_v2" USING btree ("theme_sample_id");
