import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

export type Telemetry = {
  shutdown: () => Promise<void>;
  start: () => void;
};

export function createTelemetry(role: string, endpoint?: string): Telemetry {
  if (!endpoint) {
    return {
      shutdown: () => Promise.resolve(),
      start: () => undefined,
    };
  }
  const sdk = new NodeSDK({
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${endpoint.replace(/\/+$/u, "")}/v1/metrics`,
      }),
      exportIntervalMillis: 10_000,
    }),
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: `browser-automation-${role}`,
      [ATTR_SERVICE_VERSION]: "2.0.0",
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${endpoint.replace(/\/+$/u, "")}/v1/traces`,
    }),
  });
  return {
    shutdown: () => sdk.shutdown(),
    start: () => sdk.start(),
  };
}
