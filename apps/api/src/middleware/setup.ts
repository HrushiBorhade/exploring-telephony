import express, { type Express } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "../env";
import { requestIdMiddleware } from "./request-id";
import { metricsMiddleware } from "./metrics";

const ALLOWED_ORIGINS = env.NODE_ENV === "production"
  ? [env.FRONTEND_URL].filter((v): v is string => !!v)
  : ["http://localhost:3000", "http://localhost:8080", "http://localhost:3002"];

export function setupMiddleware(app: Express) {
  // Prometheus HTTP request metrics (must be first to capture all requests)
  app.use(metricsMiddleware);

  // Trust ALB/reverse proxy (required for correct client IP in rate limiting)
  app.set("trust proxy", 1);

  // Assign request ID + child logger to every request
  app.use(requestIdMiddleware);

  // Security headers
  app.use(helmet({ contentSecurityPolicy: false }));

  // CORS
  app.use((_req, res, next) => {
    const origin = _req.headers.origin || "";
    if (ALLOWED_ORIGINS.includes(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Access-Control-Allow-Credentials", "true");
    }
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE");
    if (_req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });

  // Rate limiting (uses real client IP via trust proxy)
  app.use("/api/", rateLimit({
    windowMs: 60_000,
    max: env.NODE_ENV === "production" ? 60 : 1000,
    message: { error: "Too many requests" },
    standardHeaders: true,
    legacyHeaders: false,
  }));

  // Parse JSON for all routes except webhook (needs raw body)
  app.use((req, res, next) => {
    if (req.path === "/livekit/webhook") {
      express.raw({ type: "application/webhook+json", limit: "1mb" })(req, res, next);
    } else {
      express.json({ limit: "1mb" })(req, res, next);
    }
  });
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));

}
