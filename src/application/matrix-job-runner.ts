import type {
  AutomationBrowser,
  AutomationEngine,
  AutomationProtocol,
} from "../domain/automation-provider.js";
import type { AutomationJob, MatrixExecution, MatrixJobResult } from "../domain/automation-job.js";
import type { LeaseManager } from "./lease-manager.js";
import { JobStepRunner, serializeError, StepExecutionError } from "./job-step-runner.js";
import type { ProviderCapability, ProviderRegistry } from "./provider-registry.js";
import type { AutomationSession } from "./automation-session.js";
import type { SessionConnectorRegistry } from "./session-connector-registry.js";

export type MatrixJobRunnerOptions = {
  maxParallelism: number;
  queueWaitMs: number;
};

type PlannedCapability = ProviderCapability & { supported: boolean };

export class MatrixJobRunner {
  readonly #connectors: SessionConnectorRegistry;
  readonly #leases: LeaseManager;
  readonly #options: MatrixJobRunnerOptions;
  readonly #providers: ProviderRegistry;
  readonly #steps = new JobStepRunner();

  public constructor(
    providers: ProviderRegistry,
    connectors: SessionConnectorRegistry,
    leases: LeaseManager,
    options: MatrixJobRunnerOptions,
  ) {
    this.#providers = providers;
    this.#connectors = connectors;
    this.#leases = leases;
    this.#options = options;
  }

  public plan(job: AutomationJob): PlannedCapability[] {
    const available = this.#providers.capabilities();
    if (!job.drivers && !job.browsers) {
      return available.map((capability) => ({ ...capability, supported: true }));
    }

    const drivers = job.drivers ?? [...new Set(available.map((capability) => capability.engine))];
    const browsers = job.browsers;
    if (!browsers) {
      return available
        .filter((capability) => drivers.includes(capability.engine))
        .map((capability) => ({ ...capability, supported: true }));
    }

    return drivers.flatMap((engine) =>
      browsers.map((browser) => ({
        browser,
        engine,
        supported: available.some(
          (candidate) => candidate.engine === engine && candidate.browser === browser,
        ),
      })),
    );
  }

  public async run(job: AutomationJob): Promise<MatrixJobResult> {
    const startedAt = Date.now();
    const executions = await mapLimit(
      this.plan(job),
      this.#options.maxParallelism,
      async (capability) =>
        capability.supported
          ? this.#execute(job, capability)
          : unsupportedExecution(capability.engine, capability.browser),
    );
    const failed = executions.some((execution) => execution.status === "failed");
    const unsupported = executions.some((execution) => execution.status === "unsupported");
    return {
      clientId: job.clientId,
      durationMs: Date.now() - startedAt,
      executions,
      schemaVersion: 1,
      status: failed ? "failed" : unsupported ? "partial" : "passed",
    };
  }

  async #execute(job: AutomationJob, capability: ProviderCapability): Promise<MatrixExecution> {
    const startedAt = Date.now();
    let leaseId: string | undefined;
    let session: AutomationSession | undefined;
    try {
      const lease = await this.#leases.request(
        `${job.clientId}-${capability.engine}-${capability.browser}`.slice(0, 64),
        capability.engine,
        capability.browser,
        this.#options.queueWaitMs,
      );
      leaseId = lease.id;
      const connection = this.#connection(lease);
      session = await this.#connectors
        .get(capability.engine, capability.browser)
        .connect(connection.endpoint, connection.nativeHandle);
      if (lease.protocol !== "webdriver") this.#leases.markConnected(lease.id);
      const result = await this.#steps.run(session, job.steps);
      return {
        browser: capability.browser,
        driver: capability.engine,
        durationMs: Date.now() - startedAt,
        outputs: result.outputs,
        status: "passed",
        steps: result.steps,
      };
    } catch (error) {
      const partial =
        error instanceof StepExecutionError
          ? { outputs: error.outputs, steps: error.steps }
          : { outputs: {}, steps: [] };
      return {
        browser: capability.browser,
        driver: capability.engine,
        durationMs: Date.now() - startedAt,
        error: serializeError(error),
        ...partial,
        status: "failed",
      };
    } finally {
      await session?.close().catch(() => undefined);
      if (leaseId) await this.#leases.release(leaseId);
    }
  }

  #connection(lease: {
    directEndpoint?: string;
    id: string;
    protocol: AutomationProtocol;
    token: string;
  }): { endpoint: string; nativeHandle?: unknown } {
    if (lease.protocol === "webdriver") {
      if (!lease.directEndpoint) throw new Error("WebDriver endpoint is missing");
      return { endpoint: lease.directEndpoint };
    }
    const connection = this.#leases.connect(lease.id, lease.token);
    return {
      endpoint: connection.wsEndpoint,
      ...(connection.nativeHandle === undefined ? {} : { nativeHandle: connection.nativeHandle }),
    };
  }
}

function unsupportedExecution(
  driver: AutomationEngine,
  browser: AutomationBrowser,
): MatrixExecution {
  return {
    browser,
    driver,
    durationMs: 0,
    error: {
      message: `${driver} does not support ${browser} in this deployment`,
      name: "UnsupportedCombination",
    },
    outputs: {},
    status: "unsupported",
    steps: [],
  };
}

async function mapLimit<T, R>(
  values: T[],
  limit: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const queue = values.map((value, index) => ({ index, value }));
  const completed: { index: number; result: R }[] = [];
  const runners = Array.from({ length: Math.min(limit, values.length) }, async () => {
    for (;;) {
      const entry = queue.shift();
      if (!entry) return;
      completed.push({
        index: entry.index,
        result: await worker(entry.value),
      });
    }
  });
  await Promise.all(runners);
  return completed.sort((left, right) => left.index - right.index).map((entry) => entry.result);
}
