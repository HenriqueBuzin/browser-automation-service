import pino, { type Logger } from "pino";

export type PlatformLogger = Pick<Logger, "error" | "info" | "warn">;

export const silentLogger: PlatformLogger = {
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
};

export function createPlatformLogger(role: string, level: string): PlatformLogger {
  return pino({
    base: { role, service: "browser-automation" },
    level,
    redact: {
      paths: ["apiKey", "authorization", "req.headers.authorization", "req.headers.x-api-key"],
      censor: "[REDACTED]",
    },
  });
}
