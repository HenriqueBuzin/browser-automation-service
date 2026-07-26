import { afterEach, describe, expect, it, vi } from "vitest";
import { LeaseManager } from "../src/application/lease-manager.js";
import { Metrics } from "../src/application/metrics.js";
import { ProviderRegistry } from "../src/application/provider-registry.js";
import type { AppConfig } from "../src/config.js";
import type { AutomationProvider } from "../src/domain/automation-provider.js";
import { ApiKeyAuthenticator } from "../src/infrastructure/auth/api-key-authenticator.js";
import { buildServer } from "../src/interfaces/http-server.js";

const apiKey = "a".repeat(32);
const config: AppConfig = {
  apiKey,
  host: "127.0.0.1",
  leaseConnectTimeoutMs: 10_000,
  logLevel: "silent",
  maxConcurrentBrowsers: 1,
  maxLeaseDurationMs: 60_000,
  maxQueueSize: 1,
  maxQueueWaitMs: 1_000,
  metricsApiKey: apiKey,
  port: 3_000,
  publicWsUrl: "ws://browser-service:3000",
  seleniumRemoteUrl: undefined,
  shutdownTimeoutMs: 10_000,
};

function createApp() {
  const launcher: AutomationProvider = {
    engine: "playwright",
    launch: vi.fn(async () => ({
      close: vi.fn(async () => undefined),
      endpoint: "ws://127.0.0.1:9999/browser",
      engine: "playwright" as const,
      onClose: vi.fn(),
      protocol: "playwright" as const,
    })),
  };
  const providers = new ProviderRegistry([launcher]);
  const authenticator = new ApiKeyAuthenticator(apiKey);
  const metrics = new Metrics();
  const manager = new LeaseManager(providers, {
    connectionTimeoutMs: config.leaseConnectTimeoutMs,
    maxLeaseDurationMs: config.maxLeaseDurationMs,
    maxConcurrent: config.maxConcurrentBrowsers,
    maxQueueSize: config.maxQueueSize,
    metrics,
  });
  const app = buildServer({
    authenticator,
    config,
    leaseManager: manager,
    metrics,
    metricsAuthenticator: authenticator,
    providers,
  });
  return { app, manager };
}

const apps: ReturnType<typeof createApp>[] = [];
afterEach(async () => {
  await Promise.all(
    apps.splice(0).map(async ({ app, manager }) => {
      await app.close();
      await manager.shutdown();
    }),
  );
});

describe("HTTP server", () => {
  it("serves public health endpoints", async () => {
    const state = createApp();
    apps.push(state);
    expect((await state.app.inject({ method: "GET", url: "/health/live" })).statusCode).toBe(200);
    expect((await state.app.inject({ method: "GET", url: "/health/ready" })).json()).toEqual({
      status: "ready",
    });
  });

  it("requires authentication for leases and metrics", async () => {
    const state = createApp();
    apps.push(state);
    expect(
      (
        await state.app.inject({
          method: "POST",
          url: "/v1/leases",
          payload: { clientId: "consumer", engine: "playwright" },
        })
      ).statusCode,
    ).toBe(401);
    expect((await state.app.inject({ method: "GET", url: "/metrics" })).statusCode).toBe(401);
  });

  it("lists only configured engines", async () => {
    const state = createApp();
    apps.push(state);
    const response = await state.app.inject({
      method: "GET",
      url: "/v1/engines",
      headers: { authorization: `Bearer ${apiKey}` },
    });
    expect(response.json()).toEqual({ engines: ["playwright"] });
  });

  it("creates and deletes a lease", async () => {
    const state = createApp();
    apps.push(state);
    const created = await state.app.inject({
      method: "POST",
      url: "/v1/leases",
      headers: { authorization: `Bearer ${apiKey}` },
      payload: { clientId: "consumer", engine: "playwright", waitTimeoutMs: 0 },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json<{
      leaseId: string;
      connection: { endpoint: string; protocol: string };
      leaseToken: string;
      versions: { playwright: string };
    }>();
    expect(body.versions.playwright).toBe("1.61.1");
    expect(body.connection.endpoint).toContain("ws://browser-service:3000/v1/leases/");
    const deleted = await state.app.inject({
      method: "DELETE",
      url: `/v1/leases/${body.leaseId}?token=${encodeURIComponent(body.leaseToken)}`,
      headers: { "x-api-key": apiKey },
    });
    expect(deleted.statusCode).toBe(204);
  });

  it("validates lease input", async () => {
    const state = createApp();
    apps.push(state);
    const response = await state.app.inject({
      method: "POST",
      url: "/v1/leases",
      headers: { "x-api-key": apiKey },
      payload: { clientId: "!", engine: "playwright", waitTimeoutMs: 2_000 },
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects a valid engine when its provider is disabled", async () => {
    const state = createApp();
    apps.push(state);
    const response = await state.app.inject({
      method: "POST",
      url: "/v1/leases",
      headers: { "x-api-key": apiKey },
      payload: { clientId: "consumer", engine: "selenium" },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json<{ error: string }>().error).toContain("not available");
  });

  it("returns 429 when immediate capacity is exhausted", async () => {
    const state = createApp();
    apps.push(state);
    const headers = { "x-api-key": apiKey };
    const payload = { clientId: "consumer", engine: "playwright" };
    expect(
      (await state.app.inject({ method: "POST", url: "/v1/leases", headers, payload })).statusCode,
    ).toBe(201);
    const rejected = await state.app.inject({
      method: "POST",
      url: "/v1/leases",
      headers,
      payload,
    });
    expect(rejected.statusCode).toBe(429);
    expect(rejected.headers["retry-after"]).toBe("1");
  });

  it("rejects missing and invalid tokens on deletion", async () => {
    const state = createApp();
    apps.push(state);
    const created = await state.app.inject({
      method: "POST",
      url: "/v1/leases",
      headers: { "x-api-key": apiKey },
      payload: { clientId: "consumer", engine: "playwright" },
    });
    const leaseId = created.json<{ leaseId: string }>().leaseId;
    expect(
      (
        await state.app.inject({
          method: "DELETE",
          url: `/v1/leases/${leaseId}`,
          headers: { "x-api-key": apiKey },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await state.app.inject({
          method: "DELETE",
          url: `/v1/leases/${leaseId}?token=wrong`,
          headers: { "x-api-key": apiKey },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("returns metrics in Prometheus format", async () => {
    const state = createApp();
    apps.push(state);
    const response = await state.app.inject({
      method: "GET",
      url: "/metrics",
      headers: { "x-api-key": apiKey },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("browser_active_leases");
  });
});
