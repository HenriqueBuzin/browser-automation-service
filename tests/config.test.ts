import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const apiKey = "a".repeat(32);

describe("loadConfig", () => {
  it("loads safe defaults", () => {
    const config = loadConfig({ API_KEY: apiKey });
    expect(config).toMatchObject({
      apiKey,
      appRole: "api",
      artifactRetentionMs: 604_800_000,
      maxActiveJobsPerClient: 10,
      port: 3000,
      seleniumBrowsers: ["chromium"],
      workerCapacityUnits: 2,
      workerConcurrency: 1,
    });
    expect(config.publicBaseUrl).toBe("http://localhost:3000");
  });

  it("rejects missing or weak secrets", () => {
    expect(() => loadConfig({})).toThrow("API_KEY is required");
    expect(() => loadConfig({ API_KEY: "weak" })).toThrow("at least 32");
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
        API_KEY: ` ${apiKey} `,
        APP_ROLE: "worker",
        ARTIFACT_RETENTION_HOURS: "24",
        ARTIFACT_ROOT: " C:\\artifacts ",
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
        SHUTDOWN_TIMEOUT_MS: "5000",
        SWAGGER_ENABLED: "false",
        WORKER_CAPACITY_UNITS: "2",
        WORKER_CONCURRENCY: "3",
        WORKER_DRIVER: "playwright",
      }),
    ).toMatchObject({
      allowedHosts: ["example.com", "*.internal.test"],
      apiKey,
      appRole: "worker",
      artifactRetentionMs: 86_400_000,
      artifactRoot: "C:\\artifacts",
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
      shutdownTimeoutMs: 5000,
      swaggerEnabled: false,
      workerCapacityUnits: 2,
      workerConcurrency: 3,
      workerDriver: "playwright",
    });
  });

  it("validates roles, drivers, worker capacity and booleans", () => {
    expect(() => loadConfig({ API_KEY: apiKey, APP_ROLE: "invalid" })).toThrow("APP_ROLE");
    expect(() => loadConfig({ API_KEY: apiKey, APP_ROLE: "worker" })).toThrow(
      "WORKER_DRIVER is required",
    );
    expect(() =>
      loadConfig({
        API_KEY: apiKey,
        APP_ROLE: "worker",
        WORKER_DRIVER: "invalid",
      }),
    ).toThrow("WORKER_DRIVER");
    expect(() =>
      loadConfig({
        API_KEY: apiKey,
        APP_ROLE: "worker",
        WORKER_CAPACITY_UNITS: "1",
        WORKER_DRIVER: "playwright",
      }),
    ).toThrow("at least 2 capacity");
    expect(() => loadConfig({ API_KEY: apiKey, SWAGGER_ENABLED: "yes" })).toThrow(
      "SWAGGER_ENABLED",
    );
    expect(loadConfig({ API_KEY: apiKey, SWAGGER_ENABLED: "true" }).swaggerEnabled).toBe(true);
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
