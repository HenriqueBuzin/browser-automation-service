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
});
