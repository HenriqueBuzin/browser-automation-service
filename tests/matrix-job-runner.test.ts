import { describe, expect, it, vi } from "vitest";
import { LeaseManager } from "../src/application/lease-manager.js";
import { MatrixJobRunner } from "../src/application/matrix-job-runner.js";
import { Metrics } from "../src/application/metrics.js";
import { ProviderRegistry } from "../src/application/provider-registry.js";
import { SessionConnectorRegistry } from "../src/application/session-connector-registry.js";
import type { AutomationBrowser, AutomationProvider } from "../src/domain/automation-provider.js";
import type { AutomationJob } from "../src/domain/automation-job.js";
import { fakeSession } from "./helpers/fake-session.js";

function harness(fail = false) {
  const provider: AutomationProvider = {
    browsers: ["chromium", "firefox"],
    engine: "playwright",
    launch: vi.fn(async (_leaseId: string, browser: AutomationBrowser) => ({
      browser,
      close: vi.fn(async () => undefined),
      endpoint: `ws://browser/${browser}`,
      engine: "playwright" as const,
      onClose: vi.fn(),
      protocol: "playwright" as const,
    })),
  };
  const providers = new ProviderRegistry([provider]);
  const manager = new LeaseManager(providers, {
    connectionTimeoutMs: 10_000,
    maxConcurrent: 2,
    maxLeaseDurationMs: 60_000,
    maxQueueSize: 4,
    metrics: new Metrics(),
  });
  const connectors = new SessionConnectorRegistry(
    provider.browsers.map((browser) => ({
      browser,
      connect: vi.fn(async () =>
        fakeSession(
          fail
            ? {
                wait: vi.fn(async () => {
                  throw new Error("execution failed");
                }),
              }
            : {},
        ),
      ),
      driver: "playwright" as const,
    })),
  );
  const runner = new MatrixJobRunner(providers, connectors, manager, {
    maxParallelism: 2,
    queueWaitMs: 1_000,
  });
  return { manager, runner };
}

const baseJob: AutomationJob = {
  clientId: "matrix-test",
  schemaVersion: 1,
  steps: [{ action: "wait", durationMs: 1 }],
};

describe("MatrixJobRunner", () => {
  it("runs every supported combination when filters are omitted", async () => {
    const { manager, runner } = harness();
    const result = await runner.run(baseJob);
    expect(result.status).toBe("passed");
    expect(
      result.executions.map(({ browser, driver, status }) => ({ browser, driver, status })),
    ).toEqual([
      { browser: "chromium", driver: "playwright", status: "passed" },
      { browser: "firefox", driver: "playwright", status: "passed" },
    ]);
    expect(manager.activeCount).toBe(0);
  });

  it("runs all browsers for a selected driver", () => {
    const { runner } = harness();
    expect(runner.plan({ ...baseJob, drivers: ["playwright"] })).toEqual([
      { browser: "chromium", engine: "playwright", supported: true },
      { browser: "firefox", engine: "playwright", supported: true },
    ]);
  });

  it("reports impossible requested combinations as unsupported", async () => {
    const { runner } = harness();
    const result = await runner.run({
      ...baseJob,
      browsers: ["webkit"],
      drivers: ["playwright"],
    });
    expect(result.status).toBe("partial");
    expect(result.executions[0]).toMatchObject({
      browser: "webkit",
      driver: "playwright",
      status: "unsupported",
    });
  });

  it("isolates failures per matrix combination", async () => {
    const { manager, runner } = harness(true);
    const result = await runner.run(baseJob);
    expect(result.status).toBe("failed");
    expect(result.executions.every((execution) => execution.status === "failed")).toBe(true);
    expect(manager.activeCount).toBe(0);
  });
});
