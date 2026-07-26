import { vi } from "vitest";
import type { AutomationSession } from "../../src/application/automation-session.js";

export function fakeSession(overrides: Partial<AutomationSession> = {}): AutomationSession {
  return {
    back: vi.fn(async () => undefined),
    check: vi.fn(async () => undefined),
    click: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    extract: vi.fn(async (kind) => {
      if (kind === "count") return 2;
      if (kind === "visible") return true;
      if (kind === "title") return "Example title";
      if (kind === "url") return "https://example.test/done";
      return "Example value";
    }),
    fill: vi.fn(async () => undefined),
    focus: vi.fn(async () => undefined),
    forward: vi.fn(async () => undefined),
    goto: vi.fn(async () => undefined),
    hover: vi.fn(async () => undefined),
    press: vi.fn(async () => undefined),
    reload: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => "base64-image"),
    scroll: vi.fn(async () => undefined),
    select: vi.fn(async () => undefined),
    setViewport: vi.fn(async () => undefined),
    type: vi.fn(async () => undefined),
    wait: vi.fn(async () => undefined),
    waitForSelector: vi.fn(async () => undefined),
    waitForUrl: vi.fn(async () => undefined),
    ...overrides,
  };
}
