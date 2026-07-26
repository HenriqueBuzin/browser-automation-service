import type { ArtifactStore } from "../ports/artifact-store.js";
import type { JobRepository } from "../ports/job-repository.js";

export class ArtifactJanitor {
  #lastRunAt: number | undefined;

  public constructor(
    private readonly repository: JobRepository,
    private readonly store: ArtifactStore,
    private readonly retentionMs: number,
    private readonly now: () => Date,
    private readonly minimumIntervalMs = 60_000,
  ) {}

  public async run(limit = 100): Promise<number> {
    const now = this.now();
    if (this.#lastRunAt !== undefined && now.getTime() - this.#lastRunAt < this.minimumIntervalMs) {
      return 0;
    }
    this.#lastRunAt = now.getTime();
    const before = new Date(now.getTime() - this.retentionMs);
    const expired = await this.repository.claimExpiredArtifacts(before, limit, now);
    for (const artifact of expired) {
      try {
        await this.store.remove(artifact);
        await this.repository.completeArtifactDeletion(artifact.id);
      } catch {
        await this.repository.failArtifactDeletion(artifact.id, new Date(now.getTime() + 60_000));
      }
    }
    return expired.length;
  }
}
