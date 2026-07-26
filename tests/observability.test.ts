import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const counter = { add: vi.fn() };
  const histogram = { record: vi.fn() };
  const span = {
    end: vi.fn(),
    recordException: vi.fn(),
    setAttribute: vi.fn(),
    setStatus: vi.fn(),
  };
  const sdk = {
    shutdown: vi.fn(async () => undefined),
    start: vi.fn(),
  };
  const sdkOptions: unknown[] = [];
  const metricExporters: unknown[] = [];
  const traceExporters: unknown[] = [];
  return { counter, histogram, metricExporters, sdk, sdkOptions, span, traceExporters };
});

vi.mock("@opentelemetry/api", () => ({
  SpanStatusCode: { ERROR: 2, OK: 1 },
  metrics: {
    getMeter: () => ({
      createCounter: () => mocks.counter,
      createHistogram: () => mocks.histogram,
    }),
  },
  trace: {
    getTracer: () => ({
      startSpan: () => mocks.span,
    }),
  },
}));

vi.mock("@opentelemetry/exporter-metrics-otlp-http", () => ({
  OTLPMetricExporter: class {
    public readonly options: unknown;
    constructor(options: unknown) {
      this.options = options;
      mocks.metricExporters.push(options);
    }
  },
}));

vi.mock("@opentelemetry/exporter-trace-otlp-http", () => ({
  OTLPTraceExporter: class {
    public readonly options: unknown;
    constructor(options: unknown) {
      this.options = options;
      mocks.traceExporters.push(options);
    }
  },
}));

vi.mock("@opentelemetry/sdk-metrics", () => ({
  PeriodicExportingMetricReader: class {
    constructor(public options: unknown) {}
  },
}));

vi.mock("@opentelemetry/resources", () => ({
  resourceFromAttributes: (attributes: unknown) => attributes,
}));

vi.mock("@opentelemetry/semantic-conventions", () => ({
  ATTR_SERVICE_NAME: "service.name",
  ATTR_SERVICE_VERSION: "service.version",
}));

vi.mock("@opentelemetry/sdk-node", () => ({
  NodeSDK: class {
    constructor(options: unknown) {
      mocks.sdkOptions.push(options);
    }
    start = mocks.sdk.start;
    shutdown = mocks.sdk.shutdown;
  },
}));

import { PlatformObservability } from "../src/application/observability.js";
import { createTelemetry } from "../src/infrastructure/observability/telemetry.js";
import { executionRecord } from "./helpers/records.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sdkOptions.length = 0;
  mocks.metricExporters.length = 0;
  mocks.traceExporters.length = 0;
});

describe("OpenTelemetry integration", () => {
  it("returns a no-op lifecycle when no collector is configured", async () => {
    const telemetry = createTelemetry("api");
    expect(telemetry.start()).toBeUndefined();
    await expect(telemetry.shutdown()).resolves.toBeUndefined();
    expect(mocks.sdkOptions).toHaveLength(0);
  });

  it("configures OTLP metrics and traces with normalized endpoints", async () => {
    const telemetry = createTelemetry("worker", "http://collector///");
    expect(mocks.metricExporters).toEqual([{ url: "http://collector/v1/metrics" }]);
    expect(mocks.traceExporters).toEqual([{ url: "http://collector/v1/traces" }]);
    expect(mocks.sdkOptions[0]).toMatchObject({
      resource: {
        "service.name": "browser-automation-worker",
        "service.version": "2.0.0",
      },
    });
    telemetry.start();
    expect(mocks.sdk.start).toHaveBeenCalled();
    await telemetry.shutdown();
    expect(mocks.sdk.shutdown).toHaveBeenCalled();
  });

  it("records job, outbox and successful execution signals", () => {
    const telemetry = new PlatformObservability();
    telemetry.jobSubmitted(true);
    telemetry.jobSubmitted(false);
    telemetry.outboxPublished("published");
    telemetry.outboxPublished("failed");
    telemetry.startExecution(executionRecord()).finish("passed", 25);
    expect(mocks.counter.add).toHaveBeenCalled();
    expect(mocks.histogram.record).toHaveBeenCalledWith(
      25,
      expect.objectContaining({ "browser.driver": "playwright" }),
    );
    expect(mocks.span.setStatus).toHaveBeenCalledWith({ code: 1 });
    expect(mocks.span.end).toHaveBeenCalled();
  });

  it("records Error and non-Error execution failures", () => {
    const telemetry = new PlatformObservability();
    telemetry.startExecution(executionRecord()).finish("failed", 10, new Error("lost"));
    expect(mocks.span.recordException).toHaveBeenCalledWith(expect.any(Error));
    expect(mocks.span.setStatus).toHaveBeenCalledWith({ code: 2, message: "lost" });
    telemetry.startExecution(executionRecord()).finish("canceled", 5, { reason: "cancelled" });
    expect(mocks.span.recordException).toHaveBeenLastCalledWith('{"reason":"cancelled"}');
    expect(mocks.span.setStatus).toHaveBeenLastCalledWith({ code: 2 });
    telemetry.startExecution(executionRecord()).finish("passed", 1, new Error("late close"));
    expect(mocks.span.setStatus).toHaveBeenLastCalledWith({
      code: 1,
      message: "late close",
    });
  });
});
