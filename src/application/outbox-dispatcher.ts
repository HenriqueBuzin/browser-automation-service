import type { JobRepository } from "../ports/job-repository.js";
import type { ExecutionQueue } from "../ports/execution-queue.js";
import { PlatformObservability } from "./observability.js";
import { silentLogger, type PlatformLogger } from "./platform-logger.js";

export class OutboxDispatcher {
  public constructor(
    private readonly repository: JobRepository,
    private readonly queue: ExecutionQueue,
    private readonly now: () => Date,
    private readonly observability = new PlatformObservability(),
    private readonly logger: PlatformLogger = silentLogger,
  ) {}

  public async dispatch(limit = 100): Promise<{ failed: number; published: number }> {
    const messages = await this.repository.claimOutbox(limit);
    let failed = 0;
    let published = 0;
    for (const message of messages) {
      try {
        const adapter = message.topic.replace("execution.", "") as
          "playwright" | "puppeteer" | "selenium";
        await this.queue.enqueue(message.executionId, adapter);
        await this.repository.markOutboxPublished(message.id, this.now());
        this.observability.outboxPublished("published");
        published += 1;
      } catch (error) {
        await this.repository.markOutboxFailed(message.id);
        this.observability.outboxPublished("failed");
        failed += 1;
        this.logger.error({ error, outboxId: message.id }, "outbox publication failed");
      }
    }
    return { failed, published };
  }
}
