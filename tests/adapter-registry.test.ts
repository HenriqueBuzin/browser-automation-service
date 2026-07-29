import { describe, expect, it } from "vitest";
import {
  AdapterNotAvailableError,
  BrowserNotSupportedError,
  AdapterRegistry,
} from "../src/application/adapter-registry.js";
import type { AdapterRuntime } from "../src/domain/automation-adapter.js";
import { automationBrowsers, automationAdapters } from "../src/domain/automation-adapter.js";
import { SessionConnectorRegistry } from "../src/application/session-connector-registry.js";

const adapter: AdapterRuntime = {
  browsers: ["chromium"],
  adapter: "playwright",
  launch: () => Promise.reject(new Error("not used")),
};

describe("AdapterRegistry", () => {
  it("lists and resolves configured providers", () => {
    const registry = new AdapterRegistry([adapter]);
    expect(registry.adapters()).toEqual(["playwright"]);
    expect(registry.capabilities()).toEqual([{ browser: "chromium", adapter: "playwright" }]);
    expect(registry.get("playwright")).toBe(adapter);
    expect(registry.getForBrowser("playwright", "chromium")).toBe(adapter);
    expect(automationAdapters).toHaveLength(11);
    expect(automationBrowsers).toEqual(["chromium", "firefox", "webkit", "edge"]);
  });

  it("rejects a missing session connector", () => {
    expect(() => new SessionConnectorRegistry([]).get("playwright", "chromium")).toThrow(
      "No job connector",
    );
  });

  it("rejects an unsupported browser for a configured provider", () => {
    const registry = new AdapterRegistry([adapter]);
    expect(() => registry.getForBrowser("playwright", "webkit")).toThrow(BrowserNotSupportedError);
  });

  it("rejects an adapter that is not configured", () => {
    const registry = new AdapterRegistry([adapter]);
    expect(() => registry.get("selenium")).toThrow(AdapterNotAvailableError);
  });
});
