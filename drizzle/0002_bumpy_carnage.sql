ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "impersonated_by" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'user';--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "banned" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "ban_reason" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "ban_expires" integer;