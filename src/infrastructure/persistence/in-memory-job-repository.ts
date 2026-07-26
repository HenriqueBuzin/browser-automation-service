import type { ArtifactRecord } from "../../domain/artifact.js";
import {
  aggregateJobStatus,
  type ExecutionRecord,
  type ExecutionStatus,
  type JobRecord,
  type OutboxMessage,
} from "../../domain/job-state.js";
import type { CreateJobResult, JobRepository } from "../../ports/job-repository.js";

export class InMemoryJobRepository implements JobRepository {
  readonly artifacts = new Map<string, ArtifactRecord>();
  readonly executions = new Map<string, ExecutionRecord>();
  readonly jobs = new Map<string, JobRecord>();
  readonly outbox = new Map<string, OutboxMessage>();
  readonly #idempotency = new Map<string, string>();

  public addArtifact(artifact: ArtifactRecord): Promise<void> {
    this.artifacts.set(artifact.id, artifact);
    return Promise.resolve();
  }

  public cancelJob(jobId: string, now: Date): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job || !["queued", "running"].includes(job.status)) {
      return Promise.resolve(false);
    }
    this.jobs.set(jobId, { ...job, status: "canceled", updatedAt: now });
    for (const execution of this.executions.values()) {
      if (execution.jobId === jobId && ["queued", "running"].includes(execution.status)) {
        this.executions.set(execution.id, {
          ...execution,
          finishedAt: now,
          status: "canceled",
          updatedAt: now,
        });
      }
    }
    return Promise.resolve(true);
  }

  public claimOutbox(limit: number): Promise<OutboxMessage[]> {
    return Promise.resolve(
      [...this.outbox.values()]
        .filter((message) => !message.publishedAt)
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
        .slice(0, limit),
    );
  }

  public createJob(
    job: JobRecord,
    executions: ExecutionRecord[],
    messages: OutboxMessage[],
  ): Promise<CreateJobResult> {
    const key = `${job.definition.clientId}:${job.idempotencyKey}`;
    const existingId = this.#idempotency.get(key);
    if (existingId) {
      const existing = this.#readJob(existingId);
      return Promise.resolve({ created: false, ...existing });
    }
    this.jobs.set(job.id, job);
    this.#idempotency.set(key, job.id);
    for (const execution of executions) this.executions.set(execution.id, execution);
    for (const message of messages) this.outbox.set(message.id, message);
    return Promise.resolve({ created: true, executions, job });
  }

  public countActiveJobs(clientId: string): Promise<number> {
    return Promise.resolve(
      [...this.jobs.values()].filter(
        (job) => job.definition.clientId === clientId && ["queued", "running"].includes(job.status),
      ).length,
    );
  }

  public findArtifact(id: string): Promise<ArtifactRecord | undefined> {
    return Promise.resolve(this.artifacts.get(id));
  }

  public findByIdempotency(
    clientId: string,
    key: string,
  ): Promise<{ executions: ExecutionRecord[]; job: JobRecord } | undefined> {
    const id = this.#idempotency.get(`${clientId}:${key}`);
    return Promise.resolve(id ? this.#readJob(id) : undefined);
  }

  public findExecution(id: string): Promise<ExecutionRecord | undefined> {
    return Promise.resolve(this.executions.get(id));
  }

  public findExpiredArtifacts(before: Date, limit: number): Promise<ArtifactRecord[]> {
    return Promise.resolve(
      [...this.artifacts.values()]
        .filter((artifact) => artifact.createdAt < before)
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
        .slice(0, limit),
    );
  }

  public findJob(
    id: string,
  ): Promise<{ executions: ExecutionRecord[]; job: JobRecord } | undefined> {
    return Promise.resolve(this.jobs.has(id) ? this.#readJob(id) : undefined);
  }

  public markOutboxFailed(id: string): Promise<void> {
    const message = this.outbox.get(id);
    if (message) this.outbox.set(id, { ...message, attempts: message.attempts + 1 });
    return Promise.resolve();
  }

  public markOutboxPublished(id: string, now: Date): Promise<void> {
    const message = this.outbox.get(id);
    if (message) this.outbox.set(id, { ...message, publishedAt: now });
    return Promise.resolve();
  }

  public resetExecution(id: string, now: Date, outbox: OutboxMessage): Promise<boolean> {
    const execution = this.executions.get(id);
    if (execution?.status !== "failed") return Promise.resolve(false);
    this.executions.set(id, {
      attempt: execution.attempt,
      browser: execution.browser,
      createdAt: execution.createdAt,
      driver: execution.driver,
      id: execution.id,
      jobId: execution.jobId,
      outputs: {},
      status: "queued",
      updatedAt: now,
    });
    this.outbox.set(outbox.id, outbox);
    this.#aggregate(execution.jobId, now);
    return Promise.resolve(true);
  }

  public removeArtifact(id: string): Promise<void> {
    this.artifacts.delete(id);
    return Promise.resolve();
  }

  public updateExecution(
    id: string,
    status: ExecutionStatus,
    patch: Partial<ExecutionRecord>,
  ): Promise<ExecutionRecord | undefined> {
    const current = this.executions.get(id);
    if (!current) return Promise.resolve(undefined);
    const updated = { ...current, ...patch, status };
    this.executions.set(id, updated);
    this.#aggregate(current.jobId, updated.updatedAt);
    return Promise.resolve(updated);
  }

  #aggregate(jobId: string, now: Date): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    const executions = [...this.executions.values()].filter(
      (execution) => execution.jobId === jobId,
    );
    this.jobs.set(jobId, {
      ...job,
      status: aggregateJobStatus(executions),
      updatedAt: now,
    });
  }

  #readJob(id: string): { executions: ExecutionRecord[]; job: JobRecord } {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Job ${id} disappeared`);
    return {
      executions: [...this.executions.values()].filter((execution) => execution.jobId === id),
      job,
    };
  }
}
