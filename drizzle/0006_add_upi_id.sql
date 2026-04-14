-- Add UPI ID column to user_profiles (nullable for existing users)
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "upi_id" text;
