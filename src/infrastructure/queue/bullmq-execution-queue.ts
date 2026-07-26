import { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { AutomationEngine } from "../../contracts/job-contract.js";
import type { ExecutionQueue } from "../../ports/execution-queue.js";

export const queueName = (driver: AutomationEngine): string => `browser-execution-${driver}`;

export class BullMqExecutionQueue implements ExecutionQueue {
  readonly #connection: Redis;
  readonly #queues: Map<AutomationEngine, Queue>;

  public constructor(redisUrl: string) {
    this.#connection = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
    this.#queues = new Map(
      (["playwright", "puppeteer", "selenium"] as const).map((driver) => [
        driver,
        new Queue(queueName(driver), {
          connection: this.#connection,
          defaultJobOptions: {
            removeOnComplete: 1_000,
            removeOnFail: 5_000,
          },
        }),
      ]),
    );
  }

  public async cancel(executionId: string, driver: AutomationEngine): Promise<void> {
    const job = await this.#queue(driver).getJob(executionId);
    if (job && !["active", "completed", "failed"].includes(await job.getState())) {
      await job.remove();
    }
  }

  public async close(): Promise<void> {
    await Promise.all([...this.#queues.values()].map((queue) => queue.close()));
    this.#connection.disconnect();
  }

  public async enqueue(executionId: string, driver: AutomationEngine): Promise<void> {
    await this.#queue(driver).add("execute", { executionId }, { jobId: executionId });
  }

  public async ready(): Promise<boolean> {
    await this.#connection.ping();
    return true;
  }

  #queue(driver: AutomationEngine): Queue {
    const queue = this.#queues.get(driver);
    if (!queue) throw new Error(`Queue is not configured for ${driver}`);
    return queue;
  }
}
