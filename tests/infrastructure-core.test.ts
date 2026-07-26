import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalArtifactStore } from "../src/infrastructure/artifacts/local-artifact-store.js";
import {
  ensureBootstrapClient,
  hashKey,
  PostgresApiKeyAuthenticator,
} from "../src/infrastructure/auth/postgres-api-key-authenticator.js";
import { runMigrations } from "../src/infrastructure/persistence/migrations.js";
import { fixedNow } from "./helpers/records.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("local artifact storage", () => {
  it("writes, opens and removes artifacts while tolerating a missing file", async () => {
    const root = await mkdtemp(join(tmpdir(), "browser-artifacts-"));
    temporaryDirectories.push(root);
    const store = new LocalArtifactStore(root);
    const artifact = await store.put({
      content: Buffer.from("png"),
      contentType: "image/png",
      executionId: "execution",
      id: "artifact",
      name: "screen",
      now: fixedNow,
    });
    expect(await store.open(artifact)).toEqual(Buffer.from("png"));
    expect(artifact).toMatchObject({
      createdAt: fixedNow,
      path: "execution/artifact.png",
      size: 3,
    });
    await store.remove(artifact);
    await expect(store.remove(artifact)).resolves.toBeUndefined();
  });

  it("blocks paths escaping the configured root and propagates filesystem failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "browser-artifacts-"));
    temporaryDirectories.push(root);
    const store = new LocalArtifactStore(root);
    const escaped = {
      contentType: "image/png",
      createdAt: fixedNow,
      executionId: "execution",
      id: "artifact",
      name: "screen",
      path: "../outside.png",
      size: 1,
    };
    await expect(store.open(escaped)).rejects.toThrow("escapes storage root");
    await mkdir(join(root, "directory"));
    await expect(store.remove({ ...escaped, path: "directory" })).rejects.toBeDefined();
  });
});

describe("PostgreSQL authentication and migrations", () => {
  it("hashes API keys and authorizes bearer or header credentials by scope", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ authorized: true }] })
      .mockResolvedValueOnce({ rows: [] });
    const authenticator = new PostgresApiKeyAuthenticator({ query } as never);
    await expect(
      authenticator.authorize({ apiKey: undefined, authorization: "Bearer secret" }, "jobs:read"),
    ).resolves.toBe(true);
    await expect(
      authenticator.authorize({ apiKey: "secret", authorization: undefined }, "jobs:write"),
    ).resolves.toBe(false);
    await expect(
      authenticator.authorize({ apiKey: undefined, authorization: undefined }, "jobs:read"),
    ).resolves.toBe(false);
    expect(query.mock.calls[0]?.[1]).toEqual([hashKey("secret"), "jobs:read"]);
    expect(hashKey("secret")).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("creates the bootstrap client and applies the schema migration", async () => {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      void sql;
      void params;
      return { rows: [] };
    });
    const pool = { query } as never;
    await ensureBootstrapClient(pool, "bootstrap-secret");
    await runMigrations(pool);
    expect(query).toHaveBeenCalledTimes(2);
    expect(String(query.mock.calls[0]?.[0])).toContain("browser_api_clients");
    expect(String(query.mock.calls[1]?.[0])).toContain("browser_artifacts");
  });
});
