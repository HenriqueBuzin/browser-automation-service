import { Worker } from "bullmq";
import { Redis } from "ioredis";
import type { AutomationEngine } from "../../contracts/job-contract.js";
import type { ExecutionRunner } from "../../application/execution-runner.js";
import { queueName } from "./bullmq-execution-queue.js";

export class BullMqWorkerHost {
  readonly #connection: Redis;
  readonly #worker: Worker;

  public constructor(
    redisUrl: string,
    driver: AutomationEngine,
    runner: ExecutionRunner,
    concurrency: number,
  ) {
    this.#connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.#worker = new Worker<{ executionId: string }>(
      queueName(driver),
      async (job) => runner.execute(job.data.executionId),
      {
        concurrency,
        connection: this.#connection,
      },
    );
  }

  public async close(): Promise<void> {
    await this.#worker.close();
    this.#connection.disconnect();
  }

  public async waitUntilReady(): Promise<void> {
    await this.#worker.waitUntilReady();
  }
}
