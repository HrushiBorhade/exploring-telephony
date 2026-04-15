import { Registry, collectDefaultMetrics, Histogram, Counter, Gauge } from "prom-client";
import http from "node:http";

export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: "worker_" });

export const jobDuration = new Histogram({
  name: "worker_job_duration_seconds",
  help: "Total job processing duration",
  labelNames: ["queue", "status"] as const,
  buckets: [10, 30, 60, 120, 300, 600],
  registers: [registry],
});

export const stepDuration = new Histogram({
  name: "worker_step_duration_seconds",
  help: "Individual pipeline step duration",
  labelNames: ["step"] as const,
  buckets: [1, 5, 10, 30, 60, 120],
  registers: [registry],
});

export const jobsTotal = new Counter({
  name: "worker_jobs_total",
  help: "Total jobs processed",
  labelNames: ["queue", "status"] as const,
  registers: [registry],
});

export const queueDepth = new Gauge({
  name: "worker_queue_depth",
  help: "Current queue depth from worker perspective",
  labelNames: ["queue", "state"] as const,
  registers: [registry],
});

// Lightweight HTTP server for Alloy to scrape
export function startMetricsServer(port = 9090) {
  const server = http.createServer(async (req, res) => {
    if (req.url === "/metrics") {
      res.setHeader("Content-Type", registry.contentType);
      res.end(await registry.metrics());
    } else {
      res.statusCode = 404;
      res.end("Not found");
    }
  });
  server.listen(port, () => {
    console.log(`Worker metrics server on :${port}/metrics`);
  });
  return server;
}
