import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AutomationBrowser, AutomationEngine } from "./contracts/job-contract.js";

const seleniumBrowserNames = ["chromium", "firefox", "edge"] as const;
const roles = ["api", "dispatcher", "worker"] as const;
const drivers = ["playwright", "puppeteer", "selenium"] as const;

export type AppConfig = {
  artifactBackend: "local" | "s3";
  allowedHosts: string[];
  artifactRetentionMs: number;
  appRole: (typeof roles)[number];
  artifactRoot: string;
  awsAccessKeyId: string | undefined;
  awsSecretAccessKey: string | undefined;
  bootstrapApiKeyHash: string | undefined;
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
  s3Bucket: string;
  s3Endpoint: string | undefined;
  s3ForcePathStyle: boolean;
  s3Region: string;
  shutdownTimeoutMs: number;
  swaggerEnabled: boolean;
  workerConcurrency: number;
  workerCapacityUnits: number;
  workerDriver: AutomationEngine | undefined;
};

type SecretFileReader = (path: string) => Buffer;

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
  readSecretFile: SecretFileReader = (path) => readFileSync(path),
): AppConfig {
  const appRole = enumeration(environment.APP_ROLE ?? "api", roles, "APP_ROLE");
  const artifactBackend = enumeration(
    environment.ARTIFACT_BACKEND ?? "local",
    ["local", "s3"] as const,
    "ARTIFACT_BACKEND",
  );
  const bootstrapApiKeyHash =
    appRole === "api" ? readApiKeyHash(environment, readSecretFile) : undefined;
  const awsAccessKeyId = secretText(environment, "AWS_ACCESS_KEY_ID", readSecretFile);
  const awsSecretAccessKey = secretText(environment, "AWS_SECRET_ACCESS_KEY", readSecretFile);
  if (Boolean(awsAccessKeyId) !== Boolean(awsSecretAccessKey)) {
    throw new Error("AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be configured together");
  }
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
    artifactBackend,
    allowedHosts: list(environment.ALLOWED_HOSTS),
    artifactRetentionMs:
      integer("ARTIFACT_RETENTION_HOURS", environment.ARTIFACT_RETENTION_HOURS, 168, 1) *
      60 *
      60 *
      1_000,
    appRole,
    artifactRoot: text(environment.ARTIFACT_ROOT, "/data/artifacts"),
    awsAccessKeyId,
    awsSecretAccessKey,
    bootstrapApiKeyHash,
    databaseUrl:
      secretText(environment, "DATABASE_URL", readSecretFile) ??
      "postgres://browser:browser@postgres:5432/browser_automation",
    dispatcherIntervalMs: integer(
      "DISPATCHER_INTERVAL_MS",
      environment.DISPATCHER_INTERVAL_MS,
      500,
      50,
    ),
    host: text(environment.HOST, "0.0.0.0"),
    logLevel: enumeration(
      environment.LOG_LEVEL ?? "info",
      ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const,
      "LOG_LEVEL",
    ),
    maxActiveJobsPerClient: integer(
      "MAX_ACTIVE_JOBS_PER_CLIENT",
      environment.MAX_ACTIVE_JOBS_PER_CLIENT,
      10,
      1,
    ),
    otelEndpoint: optional(environment.OTEL_EXPORTER_OTLP_ENDPOINT),
    port: integer("PORT", environment.PORT, 3_000, 1),
    publicBaseUrl,
    redisUrl: redisUrl(environment, readSecretFile),
    seleniumBrowsers: browserList(environment.SELENIUM_BROWSERS),
    seleniumRemoteUrl: optional(environment.BROWSER_SELENIUM_REMOTE_URL)?.replace(/\/+$/u, ""),
    s3Bucket: text(environment.S3_BUCKET, "browser-artifacts"),
    s3Endpoint: optional(environment.S3_ENDPOINT)?.replace(/\/+$/u, ""),
    s3ForcePathStyle: boolean(environment.S3_FORCE_PATH_STYLE, false, "S3_FORCE_PATH_STYLE"),
    s3Region: text(environment.S3_REGION, "us-east-1"),
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

function readApiKeyHash(environment: NodeJS.ProcessEnv, readSecretFile: SecretFileReader): string {
  const secret = secretBuffer(environment, "API_KEY", readSecretFile);
  if (!secret) throw new Error("API_KEY or API_KEY_FILE is required");
  try {
    if (secret.byteLength < 32) {
      throw new Error("API_KEY must contain at least 32 characters");
    }
    return createHash("sha256").update(secret).digest("hex");
  } finally {
    secret.fill(0);
  }
}

function redisUrl(environment: NodeJS.ProcessEnv, readSecretFile: SecretFileReader): string {
  const url = secretText(environment, "REDIS_URL", readSecretFile);
  const password = secretText(environment, "REDIS_PASSWORD", readSecretFile);
  if (url && password) {
    throw new Error("REDIS_URL and REDIS_PASSWORD are mutually exclusive");
  }
  return (
    url ??
    (password ? `redis://:${encodeURIComponent(password)}@redis:6379/0` : "redis://redis:6379/0")
  );
}

function secretText(
  environment: NodeJS.ProcessEnv,
  name: string,
  readSecretFile: SecretFileReader,
): string | undefined {
  const secret = secretBuffer(environment, name, readSecretFile);
  if (!secret) return undefined;
  try {
    return secret.toString("utf8");
  } finally {
    secret.fill(0);
  }
}

function secretBuffer(
  environment: NodeJS.ProcessEnv,
  name: string,
  readSecretFile: SecretFileReader,
): Buffer | undefined {
  const direct = optional(environment[name]);
  const file = optional(environment[`${name}_FILE`]);
  if (direct && file) throw new Error(`${name} and ${name}_FILE are mutually exclusive`);
  if (direct) return Buffer.from(direct, "utf8");
  if (!file) return undefined;
  let contents: Buffer;
  try {
    contents = readSecretFile(file);
  } catch (error) {
    throw new Error(`Unable to read ${name}_FILE '${file}'`, { cause: error });
  }
  let start = 0;
  while (start < contents.byteLength && contents.readUInt8(start) <= 0x20) start += 1;
  let end = contents.byteLength;
  while (end > start && contents.readUInt8(end - 1) <= 0x20) end -= 1;
  const normalized = Buffer.from(contents.subarray(start, end));
  contents.fill(0);
  if (normalized.byteLength === 0) {
    normalized.fill(0);
    throw new Error(`${name}_FILE '${file}' is empty`);
  }
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

function boolean(value: string | undefined, fallback: boolean, name = "SWAGGER_ENABLED"): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
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
