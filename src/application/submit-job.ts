import type { AutomationJob } from "../contracts/job-contract.js";
import { aggregateJobStatus, type ExecutionRecord, type JobRecord } from "../domain/job-state.js";
import type { JobRepository } from "../ports/job-repository.js";
import type { JobCompiler } from "./job-compiler.js";
import type { DestinationPolicy } from "./destination-policy.js";
import { PlatformObservability } from "./observability.js";
import { definitionFingerprint } from "./definition-fingerprint.js";

export type RuntimeValues = {
  id: () => string;
  now: () => Date;
};

export class SubmitJob {
  public constructor(
    private readonly compiler: JobCompiler,
    private readonly destinationPolicy: DestinationPolicy,
    private readonly repository: JobRepository,
    private readonly runtime: RuntimeValues,
    private readonly maxActiveJobsPerClient = 10,
    private readonly observability = new PlatformObservability(),
  ) {}

  public async execute(
    definition: AutomationJob,
    idempotencyKey: string,
  ): Promise<{ created: boolean; executions: ExecutionRecord[]; job: JobRecord }> {
    const existing = await this.repository.findByIdempotency(definition.clientId, idempotencyKey);
    const definitionHash = definitionFingerprint(definition);
    if (existing) {
      if (existing.job.definitionHash !== definitionHash) {
        throw new IdempotencyConflictError();
      }
      this.observability.jobSubmitted(false);
      return { created: false, ...existing };
    }
    await this.destinationPolicy.validate(definition);
    const now = this.runtime.now();
    const jobId = this.runtime.id();
    const executions = this.compiler.compile(definition).map((plan): ExecutionRecord => {
      const supported = plan.supported;
      return {
        attempt: 0,
        browser: plan.browser,
        createdAt: now,
        adapter: plan.adapter,
        ...(supported
          ? {}
          : {
              error: {
                category: "invalid_job" as const,
                message: plan.reason ?? "Unsupported execution plan",
                name: "UnsupportedCombination",
              },
            }),
        id: this.runtime.id(),
        jobId,
        outputs: {},
        status: supported ? "queued" : "unsupported",
        updatedAt: now,
      };
    });
    const job: JobRecord = {
      createdAt: now,
      definition,
      definitionHash,
      id: jobId,
      idempotencyKey,
      status: aggregateJobStatus(executions),
      updatedAt: now,
    };
    const messages = executions
      .filter((execution) => execution.status === "queued")
      .map((execution) => ({
        attempts: 0,
        createdAt: now,
        executionId: execution.id,
        id: this.runtime.id(),
        topic: `execution.${execution.adapter}` as const,
      }));
    const result = await this.repository.createJob(
      job,
      executions,
      messages,
      this.maxActiveJobsPerClient,
    );
    if (result.quotaExceeded) throw new ClientQuotaExceededError(definition.clientId);
    if (!result.created && result.job.definitionHash !== definitionHash) {
      throw new IdempotencyConflictError();
    }
    this.observability.jobSubmitted(result.created);
    return result;
  }
}

export class ClientQuotaExceededError extends Error {
  public constructor(clientId: string) {
    super(`Client '${clientId}' reached its active job quota`);
    this.name = "ClientQuotaExceededError";
  }
}

export class IdempotencyConflictError extends Error {
  public constructor() {
    super("Idempotency key was already used with a different job definition");
    this.name = "IdempotencyConflictError";
  }
}
