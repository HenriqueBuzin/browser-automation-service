import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { LeaseManager } from "../src/application/lease-manager.js";
import { Metrics } from "../src/application/metrics.js";
import { ProviderRegistry } from "../src/application/provider-registry.js";
import type { AppConfig } from "../src/config.js";
import type { AutomationProvider } from "../src/domain/automation-provider.js";
import { ApiKeyAuthenticator } from "../src/infrastructure/auth/api-key-authenticator.js";
import { buildServer } from "../src/interfaces/http-server.js";

const apiKey = "w".repeat(32);
const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.allSettled(cleanup.splice(0).map(async (close) => close()));
});

describe("WebSocket relay", () => {
  it("authenticates a lease and relays frames in both directions", async () => {
    const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await once(upstream, "listening");
    const upstreamPort = (upstream.address() as AddressInfo).port;
    upstream.on("connection", (socket) => {
      socket.on("message", (data, binary) => socket.send(data, { binary }));
    });

    const provider: AutomationProvider = {
      engine: "playwright",
      launch: vi.fn(async () => ({
        close: async () => undefined,
        endpoint: `ws://127.0.0.1:${String(upstreamPort)}`,
        engine: "playwright" as const,
        onClose: vi.fn(),
        protocol: "playwright" as const,
      })),
    };
    const providers = new ProviderRegistry([provider]);
    const metrics = new Metrics();
    const manager = new LeaseManager(providers, {
      connectionTimeoutMs: 10_000,
      maxConcurrent: 1,
      maxLeaseDurationMs: 60_000,
      maxQueueSize: 1,
      metrics,
    });
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
      port: 0,
      publicWsUrl: undefined,
      seleniumRemoteUrl: undefined,
      shutdownTimeoutMs: 10_000,
    };
    const authenticator = new ApiKeyAuthenticator(apiKey);
    const app = buildServer({
      authenticator,
      config,
      leaseManager: manager,
      metrics,
      metricsAuthenticator: authenticator,
      providers,
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const servicePort = (app.server.address() as AddressInfo).port;

    cleanup.push(
      async () => {
        await app.close();
        await manager.shutdown();
      },
      async () => {
        await new Promise<void>((resolve) => upstream.close(() => resolve()));
      },
    );

    const response = await fetch(`http://127.0.0.1:${String(servicePort)}/v1/leases`, {
      body: JSON.stringify({ clientId: "relay-test", engine: "playwright" }),
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { connection: { endpoint: string } };
    const client = new WebSocket(body.connection.endpoint);
    await once(client, "open");
    client.send("ping");
    const [message] = (await once(client, "message")) as [Buffer];
    expect(message.toString()).toBe("ping");
    client.close();
    await once(client, "close");
    await vi.waitFor(() => expect(manager.activeCount).toBe(0));
  });
});
