import type { AutomationEngine } from "../contracts/job-contract.js";
import type { ArtifactStore } from "../ports/artifact-store.js";
import type { JobRepository } from "../ports/job-repository.js";
import type { AutomationSession } from "./automation-session.js";
import { JobStepRunner, StepExecutionError, serializeError } from "./job-step-runner.js";
import type { ProviderRegistry } from "./provider-registry.js";
import type { SessionConnectorRegistry } from "./session-connector-registry.js";
import type { RuntimeValues } from "./submit-job.js";
import type { ProviderSession } from "../domain/automation-provider.js";
import type { WeightedSemaphore } from "./weighted-semaphore.js";
import { PlatformObservability } from "./observability.js";
import { silentLogger, type PlatformLogger } from "./platform-logger.js";

export class CanceledExecutionError extends Error {
  public constructor() {
    super("Execution was canceled");
    this.name = "CanceledExecutionError";
  }
}

export class ExecutionRunner {
  readonly #steps = new JobStepRunner();

  public constructor(
    private readonly driver: AutomationEngine,
    private readonly providers: ProviderRegistry,
    private readonly connectors: SessionConnectorRegistry,
    private readonly repository: JobRepository,
    private readonly artifacts: ArtifactStore,
    private readonly runtime: RuntimeValues,
    private readonly resources: WeightedSemaphore,
    private readonly observability = new PlatformObservability(),
    private readonly logger: PlatformLogger = silentLogger,
  ) {}

  public async execute(executionId: string): Promise<void> {
    const pending = await this.repository.findExecution(executionId);
    if (pending?.driver !== this.driver || pending.status !== "queued") return;
    const releaseCapacity = await this.resources.acquire(pending.browser === "webkit" ? 2 : 1);
    const startedAt = this.runtime.now();
    const execution = await this.repository.claimExecution(executionId, this.driver, startedAt);
    if (!execution) {
      releaseCapacity();
      return;
    }
    const aggregate = await this.repository.findJob(execution.jobId);
    if (!aggregate) {
      releaseCapacity();
      return;
    }
    const startedMonotonic = performance.now();
    const observation = this.observability.startExecution(execution);
    this.logger.info(
      { browser: execution.browser, driver: execution.driver, executionId },
      "execution started",
    );
    let session: AutomationSession | undefined;
    let providerSession: ProviderSession | undefined;
    try {
      providerSession = await this.providers
        .getForBrowser(execution.driver, execution.browser)
        .launch(execution.id, execution.browser);
      session = await this.connectors
        .get(execution.driver, execution.browser)
        .connect(providerSession.endpoint, providerSession.nativeHandle);
      const result = await this.#steps.run(session, aggregate.job.definition.steps, {
        beforeStep: async () => {
          const latest = await this.repository.findExecution(execution.id);
          if (latest?.status === "canceled") throw new CanceledExecutionError();
        },
        storeScreenshot: async (name, content) => {
          const now = this.runtime.now();
          const stored = await this.artifacts.put({
            content,
            contentType: "image/png",
            executionId: execution.id,
            id: this.runtime.id(),
            name,
            now,
          });
          await this.repository.addArtifact(stored);
          return stored.id;
        },
      });
      const finishedAt = this.runtime.now();
      const latest = await this.repository.findExecution(execution.id);
      const finalStatus = latest?.status === "canceled" ? "canceled" : "passed";
      await this.repository.updateExecution(execution.id, finalStatus, {
        finishedAt,
        outputs: result.outputs,
        updatedAt: finishedAt,
      });
      observation.finish(finalStatus, performance.now() - startedMonotonic);
      this.logger.info({ executionId, status: finalStatus }, "execution finished");
    } catch (error) {
      const finishedAt = this.runtime.now();
      const category =
        error instanceof CanceledExecutionError
          ? undefined
          : error instanceof StepExecutionError
            ? "assertion"
            : "infrastructure";
      await this.repository.updateExecution(
        execution.id,
        error instanceof CanceledExecutionError ? "canceled" : "failed",
        {
          ...(category
            ? {
                error: {
                  category,
                  ...serializeError(error),
                },
              }
            : {}),
          finishedAt,
          ...(error instanceof StepExecutionError ? { outputs: error.outputs } : {}),
          updatedAt: finishedAt,
        },
      );
      observation.finish(
        error instanceof CanceledExecutionError ? "canceled" : "failed",
        performance.now() - startedMonotonic,
        error,
      );
      this.logger.error({ error, executionId }, "execution failed");
    } finally {
      if (session) await session.close().catch(() => undefined);
      else if (providerSession) await providerSession.close().catch(() => undefined);
      releaseCapacity();
    }
  }
}
