import { Histogram, Counter } from "prom-client";
import { registry } from "../metrics";
import type { Request, Response, NextFunction } from "express";

const httpRequestDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [registry],
});

const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status_code"] as const,
  registers: [registry],
});

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const end = httpRequestDuration.startTimer();
  res.on("finish", () => {
    const route = req.route?.path || req.path;
    const labels = { method: req.method, route, status_code: res.statusCode };
    end(labels);
    httpRequestsTotal.inc(labels);
  });
  next();
}
