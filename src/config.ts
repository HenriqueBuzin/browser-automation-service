import type { AutomationBrowser, AutomationEngine } from "./contracts/job-contract.js";

const seleniumBrowserNames = ["chromium", "firefox", "edge"] as const;
const roles = ["api", "dispatcher", "worker"] as const;
const drivers = ["playwright", "puppeteer", "selenium"] as const;

export type AppConfig = {
  apiKey: string;
  allowedHosts: string[];
  artifactRetentionMs: number;
  appRole: (typeof roles)[number];
  artifactRoot: string;
  databaseUrl: string;
  dispatcherIntervalMs: number;
  host: string;
  logLevel: string;
  maxActiveJobsPerClient: number;
  otelEndpoint: string | undefined;
  port: number;
  publicBaseUrl: string;
  redisUrl: string;
  seleniumBrowsers: AutomationBrowser[];
  seleniumRemoteUrl: string | undefined;
  shutdownTimeoutMs: number;
  swaggerEnabled: boolean;
  workerConcurrency: number;
  workerCapacityUnits: number;
  workerDriver: AutomationEngine | undefined;
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const apiKey = required(environment.API_KEY, "API_KEY");
  if (apiKey.length < 32) throw new Error("API_KEY must contain at least 32 characters");
  const appRole = enumeration(environment.APP_ROLE ?? "api", roles, "APP_ROLE");
  const workerDriver = environment.WORKER_DRIVER
    ? enumeration(environment.WORKER_DRIVER, drivers, "WORKER_DRIVER")
    : undefined;
  if (appRole === "worker" && !workerDriver) {
    throw new Error("WORKER_DRIVER is required when APP_ROLE=worker");
  }
  const workerCapacityUnits = integer(
    "WORKER_CAPACITY_UNITS",
    environment.WORKER_CAPACITY_UNITS,
    2,
    1,
  );
  if (appRole === "worker" && workerDriver === "playwright" && workerCapacityUnits < 2) {
    throw new Error("Playwright workers require at least 2 capacity units for WebKit");
  }
  const publicBaseUrl = text(environment.PUBLIC_BASE_URL, "http://localhost:3000").replace(
    /\/+$/u,
    "",
  );
  if (!/^https?:\/\//u.test(publicBaseUrl)) {
    throw new Error("PUBLIC_BASE_URL must start with http:// or https://");
  }
  return {
    apiKey,
    allowedHosts: list(environment.ALLOWED_HOSTS),
    artifactRetentionMs:
      integer("ARTIFACT_RETENTION_HOURS", environment.ARTIFACT_RETENTION_HOURS, 168, 1) *
      60 *
      60 *
      1_000,
    appRole,
    artifactRoot: text(environment.ARTIFACT_ROOT, "/data/artifacts"),
    databaseUrl: text(
      environment.DATABASE_URL,
      "postgres://browser:browser@postgres:5432/browser_automation",
    ),
    dispatcherIntervalMs: integer(
      "DISPATCHER_INTERVAL_MS",
      environment.DISPATCHER_INTERVAL_MS,
      500,
      50,
    ),
    host: text(environment.HOST, "0.0.0.0"),
    logLevel: text(environment.LOG_LEVEL, "info"),
    maxActiveJobsPerClient: integer(
      "MAX_ACTIVE_JOBS_PER_CLIENT",
      environment.MAX_ACTIVE_JOBS_PER_CLIENT,
      10,
      1,
    ),
    otelEndpoint: optional(environment.OTEL_EXPORTER_OTLP_ENDPOINT),
    port: integer("PORT", environment.PORT, 3_000, 1),
    publicBaseUrl,
    redisUrl: text(environment.REDIS_URL, "redis://redis:6379/0"),
    seleniumBrowsers: browserList(environment.SELENIUM_BROWSERS),
    seleniumRemoteUrl: optional(environment.BROWSER_SELENIUM_REMOTE_URL)?.replace(/\/+$/u, ""),
    shutdownTimeoutMs: integer(
      "SHUTDOWN_TIMEOUT_MS",
      environment.SHUTDOWN_TIMEOUT_MS,
      30_000,
      1_000,
    ),
    swaggerEnabled: boolean(environment.SWAGGER_ENABLED, true),
    workerConcurrency: integer("WORKER_CONCURRENCY", environment.WORKER_CONCURRENCY, 1, 1),
    workerCapacityUnits,
    workerDriver,
  };
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function text(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized === undefined || normalized === "" ? fallback : normalized;
}

function optional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized === "" ? undefined : normalized;
}

function integer(
  name: string,
  value: string | undefined,
  fallback: number,
  minimum: number,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${String(minimum)}`);
  }
  return parsed;
}

function boolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("SWAGGER_ENABLED must be true or false");
}

function enumeration<const T extends readonly string[]>(
  value: string,
  values: T,
  name: string,
): T[number] {
  const match = values.find((candidate) => candidate === value);
  if (!match) throw new Error(`${name} must be one of: ${values.join(", ")}`);
  return match;
}

function browserList(value: string | undefined): AutomationBrowser[] {
  if (!value?.trim()) return ["chromium"];
  const browsers = [...new Set(value.split(",").map((entry) => entry.trim()))];
  for (const browser of browsers) {
    if (!isSeleniumBrowser(browser)) {
      throw new Error(`SELENIUM_BROWSERS contains unsupported browser '${browser}'`);
    }
  }
  return browsers.filter(isSeleniumBrowser);
}

function isSeleniumBrowser(browser: string): browser is (typeof seleniumBrowserNames)[number] {
  return seleniumBrowserNames.some((candidate) => candidate === browser);
}

function list(value: string | undefined): string[] {
  return value
    ? [
        ...new Set(
          value
            .split(",")
            .map((entry) => entry.trim().toLowerCase())
            .filter(Boolean),
        ),
      ]
    : [];
}
