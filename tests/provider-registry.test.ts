import { describe, expect, it } from "vitest";
import {
  ProviderNotAvailableError,
  ProviderRegistry,
} from "../src/application/provider-registry.js";
import type { AutomationProvider } from "../src/domain/automation-provider.js";

const provider: AutomationProvider = {
  engine: "playwright",
  launch: () => Promise.reject(new Error("not used")),
};

describe("ProviderRegistry", () => {
  it("lists and resolves configured providers", () => {
    const registry = new ProviderRegistry([provider]);
    expect(registry.engines()).toEqual(["playwright"]);
    expect(registry.get("playwright")).toBe(provider);
  });

  it("rejects an engine that is not configured", () => {
    const registry = new ProviderRegistry([provider]);
    expect(() => registry.get("selenium")).toThrow(ProviderNotAvailableError);
  });
});
