import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const apiKey = "a".repeat(32);

describe("loadConfig", () => {
  it("loads safe defaults", () => {
    const config = loadConfig({ API_KEY: apiKey });
    expect(config).toMatchObject({
      apiKey,
      maxConcurrentBrowsers: 2,
      maxLeaseDurationMs: 900_000,
      maxQueueSize: 20,
      port: 3000,
    });
    expect(config.publicWsUrl).toBeUndefined();
  });

  it("rejects missing or weak secrets", () => {
    expect(() => loadConfig({})).toThrow("API_KEY is required");
    expect(() => loadConfig({ API_KEY: "weak" })).toThrow("at least 32");
  });

  it("rejects invalid numeric and WebSocket configuration", () => {
    expect(() => loadConfig({ API_KEY: apiKey, PORT: "nope" })).toThrow("PORT");
    expect(() => loadConfig({ API_KEY: apiKey, PUBLIC_WS_URL: "https://example.test" })).toThrow(
      "PUBLIC_WS_URL",
    );
  });
});
