import { z } from "zod";
import { logger } from "./logger";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.coerce.number().default(6379),
  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"),
  DEEPGRAM_API_KEY: z.string().optional(),
  S3_ACCESS_KEY: z.string().min(1, "S3_ACCESS_KEY is required"),
  S3_SECRET_KEY: z.string().min(1, "S3_SECRET_KEY is required"),
  S3_BUCKET: z.string().min(1, "S3_BUCKET is required"),
  S3_REGION: z.string().default("ap-south-1"),
  S3_ENDPOINT: z.string().url("S3_ENDPOINT must be a valid URL").optional(),
  S3_PUBLIC_URL: z.string().url("S3_PUBLIC_URL must be a valid URL").optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
});

function validateEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    logger.fatal({ errors }, "Invalid environment variables");
    process.exit(1);
  }
  return result.data;
}

export const env = validateEnv();
