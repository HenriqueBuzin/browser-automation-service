import type { RuntimeValues } from "./submit-job.js";
import type { ExecutionQueue } from "../ports/execution-queue.js";
import type { JobRepository } from "../ports/job-repository.js";
import { canRetry } from "../domain/job-state.js";

export class JobService {
  public constructor(
    private readonly repository: JobRepository,
    private readonly queue: ExecutionQueue,
    private readonly runtime: RuntimeValues,
  ) {}

  public get(id: string) {
    return this.repository.findJob(id);
  }

  public async cancel(id: string): Promise<boolean> {
    const current = await this.repository.findJob(id);
    if (!current) return false;
    const canceled = await this.repository.cancelJob(id, this.runtime.now());
    if (!canceled) return false;
    await Promise.all(
      current.executions
        .filter((execution) => ["queued", "running"].includes(execution.status))
        .map((execution) => this.queue.cancel(execution.id, execution.driver)),
    );
    return true;
  }

  public async retry(executionId: string): Promise<boolean> {
    const execution = await this.repository.findExecution(executionId);
    if (!execution || !canRetry(execution)) return false;
    const now = this.runtime.now();
    return this.repository.resetExecution(executionId, now, {
      attempts: 0,
      createdAt: now,
      executionId,
      id: this.runtime.id(),
      topic: `execution.${execution.driver}`,
    });
  }
}
