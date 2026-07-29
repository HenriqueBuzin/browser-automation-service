import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";

const apiKey = "a".repeat(32);
const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");

describe("loadConfig", () => {
  it("loads safe defaults and retains only the bootstrap key hash", () => {
    const config = loadConfig({ API_KEY: apiKey });
    expect(config).toMatchObject({
      appRole: "api",
      artifactRetentionMs: 604_800_000,
      bootstrapApiKeyHash: apiKeyHash,
      maxActiveJobsPerClient: 10,
      port: 3000,
      seleniumBrowsers: ["chromium"],
      workerCapacityUnits: 2,
      workerConcurrency: 1,
    });
    expect(config.publicBaseUrl).toBe("http://localhost:3000");
  });

  it("requires a strong bootstrap key only for the API role", () => {
    expect(() => loadConfig({})).toThrow("API_KEY or API_KEY_FILE is required");
    expect(() => loadConfig({ API_KEY: "weak" })).toThrow("at least 32");
    expect(loadConfig({ APP_ROLE: "dispatcher" }).bootstrapApiKeyHash).toBeUndefined();
  });

  it("loads Docker secret files, trims their newlines and wipes source buffers", () => {
    const values = new Map([
      ["/run/secrets/api_key", Buffer.from(` ${apiKey}\n`)],
      ["/run/secrets/database_url", Buffer.from("postgres://secret-db\n")],
      ["/run/secrets/redis_password", Buffer.from("p@ss word\n")],
      ["/run/secrets/aws_access_key_id", Buffer.from("access\n")],
      ["/run/secrets/aws_secret_access_key", Buffer.from("secret\n")],
    ]);
    const readSecret = vi.fn((path: string) => {
      const value = values.get(path);
      if (!value) throw new Error("missing");
      return value;
    });

    const config = loadConfig(
      {
        API_KEY_FILE: "/run/secrets/api_key",
        ARTIFACT_BACKEND: "s3",
        AWS_ACCESS_KEY_ID_FILE: "/run/secrets/aws_access_key_id",
        AWS_SECRET_ACCESS_KEY_FILE: "/run/secrets/aws_secret_access_key",
        DATABASE_URL_FILE: "/run/secrets/database_url",
        REDIS_PASSWORD_FILE: "/run/secrets/redis_password",
      },
      readSecret,
    );

    expect(config).toMatchObject({
      awsAccessKeyId: "access",
      awsSecretAccessKey: "secret",
      bootstrapApiKeyHash: apiKeyHash,
      databaseUrl: "postgres://secret-db",
      redisUrl: "redis://:p%40ss%20word@redis:6379/0",
    });
    expect(readSecret).toHaveBeenCalledTimes(5);
    for (const value of values.values()) {
      expect(value.every((byte) => byte === 0)).toBe(true);
    }
  });

  it("uses the filesystem reader by default", () => {
    const directory = mkdtempSync(join(tmpdir(), "browser-automation-secrets-"));
    const path = join(directory, "api_key");
    try {
      writeFileSync(path, `${apiKey}\n`, { mode: 0o600 });
      expect(loadConfig({ API_KEY_FILE: path }).bootstrapApiKeyHash).toBe(apiKeyHash);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("rejects ambiguous, empty or unreadable secret files", () => {
    expect(() =>
      loadConfig({ API_KEY: apiKey, API_KEY_FILE: "/secret" }, () => Buffer.from(apiKey)),
    ).toThrow("mutually exclusive");
    expect(() =>
      loadConfig({ API_KEY_FILE: "/missing" }, () => {
        throw new Error("denied");
      }),
    ).toThrow("Unable to read API_KEY_FILE '/missing'");
    const empty = Buffer.from(" \n");
    expect(() => loadConfig({ API_KEY_FILE: "/empty" }, () => empty)).toThrow("is empty");
    expect(empty.every((byte) => byte === 0)).toBe(true);
    expect(() =>
      loadConfig(
        {
          APP_ROLE: "dispatcher",
          DATABASE_URL: "postgres://direct",
          DATABASE_URL_FILE: "/database",
        },
        () => Buffer.from("postgres://file"),
      ),
    ).toThrow("DATABASE_URL and DATABASE_URL_FILE are mutually exclusive");
  });

  it("validates related credential combinations", () => {
    expect(() => loadConfig({ API_KEY: apiKey, AWS_ACCESS_KEY_ID: "access" })).toThrow(
      "configured together",
    );
    expect(() => loadConfig({ API_KEY: apiKey, AWS_SECRET_ACCESS_KEY: "secret" })).toThrow(
      "configured together",
    );
    expect(() =>
      loadConfig({
        API_KEY: apiKey,
        REDIS_PASSWORD: "password",
        REDIS_URL: "redis://custom",
      }),
    ).toThrow("REDIS_URL and REDIS_* settings are mutually exclusive");
    expect(() =>
      loadConfig({
        API_KEY: apiKey,
        DATABASE_URL: "postgres://direct",
        POSTGRES_USER: "browser",
      }),
    ).toThrow("DATABASE_URL and POSTGRES_* settings are mutually exclusive");
  });

  it("builds the Redis URL from separated env settings", () => {
    expect(
      loadConfig({
        API_KEY: apiKey,
        REDIS_DB: "2",
        REDIS_HOST: "redis-vps",
        REDIS_PASSWORD: "p@ss word",
        REDIS_PORT: "6380",
        REDIS_USER: "browser user",
      }).redisUrl,
    ).toBe("redis://browser%20user:p%40ss%20word@redis-vps:6380/2");
    expect(() =>
      loadConfig({
        API_KEY: apiKey,
        REDIS_PASSWORD: "secret",
        REDIS_PORT: "65536",
      }),
    ).toThrow("REDIS_PORT must be less than or equal to 65535");
    expect(() => loadConfig({ API_KEY: apiKey, REDIS_USER: "browser" })).toThrow(
      "REDIS_PASSWORD or REDIS_PASSWORD_FILE is required",
    );
  });

  it("builds the PostgreSQL URL from separated env settings and a password secret", () => {
    const password = Buffer.from("p@ss word\n");
    const config = loadConfig(
      {
        API_KEY: apiKey,
        POSTGRES_DB: "browser tests",
        POSTGRES_HOST: "postgres-vps",
        POSTGRES_PASSWORD_FILE: "/run/secrets/postgres_password",
        POSTGRES_PORT: "5433",
        POSTGRES_USER: "browser user",
      },
      () => password,
    );

    expect(config.databaseUrl).toBe(
      "postgresql://browser%20user:p%40ss%20word@postgres-vps:5433/browser%20tests",
    );
    expect(password.every((byte) => byte === 0)).toBe(true);
    expect(() => loadConfig({ API_KEY: apiKey, POSTGRES_USER: "browser" })).toThrow(
      "POSTGRES_PASSWORD or POSTGRES_PASSWORD_FILE is required",
    );
    expect(() =>
      loadConfig({
        API_KEY: apiKey,
        POSTGRES_PASSWORD: "secret",
        POSTGRES_PORT: "65536",
      }),
    ).toThrow("POSTGRES_PORT must be less than or equal to 65535");
  });

  it("rejects invalid numeric and public URL configuration", () => {
    expect(() => loadConfig({ API_KEY: apiKey, PORT: "nope" })).toThrow("PORT");
    expect(() => loadConfig({ API_KEY: apiKey, PUBLIC_BASE_URL: "ftp://example.test" })).toThrow(
      "PUBLIC_BASE_URL",
    );
  });

  it("parses and validates Selenium browser capabilities", () => {
    const config = loadConfig({
      API_KEY: apiKey,
      BROWSER_SELENIUM_REMOTE_URL: "http://selenium-hub:4444/wd/hub/",
      SELENIUM_BROWSERS: "chromium,firefox,edge,chromium",
    });
    expect(config.seleniumBrowsers).toEqual(["chromium", "firefox", "edge"]);
    expect(config.seleniumRemoteUrl).toBe("http://selenium-hub:4444/wd/hub");
    expect(() => loadConfig({ API_KEY: apiKey, SELENIUM_BROWSERS: "safari" })).toThrow(
      "SELENIUM_BROWSERS",
    );
    expect(() => loadConfig({ API_KEY: apiKey, SELENIUM_BROWSERS: "webkit" })).toThrow(
      "SELENIUM_BROWSERS",
    );
  });

  it("loads every explicit worker and operational setting", () => {
    expect(
      loadConfig({
        ALLOWED_HOSTS: " Example.COM,*.Internal.test,example.com, ",
        APP_ROLE: "worker",
        ARTIFACT_BACKEND: "s3",
        ARTIFACT_RETENTION_HOURS: "24",
        ARTIFACT_ROOT: " C:\\artifacts ",
        AWS_ACCESS_KEY_ID: " access ",
        AWS_SECRET_ACCESS_KEY: " secret ",
        DATABASE_URL: " postgres://custom ",
        DISPATCHER_INTERVAL_MS: "100",
        HOST: "127.0.0.1",
        LOG_LEVEL: "debug",
        MAX_ACTIVE_JOBS_PER_CLIENT: "5",
        OTEL_EXPORTER_OTLP_ENDPOINT: " http://collector ",
        PORT: "8080",
        PUBLIC_BASE_URL: "https://automation.test///",
        REDIS_URL: "redis://custom",
        SELENIUM_BROWSERS: " ",
        S3_BUCKET: "automation",
        S3_ENDPOINT: "http://minio/",
        S3_FORCE_PATH_STYLE: "true",
        S3_REGION: "sa-east-1",
        SHUTDOWN_TIMEOUT_MS: "5000",
        SWAGGER_ENABLED: "false",
        WORKER_CAPACITY_UNITS: "2",
        WORKER_CONCURRENCY: "3",
        WORKER_ADAPTER: "playwright",
      }),
    ).toMatchObject({
      allowedHosts: ["example.com", "*.internal.test"],
      appRole: "worker",
      artifactBackend: "s3",
      artifactRetentionMs: 86_400_000,
      artifactRoot: "C:\\artifacts",
      awsAccessKeyId: "access",
      awsSecretAccessKey: "secret",
      bootstrapApiKeyHash: undefined,
      databaseUrl: "postgres://custom",
      dispatcherIntervalMs: 100,
      host: "127.0.0.1",
      logLevel: "debug",
      maxActiveJobsPerClient: 5,
      otelEndpoint: "http://collector",
      port: 8080,
      publicBaseUrl: "https://automation.test",
      redisUrl: "redis://custom",
      seleniumBrowsers: ["chromium"],
      s3Bucket: "automation",
      s3Endpoint: "http://minio",
      s3ForcePathStyle: true,
      s3Region: "sa-east-1",
      shutdownTimeoutMs: 5000,
      swaggerEnabled: false,
      workerCapacityUnits: 2,
      workerConcurrency: 3,
      workerAdapter: "playwright",
    });
  });

  it("validates roles, adapters, worker capacity and booleans", () => {
    expect(() => loadConfig({ API_KEY: apiKey, APP_ROLE: "invalid" })).toThrow("APP_ROLE");
    expect(() => loadConfig({ APP_ROLE: "worker" })).toThrow("WORKER_ADAPTER is required");
    expect(() =>
      loadConfig({
        APP_ROLE: "worker",
        WORKER_ADAPTER: "invalid",
      }),
    ).toThrow("WORKER_ADAPTER");
    expect(() =>
      loadConfig({
        APP_ROLE: "worker",
        WORKER_CAPACITY_UNITS: "1",
        WORKER_ADAPTER: "playwright",
      }),
    ).toThrow("at least 2 capacity");
    expect(() => loadConfig({ API_KEY: apiKey, SWAGGER_ENABLED: "yes" })).toThrow(
      "SWAGGER_ENABLED",
    );
    expect(loadConfig({ API_KEY: apiKey, SWAGGER_ENABLED: "true" }).swaggerEnabled).toBe(true);
    expect(() => loadConfig({ API_KEY: apiKey, ARTIFACT_BACKEND: "ftp" })).toThrow(
      "ARTIFACT_BACKEND",
    );
    expect(() => loadConfig({ API_KEY: apiKey, S3_FORCE_PATH_STYLE: "yes" })).toThrow(
      "S3_FORCE_PATH_STYLE",
    );
    expect(() => loadConfig({ API_KEY: apiKey, LOG_LEVEL: "verbose" })).toThrow("LOG_LEVEL");
  });

  it("rejects unsafe integer ranges and preserves blank defaults", () => {
    for (const [name, value] of [
      ["PORT", "0"],
      ["WORKER_CONCURRENCY", "1.5"],
      ["DISPATCHER_INTERVAL_MS", "49"],
      ["SHUTDOWN_TIMEOUT_MS", "999"],
    ] as [string, string][]) {
      expect(() => loadConfig({ API_KEY: apiKey, [name]: value })).toThrow(name);
    }
    expect(
      loadConfig({
        API_KEY: apiKey,
        ARTIFACT_ROOT: " ",
        OTEL_EXPORTER_OTLP_ENDPOINT: " ",
      }),
    ).toMatchObject({
      artifactRoot: "/data/artifacts",
      otelEndpoint: undefined,
    });
  });
});
