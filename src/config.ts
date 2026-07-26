import type { AutomationBrowser } from "./domain/automation-provider.js";
import { z } from "./validation.js";

const seleniumBrowserNames = ["chromium", "firefox", "edge"] as const;

export type AppConfig = {
  apiKey: string;
  host: string;
  leaseConnectTimeoutMs: number;
  logLevel: string;
  maxConcurrentBrowsers: number;
  maxJobParallelism: number;
  maxLeaseDurationMs: number;
  maxQueueSize: number;
  maxQueueWaitMs: number;
  metricsApiKey: string;
  port: number;
  publicWsUrl: string | undefined;
  seleniumBrowsers: AutomationBrowser[];
  seleniumRemoteUrl: string | undefined;
  shutdownTimeoutMs: number;
};

function integer(name: string, value: string | undefined, fallback: number, min: number): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min) {
    throw new Error(`${name} must be an integer greater than or equal to ${String(min)}`);
  }
  return parsed;
}

function text(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized === undefined || normalized === "" ? fallback : normalized;
}

function browserList(value: string | undefined): AutomationBrowser[] {
  if (!value?.trim()) return ["chromium"];
  const browsers = [...new Set(value.split(",").map((entry) => entry.trim()))];
  for (const browser of browsers) {
    if (!seleniumBrowserNames.includes(browser as (typeof seleniumBrowserNames)[number])) {
      throw new Error(`SELENIUM_BROWSERS contains unsupported browser '${browser}'`);
    }
  }
  return browsers as AutomationBrowser[];
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const apiKey = z.nonEmpty(environment.API_KEY, "API_KEY");
  if (apiKey.length < 32) {
    throw new Error("API_KEY must contain at least 32 characters");
  }

  const publicWsUrl = environment.PUBLIC_WS_URL?.trim().replace(/\/+$/, "");
  if (publicWsUrl && !/^wss?:\/\//u.test(publicWsUrl)) {
    throw new Error("PUBLIC_WS_URL must start with ws:// or wss://");
  }

  return {
    apiKey,
    host: text(environment.HOST, "0.0.0.0"),
    leaseConnectTimeoutMs: integer(
      "LEASE_CONNECT_TIMEOUT_MS",
      environment.LEASE_CONNECT_TIMEOUT_MS,
      30_000,
      1_000,
    ),
    logLevel: text(environment.LOG_LEVEL, "info"),
    maxJobParallelism: integer("MAX_JOB_PARALLELISM", environment.MAX_JOB_PARALLELISM, 2, 1),
    maxLeaseDurationMs: integer(
      "MAX_LEASE_DURATION_MS",
      environment.MAX_LEASE_DURATION_MS,
      900_000,
      10_000,
    ),
    maxConcurrentBrowsers: integer(
      "MAX_CONCURRENT_BROWSERS",
      environment.MAX_CONCURRENT_BROWSERS,
      2,
      1,
    ),
    maxQueueSize: integer("MAX_QUEUE_SIZE", environment.MAX_QUEUE_SIZE, 20, 0),
    maxQueueWaitMs: integer("MAX_QUEUE_WAIT_MS", environment.MAX_QUEUE_WAIT_MS, 120_000, 0),
    metricsApiKey: text(environment.METRICS_API_KEY, apiKey),
    port: integer("PORT", environment.PORT, 3_000, 1),
    publicWsUrl,
    seleniumBrowsers: browserList(environment.SELENIUM_BROWSERS),
    seleniumRemoteUrl: environment.BROWSER_SELENIUM_REMOTE_URL?.trim().replace(/\/+$/, ""),
    shutdownTimeoutMs: integer(
      "SHUTDOWN_TIMEOUT_MS",
      environment.SHUTDOWN_TIMEOUT_MS,
      30_000,
      1_000,
    ),
  };
}
