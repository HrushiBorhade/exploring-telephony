/**
 * OpenTelemetry instrumentation — loaded via --require BEFORE the app starts.
 *
 * Auto-instruments: Express HTTP, PostgreSQL (pg), Redis (ioredis), fetch.
 * Pino instrumentation injects trace_id + span_id into every log line.
 * Traces are exported via OTLP to the Grafana Alloy sidecar (localhost:4318).
 */
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";

const isProduction = process.env.NODE_ENV === "production";

const sdk = new NodeSDK({
  serviceName: "telephony-api",
  traceExporter: new OTLPTraceExporter({
    // In production: Alloy sidecar on localhost. In dev: no-op (no endpoint).
    url: isProduction
      ? "http://localhost:4318/v1/traces"
      : undefined,
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      // Reduce noise from filesystem operations
      "@opentelemetry/instrumentation-fs": { enabled: false },
      // Pino: injects trace_id and span_id into every log line
      "@opentelemetry/instrumentation-pino": { enabled: true },
    }),
  ],
});

sdk.start();

// Graceful shutdown
process.on("SIGTERM", () => sdk.shutdown());
process.on("SIGINT", () => sdk.shutdown());
