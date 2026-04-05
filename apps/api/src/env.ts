import { z } from "zod";
import { logger } from "./logger";

const envSchema = z.object({
  LIVEKIT_URL: z.string().url("LIVEKIT_URL must be a valid URL"),
  LIVEKIT_API_KEY: z.string().min(1, "LIVEKIT_API_KEY is required"),
  LIVEKIT_API_SECRET: z.string().min(1, "LIVEKIT_API_SECRET is required"),
  LIVEKIT_SIP_TRUNK_ID: z.string().startsWith("ST_", "LIVEKIT_SIP_TRUNK_ID must start with ST_"),
  S3_ACCESS_KEY: z.string().min(1, "S3_ACCESS_KEY is required"),
  S3_SECRET_KEY: z.string().min(1, "S3_SECRET_KEY is required"),
  S3_BUCKET: z.string().min(1, "S3_BUCKET is required"),
  S3_REGION: z.string().default("us-east-1"),
  S3_ENDPOINT: z.string().url("S3_ENDPOINT must be a valid URL").optional(),
  S3_PUBLIC_URL: z.string().url("S3_PUBLIC_URL must be a valid URL").optional(),
  DATABASE_URL: z.string().startsWith("postgresql://", "DATABASE_URL must be a PostgreSQL URL"),
  FRONTEND_URL: z.string().url("FRONTEND_URL must be a valid URL").optional(),
  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.coerce.number().default(6379),
  PORT: z.coerce.number().default(8080),
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
