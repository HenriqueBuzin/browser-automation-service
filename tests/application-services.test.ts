import { describe, expect, it, vi } from "vitest";
import { ArtifactJanitor } from "../src/application/artifact-janitor.js";
import { DispatcherHost } from "../src/application/dispatcher-host.js";
import { JobCompiler } from "../src/application/job-compiler.js";
import { JobService } from "../src/application/job-service.js";
import { OutboxDispatcher } from "../src/application/outbox-dispatcher.js";
import {
  ClientQuotaExceededError,
  IdempotencyConflictError,
  SubmitJob,
} from "../src/application/submit-job.js";
import { WeightedSemaphore } from "../src/application/weighted-semaphore.js";
import { DestinationPolicy } from "../src/application/destination-policy.js";
import { InMemoryJobRepository } from "../src/infrastructure/persistence/in-memory-job-repository.js";
import type { ArtifactStore } from "../src/ports/artifact-store.js";
import type { ExecutionQueue } from "../src/ports/execution-queue.js";
import { executionRecord, fixedNow, jobDefinition, jobRecord } from "./helpers/records.js";
import { definitionFingerprint } from "../src/application/definition-fingerprint.js";

function runtime() {
  let sequence = 0;
  return {
    id: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    now: () => fixedNow,
  };
}

function queue(overrides: Partial<ExecutionQueue> = {}): ExecutionQueue {
  return {
    cancel: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    enqueue: vi.fn(async () => undefined),
    ready: vi.fn(async () => true),
    ...overrides,
  };
}

function artifactStore(overrides: Partial<ArtifactStore> = {}): ArtifactStore {
  return {
    open: vi.fn(async () => Buffer.from("artifact")),
    put: vi.fn(async (input) => ({
      absolutePath: "/tmp/artifact",
      contentType: input.contentType,
      createdAt: input.now,
      executionId: input.executionId,
      id: input.id,
      name: input.name,
      path: `${input.executionId}/${input.id}.png`,
      size: input.content.byteLength,
    })),
    remove: vi.fn(async () => undefined),
    ...overrides,
  };
}

function service(repository: InMemoryJobRepository, maxActive = 10): SubmitJob {
  return new SubmitJob(
    new JobCompiler([
      {
        actions: ["goto"],
        browser: "chromium",
        executionMode: "portable-plan",
        adapter: "playwright",
        platform: "web",
        protocol: "playwright",
      },
      {
        actions: [],
        browser: "firefox",
        executionMode: "portable-plan",
        adapter: "puppeteer",
        platform: "web",
        protocol: "webdriver-bidi",
      },
    ]),
    new DestinationPolicy([], async () => [{ address: "8.8.8.8", family: 4 }]),
    repository,
    runtime(),
    maxActive,
  );
}

