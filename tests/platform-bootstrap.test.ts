import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const pool = {
    end: vi.fn(async () => undefined),
    query: vi.fn(async () => ({ rows: [{ ready: 1 }] })),
  };
  const queue = {
    close: vi.fn(async () => undefined),
    ready: vi.fn(async () => true),
  };
  const server = {
    close: vi.fn(async () => undefined),
    listen: vi.fn(async () => undefined),
  };
  const worker = {
    close: vi.fn(async () => undefined),
    waitUntilReady: vi.fn(async () => undefined),
  };
  const dispatcherRun = vi.fn(async () => undefined);
  const providerArguments: unknown[][] = [];
  const connectorArguments: unknown[][] = [];
  const buildServer = vi.fn(async () => server);
  return {
    buildServer,
    connectorArguments,
    dispatcherRun,
    pool,
    providerArguments,
    queue,
    server,
    worker,
  };
});

vi.mock("pg", () => ({
  Pool: class {
    constructor(_options: unknown) {
      return mocks.pool;
    }
  },
}));

vi.mock("../src/infrastructure/persistence/migrations.js", () => ({
  runMigrations: vi.fn(async () => undefined),
}));
vi.mock("../src/infrastructure/persistence/postgres-job-repository.js", () => ({
  PostgresJobRepository: class {},
}));
vi.mock("../src/infrastructure/queue/bullmq-execution-queue.js", () => ({
  BullMqExecutionQueue: class {
    constructor(_url: string) {
      return mocks.queue;
    }
  },
}));
vi.mock("../src/infrastructure/artifacts/local-artifact-store.js", () => ({
  LocalArtifactStore: class {},
}));
vi.mock("../src/infrastructure/artifacts/s3-artifact-store.js", () => ({
  S3ArtifactStore: class {},
}));
vi.mock("../src/infrastructure/auth/postgres-api-key-authenticator.js", () => ({
  ensureBootstrapClient: vi.fn(async () => undefined),
  PostgresApiKeyAuthenticator: class {},
}));
vi.mock("../src/interfaces/platform-http-server.js", () => ({
  buildPlatformServer: mocks.buildServer,
}));
vi.mock("../src/application/job-compiler.js", () => ({
  JobCompiler: class {},
}));
vi.mock("../src/application/submit-job.js", () => ({
  SubmitJob: class {
    constructor(
      _compiler: unknown,
      _policy: unknown,
      _repository: unknown,
      runtime: { id: () => string; now: () => Date },
    ) {
      runtime.id();
      runtime.now();
    }
  },
}));
vi.mock("../src/application/job-service.js", () => ({
  JobService: class {},
}));
vi.mock("../src/application/outbox-dispatcher.js", () => ({
  OutboxDispatcher: class {},
}));
vi.mock("../src/application/artifact-janitor.js", () => ({
  ArtifactJanitor: class {
    run = vi.fn(async () => 0);
  },
}));
vi.mock("../src/application/dispatcher-host.js", () => ({
  DispatcherHost: class {
    private readonly maintenance: () => Promise<unknown>;
    constructor(_dispatcher: unknown, _interval: number, maintenance: () => Promise<unknown>) {
      this.maintenance = maintenance;
    }
    async run() {
      await this.maintenance();
      return mocks.dispatcherRun();
    }
  },
}));
vi.mock("../src/application/execution-runner.js", () => ({
  ExecutionRunner: class {},
}));
vi.mock("../src/application/weighted-semaphore.js", () => ({
  WeightedSemaphore: class {},
}));
vi.mock("../src/application/capability-manifests.js", () => ({
  capabilityManifests: () => [],
}));
vi.mock("../src/application/provider-registry.js", () => ({
  ProviderRegistry: class {
    constructor(providers: unknown[]) {
      mocks.providerArguments.push(providers);
    }
    capabilities() {
      return [
        { browser: "chromium", engine: "playwright" },
        { browser: "firefox", engine: "puppeteer" },
        { browser: "edge", engine: "selenium" },
      ];
    }
  },
}));
vi.mock("../src/application/session-connector-registry.js", () => ({
  SessionConnectorRegistry: class {
    constructor(connectors: unknown[]) {
      mocks.connectorArguments.push(connectors);
    }
  },
}));
vi.mock("../src/infrastructure/providers/playwright-provider.js", () => ({
  PlaywrightProvider: class {
    engine = "playwright";
  },
}));
vi.mock("../src/infrastructure/providers/puppeteer-provider.js", () => ({
  PuppeteerProvider: class {
    engine = "puppeteer";
  },
}));
vi.mock("../src/infrastructure/providers/selenium-provider.js", () => ({
  SeleniumProvider: class {
    engine = "selenium";
  },
}));
vi.mock("../src/infrastructure/sessions/playwright-session.js", () => ({
  PlaywrightSessionConnector: class {
    driver = "playwright";
  },
}));
vi.mock("../src/infrastructure/sessions/puppeteer-session.js", () => ({
  PuppeteerSessionConnector: class {
    driver = "puppeteer";
  },
}));
vi.mock("../src/infrastructure/sessions/selenium-session.js", () => ({
  SeleniumSessionConnector: class {
    driver = "selenium";
  },
}));
vi.mock("../src/infrastructure/queue/bullmq-worker-host.js", () => ({
  BullMqWorkerHost: class {
    constructor(_url: string, _driver: string, _runner: unknown, _concurrency: number) {
      return mocks.worker;
    }
  },
}));

