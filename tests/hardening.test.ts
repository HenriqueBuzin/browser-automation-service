import { describe, expect, it, vi } from "vitest";
import { canonicalJson, definitionFingerprint } from "../src/application/definition-fingerprint.js";
import { streamJobEvents } from "../src/application/job-event-stream.js";
import { createPlatformLogger, silentLogger } from "../src/application/platform-logger.js";
import { S3ArtifactStore } from "../src/infrastructure/artifacts/s3-artifact-store.js";
import { migrations, runMigrations } from "../src/infrastructure/persistence/migrations.js";
import { fixedNow, jobDefinition } from "./helpers/records.js";

describe("hardening primitives", () => {
  it("canonicalizes object keys while preserving array order", () => {
    expect(canonicalJson({ b: 2, ignored: undefined, a: [2, 1] })).toBe('{"a":[2,1],"b":2}');
    expect(definitionFingerprint(jobDefinition())).toHaveLength(64);
    expect(canonicalJson({ steps: [{ url: "x", action: "goto" }], schemaVersion: 2 })).toBe(
      canonicalJson({ schemaVersion: 2, steps: [{ action: "goto", url: "x" }] }),
    );
  });

  it("streams terminal, missing, heartbeat, resumed and closed job events", async () => {
    const terminalWrites: string[] = [];
    await expect(
      streamJobEvents({
        heartbeatMs: 100,
        load: async () => ({ status: "passed", updatedAt: fixedNow.toISOString() }),
        pollMs: 1,
        signal: new AbortController().signal,
        write: (chunk) => terminalWrites.push(chunk),
      }),
    ).resolves.toBe("terminal");
    expect(terminalWrites[0]).toContain("event: job");

    await expect(
      streamJobEvents({
        heartbeatMs: 100,
        load: async () => undefined,
        pollMs: 1,
        signal: new AbortController().signal,
        write: vi.fn(),
      }),
    ).resolves.toBe("missing");

    const heartbeatController = new AbortController();
    const heartbeat = streamJobEvents({
      heartbeatMs: 0,
      load: async () => ({ status: "queued", updatedAt: fixedNow.toISOString() }),
      pollMs: 1,
      signal: heartbeatController.signal,
      write: (chunk) => {
        if (chunk.startsWith(":")) heartbeatController.abort();
      },
    });
    await expect(heartbeat).resolves.toBe("closed");

    let reads = 0;
    const resumed = streamJobEvents({
      heartbeatMs: 1_000,
      lastEventId: fixedNow.toISOString(),
      load: async () => {
        reads += 1;
        return reads === 1
          ? { status: "queued", updatedAt: fixedNow.toISOString() }
          : {
              status: "failed",
              updatedAt: new Date(fixedNow.getTime() + 1).toISOString(),
            };
      },
      pollMs: 1,
      signal: new AbortController().signal,
      write: vi.fn(),
    });
    await expect(resumed).resolves.toBe("terminal");

    const closing = new AbortController();
    const closed = streamJobEvents({
      heartbeatMs: 1_000,
      load: async () => ({ status: "queued", updatedAt: fixedNow.toISOString() }),
      pollMs: 1_000,
      signal: closing.signal,
      write: vi.fn(),
    });
    await Promise.resolve();
    closing.abort();
    await expect(closed).resolves.toBe("closed");
  });

  it("stores, opens and deletes S3-compatible artifacts", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        Body: { transformToByteArray: async () => Uint8Array.from([1, 2, 3]) },
      })
      .mockResolvedValueOnce({});
    const store = new S3ArtifactStore("bucket", {}, { send } as never);
    const artifact = await store.put({
      content: Buffer.from("png"),
      contentType: "image/png",
      executionId: "execution",
      id: "artifact",
      name: "screen",
      now: fixedNow,
    });
    await expect(store.open(artifact)).resolves.toEqual(Buffer.from([1, 2, 3]));
    await store.remove(artifact);
    expect(send).toHaveBeenCalledTimes(3);

    const empty = new S3ArtifactStore(
      "bucket",
      { endpoint: "http://minio", forcePathStyle: true, region: "us-east-1" },
      { send: vi.fn(async () => ({})) } as never,
    );
    await expect(empty.open(artifact)).rejects.toThrow("has no content");
    expect(new S3ArtifactStore("bucket")).toBeInstanceOf(S3ArtifactStore);
    expect(
      new S3ArtifactStore("bucket", {
        credentials: { accessKeyId: "access", secretAccessKey: "secret" },
        endpoint: "http://minio",
        forcePathStyle: false,
        region: "us-east-1",
      }),
    ).toBeInstanceOf(S3ArtifactStore);
  });

  it("runs only unapplied migrations and rolls back a failed version", async () => {
    const query = vi.fn(async (sql: string, _params?: unknown[]) =>
      sql.includes("SELECT version") ? { rows: [{ version: 1 }] } : { rows: [] },
    );
    const client = { query, release: vi.fn() };
    await runMigrations({ connect: async () => client } as never);
    expect(query.mock.calls.some(([sql]) => sql.includes("platform indexes"))).toBe(false);
    expect(
      query.mock.calls.some((call) => {
        const params = call[1];
        return params?.[0] === 2;
      }),
    ).toBe(true);

    const failedQuery = vi.fn(async (sql: string) => {
      if (sql === migrations[0]?.sql) throw new Error("migration failed");
      return sql.includes("SELECT version") ? { rows: [] } : { rows: [] };
    });
    await expect(
      runMigrations({
        connect: async () => ({ query: failedQuery, release: vi.fn() }),
      } as never),
    ).rejects.toThrow("migration failed");
    expect(failedQuery).toHaveBeenCalledWith("ROLLBACK");

    const unlockFailure = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT version")) return { rows: [{ version: 1 }, { version: 2 }] };
      if (sql.includes("pg_advisory_unlock")) throw new Error("connection closed");
      return { rows: [] };
    });
    const release = vi.fn();
    await expect(
      runMigrations({
        connect: async () => ({ query: unlockFailure, release }),
      } as never),
    ).resolves.toBeUndefined();
    expect(release).toHaveBeenCalledOnce();
  });

  it("provides structured and silent loggers", () => {
    silentLogger.info({}, "ignored");
    silentLogger.warn({}, "ignored");
    silentLogger.error({}, "ignored");
    const logger = createPlatformLogger("worker", "silent");
    expect(typeof logger.info).toBe("function");
  });
});
