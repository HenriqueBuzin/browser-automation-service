import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const locator = {
    check: vi.fn(async () => undefined),
    click: vi.fn(async () => undefined),
    count: vi.fn(async () => 2),
    evaluate: vi.fn(async () => "<div>html</div>"),
    fill: vi.fn(async () => undefined),
    first: vi.fn(),
    focus: vi.fn(async () => undefined),
    getAttribute: vi.fn(async () => "attribute"),
    hover: vi.fn(async () => undefined),
    inputValue: vi.fn(async () => "value"),
    isVisible: vi.fn(async () => true),
    press: vi.fn(async () => undefined),
    pressSequentially: vi.fn(async () => undefined),
    scrollIntoViewIfNeeded: vi.fn(async () => undefined),
    selectOption: vi.fn(async () => undefined),
    textContent: vi.fn(async () => "text"),
    uncheck: vi.fn(async () => undefined),
    waitFor: vi.fn(async () => undefined),
  };
  locator.first.mockReturnValue(locator);
  const page = {
    evaluate: vi.fn(async () => undefined),
    goBack: vi.fn(async () => undefined),
    goForward: vi.fn(async () => undefined),
    goto: vi.fn(async () => undefined),
    keyboard: { press: vi.fn(async () => undefined) },
    locator: vi.fn(() => locator),
    reload: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => Buffer.from("image")),
    setViewportSize: vi.fn(async () => undefined),
    title: vi.fn(async () => "title"),
    url: vi.fn(() => "https://example.test/done"),
    waitForTimeout: vi.fn(async () => undefined),
    waitForURL: vi.fn(async (predicate: (url: URL) => boolean) => {
      predicate(new URL("https://example.test/done"));
    }),
  };
  const context = {
    close: vi.fn(async () => undefined),
    newPage: vi.fn(async () => page),
  };
  const browser = {
    close: vi.fn(async () => undefined),
    newContext: vi.fn(async () => context),
  };
  const server = {
    close: vi.fn(async () => undefined),
    once: vi.fn(),
    wsEndpoint: vi.fn(() => "ws://playwright"),
  };
  const type = () => ({
    connect: vi.fn(async () => browser),
    executablePath: vi.fn(() => "/browser"),
    launchServer: vi.fn(async () => server),
  });
  return {
    browser,
    chromium: type(),
    context,
    firefox: type(),
    locator,
    page,
    server,
    webkit: type(),
  };
});

vi.mock("playwright", () => ({
  chromium: mocks.chromium,
  firefox: mocks.firefox,
  webkit: mocks.webkit,
}));

import { PlaywrightAdapter } from "../src/infrastructure/adapters/playwright-adapter.js";
import { PlaywrightSessionConnector } from "../src/infrastructure/sessions/playwright-session.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", { scrollBy: vi.fn() });
  mocks.locator.first.mockReturnValue(mocks.locator);
  mocks.locator.textContent.mockResolvedValue("text");
  mocks.locator.getAttribute.mockResolvedValue("attribute");
  mocks.locator.evaluate.mockImplementation((async (
    callback: (element: { outerHTML: string }) => unknown,
  ) => callback({ outerHTML: "<div>html</div>" })) as never);
  mocks.page.evaluate.mockImplementation((async (
    callback: (value: { left: number; top: number }) => unknown,
    value: { left: number; top: number },
  ) => callback(value)) as never);
});

describe("Playwright adapter", () => {
  it.each([
    ["chromium", mocks.chromium],
    ["firefox", mocks.firefox],
    ["webkit", mocks.webkit],
  ] as const)("launches %s and exposes a close-aware provider session", async (browser, type) => {
    const session = await new PlaywrightAdapter().launch("execution", browser);
    expect(type.launchServer).toHaveBeenCalledWith({
      chromiumSandbox: false,
      headless: true,
      wsPath: "/browser/execution",
    });
    expect(session).toMatchObject({
      browser,
      endpoint: "ws://playwright",
      adapter: "playwright",
      protocol: "playwright",
    });
    const listener = vi.fn();
    session.onClose(listener);
    expect(mocks.server.once).toHaveBeenCalledWith("close", listener);
    await session.close();
    expect(mocks.server.close).toHaveBeenCalled();
  });

  it.each([
    ["chromium", mocks.chromium],
    ["firefox", mocks.firefox],
    ["webkit", mocks.webkit],
  ] as const)("connects the %s browser type", async (browser, type) => {
    const session = await new PlaywrightSessionConnector(browser).connect("ws://endpoint");
    expect(type.connect).toHaveBeenCalledWith("ws://endpoint");
    await session.close();
    expect(mocks.context.close).toHaveBeenCalled();
    expect(mocks.browser.close).toHaveBeenCalled();
  });

  it("translates the complete portable session contract", async () => {
    const session = await new PlaywrightSessionConnector("chromium").connect("ws://endpoint");
    await session.back();
    await session.check("#check", true);
    await session.check("#check", false);
    await session.click("#button", { button: "right", clickCount: 2 });
    await session.fill("#input", "value");
    await session.focus("#input");
    await session.forward();
    await session.goto("https://example.test", "networkidle");
    await session.hover("#button");
    await session.press("Enter", "#input");
    await session.press("Escape");
    await session.reload();
    expect(await session.screenshot(true)).toBe(Buffer.from("image").toString("base64"));
    await session.scroll(1, 2, "#target");
    await session.scroll(3, 4);
    await session.select("#select", ["one", "two"]);
    await session.setViewport(1280, 720);
    await session.type("#input", "text", 5);
    await session.wait(10);
    await session.waitForSelector("#ready", "visible", 100);
    await session.waitForUrl("/done", 100);

    expect(mocks.locator.check).toHaveBeenCalled();
    expect(mocks.locator.uncheck).toHaveBeenCalled();
    expect(mocks.page.keyboard.press).toHaveBeenCalledWith("Escape");
    expect(mocks.locator.scrollIntoViewIfNeeded).toHaveBeenCalled();
    expect(mocks.page.evaluate).toHaveBeenCalledTimes(2);
  });

  it("extracts every supported value and validates required arguments", async () => {
    const session = await new PlaywrightSessionConnector("chromium").connect("ws://endpoint");
    await expect(session.extract("title")).resolves.toBe("title");
    await expect(session.extract("url")).resolves.toBe("https://example.test/done");
    await expect(session.extract("count", "#item")).resolves.toBe(2);
    await expect(session.extract("visible", "#item")).resolves.toBe(true);
    await expect(session.extract("text", "#item")).resolves.toBe("text");
    mocks.locator.textContent.mockResolvedValueOnce(null as never);
    await expect(session.extract("text", "#item")).resolves.toBe("");
    await expect(session.extract("value", "#item")).resolves.toBe("value");
    await expect(session.extract("html", "#item")).resolves.toBe("<div>html</div>");
    await expect(session.extract("attribute", "#item", "name")).resolves.toBe("attribute");
    mocks.locator.getAttribute.mockResolvedValueOnce(null as never);
    await expect(session.extract("attribute", "#item", "name")).resolves.toBe("");
    await expect(session.extract("count")).rejects.toThrow("selector is required");
    await expect(session.extract("attribute", "#item")).rejects.toThrow("attribute is required");
  });
});
