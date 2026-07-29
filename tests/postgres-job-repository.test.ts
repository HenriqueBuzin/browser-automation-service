import { describe, expect, it, vi } from "vitest";
import { PostgresJobRepository } from "../src/infrastructure/persistence/postgres-job-repository.js";
import { executionRecord, fixedNow, jobDefinition, jobRecord } from "./helpers/records.js";

const jobRow = {
  client_id: "test-client",
  created_at: fixedNow,
  definition: jobDefinition(),
  definition_hash: "definition-hash",
  id: "job",
  idempotency_key: "idempotency",
  status: "queued",
  updated_at: fixedNow,
};

const executionRow = {
  attempt: 0,
  browser: "chromium",
  created_at: fixedNow,
  adapter: "playwright",
  error: null,
  finished_at: null,
  id: "execution",
  job_id: "job",
  outputs: {},
  started_at: null,
  status: "queued",
  updated_at: fixedNow,
};

function clientFixture() {
  const client = {
    query: vi.fn(),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn(),
  };
  return { client, pool, repository: new PostgresJobRepository(pool as never) };
}

describe("PostgresJobRepository direct queries", () => {
  it("persists, finds and removes artifacts", async () => {
    const { pool, repository } = clientFixture();
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            content_type: "image/png",
            created_at: fixedNow,
            execution_id: "execution",
            id: "artifact",
            name: "screen",
            path: "execution/artifact.png",
            size: "3",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const artifact = {
      contentType: "image/png",
      createdAt: fixedNow,
      executionId: "execution",
      id: "artifact",
      name: "screen",
      path: "execution/artifact.png",
      size: 3,
    };
    await repository.addArtifact(artifact);
    await expect(repository.findArtifact("artifact")).resolves.toEqual(artifact);
    await expect(repository.findArtifact("missing")).resolves.toBeUndefined();
    await repository.completeArtifactDeletion("artifact");
    expect(pool.query).toHaveBeenCalledTimes(4);
  });

  it("claims and maps pending outbox messages", async () => {
    const { pool, repository } = clientFixture();
    pool.query.mockResolvedValue({
      rows: [
        {
          attempts: 1,
          created_at: fixedNow,
          execution_id: "execution",
          id: "outbox",
          published_at: fixedNow,
          topic: "execution.playwright",
        },
        {
          attempts: 0,
          created_at: fixedNow,
          execution_id: "execution-2",
          id: "outbox-2",
          published_at: null,
          topic: "execution.selenium",
        },
      ],
    });
    await expect(repository.claimOutbox(2)).resolves.toEqual([
      {
        attempts: 1,
        createdAt: fixedNow,
        executionId: "execution",
        id: "outbox",
        publishedAt: fixedNow,
        topic: "execution.playwright",
      },
      {
        attempts: 0,
        createdAt: fixedNow,
        executionId: "execution-2",
        id: "outbox-2",
        topic: "execution.selenium",
      },
    ]);
  });

  it("counts active jobs and updates outbox delivery state", async () => {
    const { pool, repository } = clientFixture();
    pool.query
      .mockResolvedValueOnce({ rows: [{ count: "7" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(repository.countActiveJobs("client")).resolves.toBe(7);
    await repository.markOutboxFailed("outbox");
    await repository.markOutboxPublished("outbox", fixedNow);
    await expect(repository.countActiveJobs("none")).resolves.toBe(0);
  });

  it("finds executions and expired artifacts with optional fields", async () => {
    const { pool, repository } = clientFixture();
    const failure = { category: "infrastructure", message: "lost", name: "Error" };
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            ...executionRow,
            error: failure,
            finished_at: fixedNow,
            started_at: fixedNow,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            content_type: "image/png",
            created_at: fixedNow,
            execution_id: "execution",
            id: "artifact",
            name: "screen",
            path: "path",
            size: "4",
          },
        ],
      });
    await expect(repository.findExecution("execution")).resolves.toMatchObject({
      error: failure,
      finishedAt: fixedNow,
      startedAt: fixedNow,
    });
    await expect(repository.findExecution("missing")).resolves.toBeUndefined();
    await expect(repository.claimExpiredArtifacts(fixedNow, 10, fixedNow)).resolves.toHaveLength(1);
  });

  it("claims expired artifacts and records durable deletion outcomes", async () => {
    const { pool, repository } = clientFixture();
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            content_type: "image/png",
            created_at: fixedNow,
            execution_id: "execution",
            id: "artifact",
            name: "screen",
            path: "path",
            size: "3",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(repository.claimExpiredArtifacts(fixedNow, 1, fixedNow)).resolves.toHaveLength(1);
    await repository.failArtifactDeletion("artifact", fixedNow);
    await repository.completeArtifactDeletion("artifact");
  });

  it("finds jobs and idempotency records", async () => {
    const { pool, repository } = clientFixture();
    pool.query
      .mockResolvedValueOnce({ rows: [jobRow] })
      .mockResolvedValueOnce({ rows: [executionRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [jobRow] })
      .mockResolvedValueOnce({ rows: [jobRow] })
      .mockResolvedValueOnce({ rows: [executionRow] });
    await expect(repository.findJob("job")).resolves.toMatchObject({
      executions: [expect.objectContaining({ id: "execution" })],
      job: expect.objectContaining({ id: "job", idempotencyKey: "idempotency" }),
    });
    await expect(repository.findJob("missing")).resolves.toBeUndefined();
    await expect(repository.findByIdempotency("client", "missing")).resolves.toBeUndefined();
    await expect(repository.findByIdempotency("client", "key")).resolves.toBeDefined();
  });
});

describe("PostgresJobRepository transactions", () => {
  it("atomically claims an execution and ignores a lost race", async () => {
    const { client, repository } = clientFixture();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ ...executionRow, attempt: 1, started_at: fixedNow, status: "running" }],
      })
      .mockResolvedValueOnce({
        rows: [{ ...executionRow, attempt: 1, started_at: fixedNow, status: "running" }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(
      repository.claimExecution("execution", "playwright", fixedNow),
    ).resolves.toMatchObject({ attempt: 1, status: "running" });

    client.query.mockReset();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(
      repository.claimExecution("execution", "playwright", fixedNow),
    ).resolves.toBeUndefined();

    client.query.mockReset();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error("claim failed"));
    await expect(repository.claimExecution("execution", "playwright", fixedNow)).rejects.toThrow(
      "claim failed",
    );
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("returns an idempotent winner and rejects quota inside the client lock", async () => {
    const { client, repository } = clientFixture();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [jobRow] })
      .mockResolvedValueOnce({ rows: [executionRow] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(repository.createJob(jobRecord(), [], [], 1)).resolves.toMatchObject({
      created: false,
      job: { definitionHash: "definition-hash" },
    });

    client.query.mockReset();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: "1" }] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(repository.createJob(jobRecord(), [], [], 1)).resolves.toMatchObject({
      quotaExceeded: true,
    });
  });

  it("creates a job, its executions and outbox atomically", async () => {
    const { client, repository } = clientFixture();
    client.query.mockResolvedValue({ rows: [], rowCount: 1 });
    const job = jobRecord();
    const execution = executionRecord();
    const outbox = {
      attempts: 0,
      createdAt: fixedNow,
      executionId: execution.id,
      id: "outbox",
      topic: "execution.playwright" as const,
    };
    await expect(repository.createJob(job, [execution], [outbox])).resolves.toEqual({
      created: true,
      executions: [execution],
      job,
    });
    expect(client.query.mock.calls.map((call) => String(call[0]))).toEqual(
      expect.arrayContaining(["BEGIN", "COMMIT"]),
    );
    expect(client.release).toHaveBeenCalled();
  });

  it("returns the winning idempotent insert after a unique race", async () => {
    const { client, repository } = clientFixture();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce({ code: "23505" })
      .mockResolvedValueOnce({ rows: [] });
    const existing = {
      executions: [executionRecord()],
      job: jobRecord(),
    };
    vi.spyOn(repository, "findByIdempotency").mockResolvedValue(existing);
    await expect(repository.createJob(jobRecord(), [], [])).resolves.toEqual({
      created: false,
      ...existing,
    });
    expect(client.release).toHaveBeenCalled();
  });

  it.each([
    [{ code: "23505" }, true],
    [{ code: "other" }, false],
    [new Error("database"), false],
  ])("rolls back and rethrows insert failure %#", async (error, uniqueWithoutWinner) => {
    const { client, repository } = clientFixture();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ rows: [] });
    if (uniqueWithoutWinner) {
      vi.spyOn(repository, "findByIdempotency").mockResolvedValue(undefined);
    }
    await expect(repository.createJob(jobRecord(), [], [])).rejects.toBe(error);
    expect(client.release).toHaveBeenCalled();
  });

  it("cancels active jobs and their executions", async () => {
    const { client, repository } = clientFixture();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "job" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(repository.cancelJob("job", fixedNow)).resolves.toBe(true);
    expect(client.release).toHaveBeenCalled();
  });

  it("returns false when cancellation or reset has no eligible row", async () => {
    const canceled = clientFixture();
    canceled.client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(canceled.repository.cancelJob("job", fixedNow)).resolves.toBe(false);

    const reset = clientFixture();
    reset.client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(
      reset.repository.resetExecution("execution", fixedNow, {
        attempts: 0,
        createdAt: fixedNow,
        executionId: "execution",
        id: "outbox",
        topic: "execution.playwright",
      }),
    ).resolves.toBe(false);
  });

  it("resets an infrastructure execution and its parent job", async () => {
    const { client, repository } = clientFixture();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ job_id: "job" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(
      repository.resetExecution("execution", fixedNow, {
        attempts: 0,
        createdAt: fixedNow,
        executionId: "execution",
        id: "outbox",
        topic: "execution.playwright",
      }),
    ).resolves.toBe(true);
  });

  it.each(["cancelJob", "resetExecution"] as const)(
    "rolls back %s when a transaction fails",
    async (method) => {
      const { client, repository } = clientFixture();
      client.query
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(new Error("transaction failed"))
        .mockResolvedValueOnce({ rows: [] });
      const operation =
        method === "cancelJob"
          ? repository.cancelJob("job", fixedNow)
          : repository.resetExecution("execution", fixedNow, {
              attempts: 0,
              createdAt: fixedNow,
              executionId: "execution",
              id: "outbox",
              topic: "execution.playwright",
            });
      await expect(operation).rejects.toThrow("transaction failed");
      expect(client.release).toHaveBeenCalled();
    },
  );

  it("updates an execution and recalculates its job aggregate", async () => {
    const { client, repository } = clientFixture();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [executionRow] })
      .mockResolvedValueOnce({
        rows: [
          {
            ...executionRow,
            attempt: 1,
            error: { category: "infrastructure", message: "lost", name: "Error" },
            finished_at: fixedNow,
            started_at: fixedNow,
            status: "failed",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ ...executionRow, status: "failed" }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(
      repository.updateExecution("execution", "failed", {
        attempt: 1,
        error: { category: "infrastructure", message: "lost", name: "Error" },
        finishedAt: fixedNow,
        startedAt: fixedNow,
        updatedAt: fixedNow,
      }),
    ).resolves.toMatchObject({ attempt: 1, status: "failed" });
  });

  it("returns undefined for a missing execution update", async () => {
    const { client, repository } = clientFixture();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(repository.updateExecution("missing", "passed", {})).resolves.toBeUndefined();
  });

  it("rejects a vanished update row and transaction errors", async () => {
    const vanished = clientFixture();
    vanished.client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [executionRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [executionRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(
      vanished.repository.updateExecution("execution", "passed", { updatedAt: fixedNow }),
    ).rejects.toThrow("disappeared during update");

    const failed = clientFixture();
    failed.client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error("lock failed"))
      .mockResolvedValueOnce({ rows: [] });
    await expect(failed.repository.updateExecution("execution", "passed", {})).rejects.toThrow(
      "lock failed",
    );
  });
});