import type { AppConfig } from "../src/config.js";
import { startPlatform } from "../src/platform.js";

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    artifactBackend: "local",
    allowedHosts: [],
    apiKey: "a".repeat(32),
    appRole: "api",
    artifactRetentionMs: 1_000,
    artifactRoot: "/artifacts",
    databaseUrl: "postgres://database",
    dispatcherIntervalMs: 100,
    host: "127.0.0.1",
    logLevel: "info",
    maxActiveJobsPerClient: 10,
    otelEndpoint: undefined,
    port: 3_000,
    publicBaseUrl: "http://localhost:3000",
    redisUrl: "redis://queue",
    seleniumBrowsers: ["chromium"],
    seleniumRemoteUrl: undefined,
    s3Bucket: "browser-artifacts",
    s3Endpoint: undefined,
    s3ForcePathStyle: false,
    s3Region: "us-east-1",
    shutdownTimeoutMs: 1_000,
    swaggerEnabled: true,
    workerCapacityUnits: 2,
    workerConcurrency: 1,
    workerDriver: undefined,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.providerArguments.length = 0;
  mocks.connectorArguments.length = 0;
});

describe("platform composition root", () => {
  it("starts, checks readiness and closes the API role", async () => {
    const running = await startPlatform(
      config({
        artifactBackend: "s3",
        s3Endpoint: "http://object-store",
        s3ForcePathStyle: true,
      }),
      new AbortController().signal,
    );
    expect(mocks.server.listen).toHaveBeenCalledWith({ host: "127.0.0.1", port: 3_000 });
    const buildCalls = mocks.buildServer.mock.calls as unknown[][];
    const dependencies = buildCalls[0]?.[0] as { readiness: () => Promise<boolean> } | undefined;
    await expect(dependencies?.readiness()).resolves.toBe(true);
    mocks.pool.query.mockResolvedValueOnce({ rows: [] });
    await expect(dependencies?.readiness()).resolves.toBe(false);
    await running.close();
    expect(mocks.server.close).toHaveBeenCalled();
    expect(mocks.queue.close).toHaveBeenCalled();
    expect(mocks.pool.end).toHaveBeenCalled();
  });

  it("builds an S3 artifact store without a custom endpoint", async () => {
    const running = await startPlatform(
      config({ artifactBackend: "s3", s3Endpoint: undefined }),
      new AbortController().signal,
    );
    await running.close();
    expect(mocks.buildServer).toHaveBeenCalledOnce();
  });

  it("starts and closes the dispatcher role", async () => {
    const running = await startPlatform(
      config({ appRole: "dispatcher" }),
      new AbortController().signal,
    );
    expect(mocks.dispatcherRun).toHaveBeenCalled();
    await running.close();
    expect(mocks.queue.close).toHaveBeenCalled();
  });

  it("starts the worker and builds all connector kinds", async () => {
    const running = await startPlatform(
      config({
        appRole: "worker",
        seleniumBrowsers: ["edge"],
        seleniumRemoteUrl: "http://grid",
        workerDriver: "selenium",
      }),
      new AbortController().signal,
    );
    expect(mocks.providerArguments[0]).toHaveLength(3);
    expect(
      mocks.connectorArguments[0]?.map((connector) => (connector as { driver: string }).driver),
    ).toEqual(["playwright", "puppeteer", "selenium"]);
    expect(mocks.worker.waitUntilReady).toHaveBeenCalled();
    await running.close();
    expect(mocks.worker.close).toHaveBeenCalled();
  });

  it("omits Selenium without a Grid and defends against a missing worker driver", async () => {
    await expect(
      startPlatform(
        config({ appRole: "worker", workerDriver: undefined }),
        new AbortController().signal,
      ),
    ).rejects.toThrow("WORKER_DRIVER is required");
    await startPlatform(
      config({ appRole: "worker", workerDriver: "playwright" }),
      new AbortController().signal,
    );
    expect(mocks.providerArguments.at(-1)).toHaveLength(2);
  });
});