describe("SubmitJob and in-memory persistence", () => {
  it("atomically creates supported, unsupported and outbox records", async () => {
    const repository = new InMemoryJobRepository();
    const result = await service(repository).execute(jobDefinition(), "idempotency-1");
    expect(result.created).toBe(true);
    expect(result.executions.map((item) => item.status)).toEqual(["queued", "unsupported"]);
    expect(repository.jobs.size).toBe(1);
    expect(repository.executions.size).toBe(2);
    expect(repository.outbox.size).toBe(1);
    expect(await repository.countActiveJobs("test-client")).toBe(1);
    expect(await repository.findJob(result.job.id)).toEqual({
      executions: result.executions,
      job: result.job,
    });
    await expect(repository.createJob(result.job, result.executions, [])).resolves.toMatchObject({
      created: false,
    });
  });

  it("replays equivalent idempotent submissions and rejects conflicting definitions", async () => {
    const repository = new InMemoryJobRepository();
    const submit = service(repository);
    const first = await submit.execute(jobDefinition(), "idempotency-1");
    const replay = await submit.execute(jobDefinition(), "idempotency-1");
    expect(replay.created).toBe(false);
    expect(replay.job.id).toBe(first.job.id);
    await expect(
      submit.execute(
        jobDefinition({ steps: [{ action: "goto", url: "https://other.test" }] }),
        "idempotency-1",
      ),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("detects the create race conflict and enforces the active quota", async () => {
    const repository = new InMemoryJobRepository();
    const submit = service(repository, 1);
    await submit.execute(jobDefinition(), "idempotency-1");
    await expect(submit.execute(jobDefinition(), "idempotency-2")).rejects.toBeInstanceOf(
      ClientQuotaExceededError,
    );

    const racing = new InMemoryJobRepository();
    const originalCreate = racing.createJob.bind(racing);
    racing.createJob = vi.fn(async (job, executions, messages) => {
      const result = await originalCreate(
        {
          ...job,
          definition: jobDefinition({ clientId: "different" }),
          definitionHash: definitionFingerprint(jobDefinition({ clientId: "different" })),
        },
        executions,
        messages,
      );
      return { ...result, created: false };
    });
    await expect(
      service(racing).execute(jobDefinition(), "idempotency-race"),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("admits only one of two concurrent submissions at quota one", async () => {
    const submit = service(new InMemoryJobRepository(), 1);
    const results = await Promise.allSettled([
      submit.execute(jobDefinition(), "concurrent-1"),
      submit.execute(jobDefinition(), "concurrent-2"),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
  });

  it("uses a fallback reason for unsupported compiler plans", async () => {
    const repository = new InMemoryJobRepository();
    const submit = new SubmitJob(
      {
        compile: () => [
          {
            browser: "edge" as const,
            adapter: "selenium" as const,
            supported: false,
          },
        ],
      } as never,
      new DestinationPolicy([], async () => [{ address: "8.8.8.8", family: 4 }]),
      repository,
      runtime(),
    );
    const result = await submit.execute(jobDefinition(), "unsupported-plan");
    expect(result.executions[0]?.error?.message).toBe("Unsupported execution plan");
  });

  it("covers repository artifact, outbox, state and retry operations", async () => {
    const repository = new InMemoryJobRepository();
    const job = jobRecord();
    const execution = executionRecord();
    repository.executions.set(
      "already-passed",
      executionRecord({ id: "already-passed", status: "passed" }),
    );
    repository.executions.set(
      "other-job",
      executionRecord({ id: "other-job", jobId: "different-job" }),
    );
    await repository.createJob(
      job,
      [execution],
      [
        {
          attempts: 0,
          createdAt: new Date(fixedNow.getTime() - 1),
          executionId: execution.id,
          id: "outbox-1",
          topic: "execution.playwright",
        },
        {
          attempts: 0,
          createdAt: fixedNow,
          executionId: execution.id,
          id: "outbox-2",
          topic: "execution.playwright",
        },
      ],
    );
    expect((await repository.claimOutbox(1))[0]?.id).toBe("outbox-1");
    await repository.markOutboxFailed("outbox-1");
    await repository.markOutboxFailed("missing");
    expect(repository.outbox.get("outbox-1")?.attempts).toBe(1);
    await repository.markOutboxPublished("outbox-1", fixedNow);
    await repository.markOutboxPublished("missing", fixedNow);
    expect((await repository.claimOutbox(5)).map((item) => item.id)).toEqual(["outbox-2"]);
    expect(await repository.updateExecution("missing", "passed", {})).toBeUndefined();
    await repository.updateExecution(execution.id, "failed", {
      error: { category: "infrastructure", message: "lost", name: "Error" },
      updatedAt: fixedNow,
    });
    expect(
      await repository.resetExecution(execution.id, fixedNow, {
        attempts: 0,
        createdAt: fixedNow,
        executionId: execution.id,
        id: "retry",
        topic: "execution.playwright",
      }),
    ).toBe(true);
    expect(
      await repository.resetExecution("missing", fixedNow, repository.outbox.get("retry")!),
    ).toBe(false);
    expect(await repository.cancelJob(job.id, fixedNow)).toBe(true);
    expect(await repository.cancelJob(job.id, fixedNow)).toBe(false);
    expect(await repository.cancelJob("missing", fixedNow)).toBe(false);

    const orphan = executionRecord({ id: "orphan", jobId: "absent-job" });
    repository.executions.set(orphan.id, orphan);
    await repository.updateExecution(orphan.id, "passed", { updatedAt: fixedNow });

    const vanished = new InMemoryJobRepository();
    await vanished.createJob(jobRecord(), [], []);
    vanished.jobs.clear();
    expect(() => vanished.createJob(jobRecord(), [], [])).toThrow("disappeared");
  });

  it("claims executions once and retries failed artifact deletion", async () => {
    const repository = new InMemoryJobRepository();
    const job = jobRecord();
    const execution = executionRecord();
    await repository.createJob(job, [execution], []);
    await expect(
      repository.claimExecution(execution.id, "playwright", fixedNow),
    ).resolves.toMatchObject({ attempt: 1, status: "running" });
    await expect(
      repository.claimExecution(execution.id, "playwright", fixedNow),
    ).resolves.toBeUndefined();
    await expect(
      repository.claimExecution("missing", "playwright", fixedNow),
    ).resolves.toBeUndefined();

    const old = {
      contentType: "image/png",
      createdAt: new Date(fixedNow.getTime() - 10_000),
      executionId: execution.id,
      id: "retry-artifact",
      name: "screen",
      path: "path",
      size: 1,
    };
    await repository.addArtifact(old);
    expect(await repository.claimExpiredArtifacts(fixedNow, 1, fixedNow)).toEqual([old]);
    await repository.failArtifactDeletion(old.id, new Date(fixedNow.getTime() + 1_000));
    expect(await repository.claimExpiredArtifacts(fixedNow, 1, fixedNow)).toEqual([]);
    const retryAt = new Date(fixedNow.getTime() + 1_000);
    expect(await repository.claimExpiredArtifacts(fixedNow, 1, retryAt)).toEqual([old]);
    await repository.completeArtifactDeletion(old.id);
    await repository.failArtifactDeletion("missing", retryAt);

    repository.artifacts.set("legacy-less", { ...old, id: "legacy-less" });
    repository.artifactDeletion.set("legacy-less", { status: "active" } as never);
    expect(await repository.claimExpiredArtifacts(fixedNow, 1, retryAt)).toHaveLength(1);
  });
});

describe("dispatcher, job service, janitor and capacity", () => {
  it("publishes outbox messages and unlocks failures", async () => {
    const repository = new InMemoryJobRepository();
    const job = jobRecord();
    const first = executionRecord();
    const second = executionRecord({
      adapter: "selenium",
      id: "00000000-0000-4000-8000-000000000003",
    });
    await repository.createJob(
      job,
      [first, second],
      [
        {
          attempts: 0,
          createdAt: fixedNow,
          executionId: first.id,
          id: "one",
          topic: "execution.playwright",
        },
        {
          attempts: 0,
          createdAt: fixedNow,
          executionId: second.id,
          id: "two",
          topic: "execution.selenium",
        },
      ],
    );
    const executionQueue = queue({
      enqueue: vi.fn(async (id) => {
        if (id === second.id) throw new Error("redis unavailable");
      }),
    });
    await expect(
      new OutboxDispatcher(repository, executionQueue, () => fixedNow).dispatch(),
    ).resolves.toEqual({ failed: 1, published: 1 });
    expect(repository.outbox.get("one")?.publishedAt).toEqual(fixedNow);
    expect(repository.outbox.get("two")?.attempts).toBe(1);
  });

  it("cancels queued work and retries only eligible failures", async () => {
    const repository = new InMemoryJobRepository();
    const job = jobRecord();
    const execution = executionRecord();
    await repository.createJob(job, [execution], []);
    const executionQueue = queue();
    const jobs = new JobService(repository, executionQueue, runtime());
    expect(await jobs.get(job.id)).toBeDefined();
    expect(await jobs.cancel("missing")).toBe(false);
    expect(await jobs.cancel(job.id)).toBe(true);
    expect(executionQueue.cancel).toHaveBeenCalledWith(execution.id, "playwright");
    expect(await jobs.cancel(job.id)).toBe(false);
    expect(await jobs.retry(execution.id)).toBe(false);

    const retryJob = jobRecord({ id: "retry-job", idempotencyKey: "retry-key" });
    const failed = executionRecord({
      attempt: 1,
      error: { category: "infrastructure", message: "grid", name: "Error" },
      id: "retry-execution",
      jobId: retryJob.id,
      status: "failed",
    });
    await repository.createJob(retryJob, [failed], []);
    expect(await jobs.retry(failed.id)).toBe(true);
    expect(repository.outbox.size).toBe(1);
  });

  it("removes expired artifacts no more often than configured", async () => {
    const repository = new InMemoryJobRepository();
    const store = artifactStore();
    await repository.addArtifact({
      contentType: "image/png",
      createdAt: new Date(fixedNow.getTime() - 10_000),
      executionId: "execution",
      id: "old",
      name: "old",
      path: "execution/old.png",
      size: 1,
    });
    await repository.addArtifact({
      contentType: "image/png",
      createdAt: new Date(fixedNow.getTime() - 20_000),
      executionId: "execution",
      id: "older",
      name: "older",
      path: "execution/older.png",
      size: 1,
    });
    const janitor = new ArtifactJanitor(repository, store, 5_000, () => fixedNow, 60_000);
    expect(await janitor.run()).toBe(2);
    expect(await janitor.run()).toBe(0);
    expect(store.remove).toHaveBeenCalledTimes(2);
    expect(await repository.findArtifact("old")).toBeUndefined();
  });

  it("reschedules artifact deletion when the store is unavailable", async () => {
    const repository = new InMemoryJobRepository();
    await repository.addArtifact({
      contentType: "image/png",
      createdAt: new Date(fixedNow.getTime() - 10_000),
      executionId: "execution",
      id: "failed-delete",
      name: "screen",
      path: "path",
      size: 1,
    });
    const janitor = new ArtifactJanitor(
      repository,
      artifactStore({ remove: vi.fn(async () => Promise.reject(new Error("offline"))) }),
      1_000,
      () => fixedNow,
    );
    expect(await janitor.run()).toBe(1);
    expect(repository.artifactDeletion.get("failed-delete")).toMatchObject({
      attempts: 1,
      status: "retry",
    });
  });

  it("runs and aborts the dispatcher host", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const dispatcher = { dispatch: vi.fn(async () => ({ failed: 0, published: 0 })) };
    const maintenance = vi.fn(async () => undefined);
    const host = new DispatcherHost(dispatcher as never, 100, maintenance);
    const running = host.run(controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(host.running).toBe(true);
    controller.abort();
    await running;
    expect(host.running).toBe(false);
    expect(dispatcher.dispatch).toHaveBeenCalledOnce();
    expect(maintenance).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("supports default maintenance and an abort before the interval wait", async () => {
    const controller = new AbortController();
    const dispatcher = {
      dispatch: vi.fn(async () => {
        controller.abort();
        return { failed: 0, published: 0 };
      }),
    };
    const host = new DispatcherHost(dispatcher as never, 100);
    await host.run(controller.signal);
    expect(host.running).toBe(false);
  });

  it("enforces weighted FIFO capacity and idempotent releases", async () => {
    expect(() => new WeightedSemaphore(0)).toThrow("positive integer");
    const semaphore = new WeightedSemaphore(2);
    await expect(semaphore.acquire(0)).rejects.toThrow("Invalid");
    await expect(semaphore.acquire(3)).rejects.toThrow("Invalid");
    const releaseTwo = await semaphore.acquire(2);
    let acquired = false;
    const waiting = semaphore.acquire(1).then((release) => {
      acquired = true;
      return release;
    });
    await Promise.resolve();
    expect(acquired).toBe(false);
    expect(semaphore.available).toBe(0);
    releaseTwo();
    releaseTwo();
    const releaseOne = await waiting;
    expect(semaphore.available).toBe(1);
    releaseOne();
    expect(semaphore.available).toBe(2);
  });
});
