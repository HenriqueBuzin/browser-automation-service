import { describe, expect, it } from "vitest";
import {
  BrowserNotSupportedError,
  ProviderNotAvailableError,
  ProviderRegistry,
} from "../src/application/provider-registry.js";
import type { AutomationProvider } from "../src/domain/automation-provider.js";
import { automationBrowsers, automationEngines } from "../src/domain/automation-provider.js";
import { SessionConnectorRegistry } from "../src/application/session-connector-registry.js";

const provider: AutomationProvider = {
  browsers: ["chromium"],
  engine: "playwright",
  launch: () => Promise.reject(new Error("not used")),
};

describe("ProviderRegistry", () => {
  it("lists and resolves configured providers", () => {
    const registry = new ProviderRegistry([provider]);
    expect(registry.engines()).toEqual(["playwright"]);
    expect(registry.capabilities()).toEqual([{ browser: "chromium", engine: "playwright" }]);
    expect(registry.get("playwright")).toBe(provider);
    expect(registry.getForBrowser("playwright", "chromium")).toBe(provider);
    expect(automationEngines).toEqual(["playwright", "puppeteer", "selenium"]);
    expect(automationBrowsers).toEqual(["chromium", "firefox", "webkit", "edge"]);
  });

  it("rejects a missing session connector", () => {
    expect(() => new SessionConnectorRegistry([]).get("playwright", "chromium")).toThrow(
      "No job connector",
    );
  });

  it("rejects an unsupported browser for a configured provider", () => {
    const registry = new ProviderRegistry([provider]);
    expect(() => registry.getForBrowser("playwright", "webkit")).toThrow(BrowserNotSupportedError);
  });

  it("rejects an engine that is not configured", () => {
    const registry = new ProviderRegistry([provider]);
    expect(() => registry.get("selenium")).toThrow(ProviderNotAvailableError);
  });
});
