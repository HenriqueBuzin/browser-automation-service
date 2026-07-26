import { describe, expect, it, vi } from "vitest";
import { LeaseManager } from "../src/application/lease-manager.js";
import { Metrics } from "../src/application/metrics.js";
import { ProviderRegistry } from "../src/application/provider-registry.js";
import type { AutomationProvider, ProviderSession } from "../src/domain/automation-provider.js";
import {
  CapacityError,
  InvalidLeaseTokenError,
  LeaseStateError,
  QueueFullError,
  QueueTimeoutError,
} from "../src/domain/errors.js";

function harness(maxConcurrent = 1, maxQueueSize = 2) {
  const close = vi.fn(async () => undefined);
  let closeListener = (): void => undefined;
  const browser: ProviderSession = {
    close,
    endpoint: "ws://127.0.0.1:4567/browser",
    engine: "playwright",
    onClose: (listener) => {
      closeListener = listener;
    },
    protocol: "playwright",
  };
  const launcher: AutomationProvider = {
    engine: "playwright",
    launch: vi.fn(async () => browser),
  };
  const metrics = new Metrics();
  const manager = new LeaseManager(new ProviderRegistry([launcher]), {
    connectionTimeoutMs: 10_000,
    maxLeaseDurationMs: 60_000,
    maxConcurrent,
    maxQueueSize,
    metrics,
  });
  return { browser, close, closeBrowser: () => closeListener(), launcher, manager, metrics };
}

describe("LeaseManager", () => {
  it("grants, connects and releases an isolated browser", async () => {
    const { close, manager } = harness();
    const lease = await manager.request("client-one", "playwright", 0);
    expect(manager.activeCount).toBe(1);
    expect(manager.connect(lease.id, lease.token).wsEndpoint).toContain("4567");
    manager.markConnected(lease.id);
    await expect(manager.release(lease.id)).resolves.toBe(true);
    expect(close).toHaveBeenCalledOnce();
    expect(manager.activeCount).toBe(0);
  });

  it("rejects invalid tokens and repeated connections", async () => {
    const { manager } = harness();
    const lease = await manager.request("client-one", "playwright", 0);
    expect(() => manager.connect(lease.id, "wrong")).toThrow(InvalidLeaseTokenError);
    manager.connect(lease.id, lease.token);
    expect(() => manager.connect(lease.id, lease.token)).toThrow(LeaseStateError);
    await manager.shutdown();
  });

  it("queues FIFO and allocates when capacity is released", async () => {
    const { manager } = harness();
    const first = await manager.request("first", "playwright", 0);
    const secondPromise = manager.request("second", "playwright", 1_000);
    expect(manager.queuedCount).toBe(1);
    await manager.release(first.id);
    const second = await secondPromise;
    expect(second.id).not.toBe(first.id);
    await manager.shutdown();
  });

  it("rejects immediate and over-capacity queue requests", async () => {
    const { manager } = harness(1, 0);
    await manager.request("first", "playwright", 0);
    await expect(manager.request("second", "playwright", 0)).rejects.toBeInstanceOf(CapacityError);
    await expect(manager.request("second", "playwright", 100)).rejects.toBeInstanceOf(
      QueueFullError,
    );
    await manager.shutdown();
  });

  it("times out a queued request", async () => {
    vi.useFakeTimers();
    const { manager } = harness();
    await manager.request("first", "playwright", 0);
    const waiting = manager.request("second", "playwright", 100);
    const expectation = expect(waiting).rejects.toBeInstanceOf(QueueTimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await expectation;
    await manager.shutdown();
    vi.useRealTimers();
  });

  it("releases the lease when the browser exits", async () => {
    const { closeBrowser, manager } = harness();
    await manager.request("client-one", "playwright", 0);
    closeBrowser();
    await vi.waitFor(() => expect(manager.activeCount).toBe(0));
  });

  it("frees capacity after a launch failure", async () => {
    const launcher: AutomationProvider = {
      engine: "playwright",
      launch: vi.fn().mockRejectedValueOnce(new Error("launch failed")),
    };
    const manager = new LeaseManager(new ProviderRegistry([launcher]), {
      connectionTimeoutMs: 10_000,
      maxLeaseDurationMs: 60_000,
      maxConcurrent: 1,
      maxQueueSize: 1,
      metrics: new Metrics(),
    });
    await expect(manager.request("client-one", "playwright", 0)).rejects.toThrow("launch failed");
    expect(manager.activeCount).toBe(0);
  });

  it("returns a direct endpoint for a WebDriver provider", async () => {
    const selenium: AutomationProvider = {
      engine: "selenium",
      launch: vi.fn(async () => ({
        close: vi.fn(async () => undefined),
        endpoint: "http://selenium:4444/wd/hub",
        engine: "selenium" as const,
        onClose: vi.fn(),
        protocol: "webdriver" as const,
      })),
    };
    const manager = new LeaseManager(new ProviderRegistry([selenium]), {
      connectionTimeoutMs: 10_000,
      maxConcurrent: 1,
      maxLeaseDurationMs: 60_000,
      maxQueueSize: 1,
      metrics: new Metrics(),
    });
    const lease = await manager.request("selenium-client", "selenium", 0);
    expect(lease).toMatchObject({
      directEndpoint: "http://selenium:4444/wd/hub",
      engine: "selenium",
      protocol: "webdriver",
    });
    expect(() => manager.connect(lease.id, lease.token)).toThrow(LeaseStateError);
    await manager.shutdown();
  });
});
