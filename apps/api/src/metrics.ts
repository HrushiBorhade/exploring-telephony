import { collectDefaultMetrics, Registry, Counter, Histogram, Gauge } from "prom-client";

export const registry = new Registry();

// Collect default Node.js metrics (memory, CPU, event loop, etc.)
collectDefaultMetrics({ register: registry });

export const captureTotal = new Counter({
  name: "capture_total",
  help: "Total number of captures created",
  registers: [registry],
});

export const captureActiveGauge = new Gauge({
  name: "capture_active",
  help: "Number of currently active captures",
  registers: [registry],
});

export const callDurationHistogram = new Histogram({
  name: "call_duration_seconds",
  help: "Duration of calls in seconds",
  buckets: [10, 30, 60, 120, 300, 600],
  registers: [registry],
});

export const egressSuccessTotal = new Counter({
  name: "egress_success_total",
  help: "Total successful egress completions",
  labelNames: ["type"] as const, // mixed, caller_a, caller_b
  registers: [registry],
});

export const egressFailureTotal = new Counter({
  name: "egress_failure_total",
  help: "Total failed egress starts",
  registers: [registry],
});

export const webhookDurationHistogram = new Histogram({
  name: "webhook_duration_ms",
  help: "LiveKit webhook processing time in milliseconds",
  labelNames: ["event"] as const,
  buckets: [5, 10, 50, 100, 500, 1000],
  registers: [registry],
});
