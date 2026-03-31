import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";

const isEnabled = !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

let sdk: NodeSDK | null = null;

export function initTelemetry() {
  if (!isEnabled) return;

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "telephony-api",
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? "1.0.0",
    }),
    spanProcessor: new SimpleSpanProcessor(
      new OTLPTraceExporter({
        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
      })
    ),
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-http": { enabled: true },
        "@opentelemetry/instrumentation-express": { enabled: true },
        "@opentelemetry/instrumentation-pg": { enabled: true },
        "@opentelemetry/instrumentation-fs": { enabled: false }, // too noisy
      }),
    ],
  });

  sdk.start();
  console.log("[OTEL] Tracing initialized →", process.env.OTEL_EXPORTER_OTLP_ENDPOINT);
}

export function shutdownTelemetry() {
  return sdk?.shutdown() ?? Promise.resolve();
}
