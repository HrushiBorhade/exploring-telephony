import express, { type Express } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "../env";

const ALLOWED_ORIGINS = env.NODE_ENV === "production"
  ? [process.env.FRONTEND_URL || ""].filter(Boolean)
  : ["http://localhost:3000", "http://localhost:3001", "http://localhost:3002"];

export function setupMiddleware(app: Express) {
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
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
    if (_req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });

  // Rate limiting
  app.use("/api/", rateLimit({
    windowMs: 60_000,
    max: env.NODE_ENV === "production" ? 60 : 1000,
    message: { error: "Too many requests" },
  }));

  // Parse JSON for all routes except webhook (needs raw body)
  app.use((req, res, next) => {
    if (req.path === "/livekit/webhook") {
      express.raw({ type: "application/webhook+json" })(req, res, next);
    } else {
      express.json()(req, res, next);
    }
  });
  app.use(express.urlencoded({ extended: true }));
}
