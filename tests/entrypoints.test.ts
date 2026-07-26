import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  close: vi.fn(async () => undefined),
  shutdown: vi.fn(async () => undefined),
  start: vi.fn(),
  startPlatform: vi.fn(async () => ({ close: mocks.close })),
}));

vi.mock("../src/config.js", () => ({
  loadConfig: () => ({ appRole: "api", otelEndpoint: "http://collector" }),
}));
vi.mock("../src/platform.js", () => ({
  startPlatform: mocks.startPlatform,
}));
vi.mock("../src/infrastructure/observability/telemetry.js", () => ({
  createTelemetry: () => ({
    shutdown: mocks.shutdown,
    start: mocks.start,
  }),
}));

afterEach(() => {
  process.exitCode = undefined;
  vi.unstubAllGlobals();
});

describe("process entrypoints", () => {
  it("starts and gracefully closes the platform on SIGTERM", async () => {
    const imported = import("../src/main.js");
    await vi.waitFor(() => expect(mocks.startPlatform).toHaveBeenCalled());
    process.emit("SIGTERM");
    await imported;
    expect(mocks.start).toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalled();
    expect(mocks.shutdown).toHaveBeenCalled();
  });

  it("keeps the healthcheck successful on a ready response", async () => {
    vi.resetModules();
    process.env.PORT = "3210";
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await import("../src/healthcheck.js");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3210/health/ready",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("marks an unready default-port healthcheck as failed", async () => {
    vi.resetModules();
    delete process.env.PORT;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false })),
    );
    await import("../src/healthcheck.js");
    expect(process.exitCode).toBe(1);
  });
});
