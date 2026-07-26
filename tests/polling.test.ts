import { afterEach, describe, expect, it, vi } from "vitest";
import { pollUntil } from "../src/infrastructure/sessions/polling.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("pollUntil", () => {
  it("returns immediately when the predicate succeeds", async () => {
    await expect(pollUntil(async () => true, 100, "ready")).resolves.toBeUndefined();
  });

  it("retries and reports a timeout", async () => {
    vi.useFakeTimers();
    const operation = pollUntil(async () => false, 50, "never");
    const rejection = expect(operation).rejects.toThrow("Timed out waiting for never");
    await vi.runAllTimersAsync();
    await rejection;
  });
});
