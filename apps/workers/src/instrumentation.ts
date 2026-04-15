/**
 * OpenTelemetry instrumentation for the audio processing worker.
 *
 * Auto-instruments: PostgreSQL (pg), Redis (ioredis), fetch (Deepgram, Gemini, S3).
 * Pino instrumentation injects trace_id + span_id into every log line.
 * Traces exported via OTLP to the Grafana Alloy sidecar (localhost:4318).
 */
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";

const isProduction = process.env.NODE_ENV === "production";

const sdk = new NodeSDK({
  serviceName: "audio-worker",
  traceExporter: new OTLPTraceExporter({
    url: isProduction
      ? "http://localhost:4318/v1/traces"
      : undefined,
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-fs": { enabled: false },
      "@opentelemetry/instrumentation-pino": { enabled: true },
    }),
  ],
});

sdk.start();

process.on("SIGTERM", () => sdk.shutdown());
process.on("SIGINT", () => sdk.shutdown());
