import { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { AutomationAdapter } from "../../contracts/job-contract.js";
import { automationAdapters } from "../../domain/automation-adapter.js";
import type { ExecutionQueue } from "../../ports/execution-queue.js";

export const queueName = (adapter: AutomationAdapter): string => `browser-execution-${adapter}`;

export class BullMqExecutionQueue implements ExecutionQueue {
  readonly #connection: Redis;
  readonly #queues: Map<AutomationAdapter, Queue>;

  public constructor(redisUrl: string) {
    this.#connection = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
    this.#queues = new Map(
      automationAdapters.map((adapter) => [
        adapter,
        new Queue(queueName(adapter), {
          connection: this.#connection,
          defaultJobOptions: {
            removeOnComplete: 1_000,
            removeOnFail: 5_000,
          },
        }),
      ]),
    );
  }

  public async cancel(executionId: string, adapter: AutomationAdapter): Promise<void> {
    const job = await this.#queue(adapter).getJob(executionId);
    if (job && !["active", "completed", "failed"].includes(await job.getState())) {
      await job.remove();
    }
  }

  public async close(): Promise<void> {
    await Promise.all([...this.#queues.values()].map((queue) => queue.close()));
    this.#connection.disconnect();
  }

  public async enqueue(executionId: string, adapter: AutomationAdapter): Promise<void> {
    await this.#queue(adapter).add("execute", { executionId }, { jobId: executionId });
  }

  public async ready(): Promise<boolean> {
    await this.#connection.ping();
    return true;
  }

  #queue(adapter: AutomationAdapter): Queue {
    const queue = this.#queues.get(adapter);
    if (!queue) throw new Error(`Queue is not configured for ${adapter}`);
    return queue;
  }
}
