import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const element = {
    checked: false,
    click: vi.fn(async () => undefined),
    evaluate: vi.fn(),
    findElement: vi.fn(),
    getAttribute: vi.fn(),
    getBoundingClientRect: () => ({ height: 1 }),
    outerHTML: "<div>html</div>",
    scrollIntoView: vi.fn(),
    textContent: "text",
    type: vi.fn(async () => undefined),
    value: "value",
  };
  element.evaluate.mockImplementation(
    async (callback: (node: typeof element, argument?: string) => unknown, argument?: string) =>
      callback(element, argument),
  );
  const page = {
    $: vi.fn(async () => element),
    $$: vi.fn(async () => [element, element]),
    click: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => undefined),
    focus: vi.fn(async () => undefined),
    goBack: vi.fn(async () => undefined),
    goForward: vi.fn(async () => undefined),
    goto: vi.fn(async () => undefined),
    hover: vi.fn(async () => undefined),
    keyboard: { press: vi.fn(async () => undefined) },
    reload: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => "base64"),
    select: vi.fn(async () => undefined),
    setViewport: vi.fn(async () => undefined),
    title: vi.fn(async () => "title"),
    type: vi.fn(async () => undefined),
    url: vi.fn(() => "https://example.test/done"),
    waitForSelector: vi.fn(async () => element),
  };
  const browser = {
    close: vi.fn(async () => undefined),
    newPage: vi.fn(async () => page),
    once: vi.fn(),
    wsEndpoint: vi.fn(() => "ws://puppeteer"),
  };
  return {
    browser,
    connect: vi.fn(async () => browser),
    element,
    launch: vi.fn(async () => browser),
    page,
  };
});

vi.mock("playwright", () => ({
  chromium: { executablePath: () => "/playwright/chromium" },
  firefox: { executablePath: () => "/playwright/firefox" },
}));

vi.mock("puppeteer-core", () => ({
  default: {
    connect: mocks.connect,
    launch: mocks.launch,
  },
}));

import { PuppeteerProvider } from "../src/infrastructure/providers/puppeteer-provider.js";
import { PuppeteerSessionConnector } from "../src/infrastructure/sessions/puppeteer-session.js";

class FakeInput {
  marker = true;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("HTMLInputElement", FakeInput);
  vi.stubGlobal("window", {
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    scrollBy: vi.fn(),
  });
  Object.setPrototypeOf(mocks.element, FakeInput.prototype);
  mocks.element.checked = false;
  mocks.element.textContent = "text";
  mocks.element.value = "value";
  mocks.element.getAttribute = vi.fn((name: string) => (name === "missing" ? null : "attribute"));
  mocks.element.evaluate.mockImplementation(
    async (
      callback: (node: typeof mocks.element, argument?: string) => unknown,
      argument?: string,
    ) => callback(mocks.element, argument),
  );
  mocks.page.waitForSelector.mockResolvedValue(mocks.element);
  mocks.page.$.mockResolvedValue(mocks.element);
  mocks.page.evaluate.mockImplementation((async (
    callback: (value: { left: number; top: number }) => unknown,
    value: { left: number; top: number },
  ) => callback(value)) as never);
  delete process.env.PUPPETEER_EXECUTABLE_PATH;
  delete process.env.PUPPETEER_FIREFOX_EXECUTABLE_PATH;
});

describe("Puppeteer adapter", () => {
  it.each([
    ["chromium", "chrome", "cdp", "/playwright/chromium"],
    ["firefox", "firefox", "webdriver-bidi", "/playwright/firefox"],
  ] as const)(
    "launches %s with its real protocol",
    async (browser, browserOption, protocol, path) => {
      const session = await new PuppeteerProvider().launch("execution", browser);
      expect(mocks.launch).toHaveBeenCalledWith({
        args: ["--no-sandbox"],
        browser: browserOption,
        executablePath: path,
        headless: true,
      });
      expect(session).toMatchObject({
        browser,
        endpoint: "ws://puppeteer",
        engine: "puppeteer",
        nativeHandle: mocks.browser,
        protocol,
      });
      const listener = vi.fn();
      session.onClose(listener);
      expect(mocks.browser.once).toHaveBeenCalledWith("disconnected", listener);
      await session.close();
      expect(mocks.browser.close).toHaveBeenCalled();
    },
  );

  it("uses configured executables and rejects unsupported browsers", async () => {
    process.env.PUPPETEER_EXECUTABLE_PATH = " /custom/chrome ";
    process.env.PUPPETEER_FIREFOX_EXECUTABLE_PATH = " /custom/firefox ";
    const provider = new PuppeteerProvider();
    await provider.launch("execution", "chromium");
    await provider.launch("execution", "firefox");
    const launchCalls = mocks.launch.mock.calls as unknown[][];
    expect((launchCalls[0]?.[0] as { executablePath?: string } | undefined)?.executablePath).toBe(
      "/custom/chrome",
    );
    expect((launchCalls[1]?.[0] as { executablePath?: string } | undefined)?.executablePath).toBe(
      "/custom/firefox",
    );
    await expect(provider.launch("execution", "webkit")).rejects.toThrow(
      "Puppeteer cannot launch webkit",
    );
  });

  it("connects through CDP/BiDi or reuses a native browser handle", async () => {
    await new PuppeteerSessionConnector("chromium").connect("ws://cdp");
    expect(mocks.connect).toHaveBeenCalledWith({
      browserWSEndpoint: "ws://cdp",
      protocol: "cdp",
    });
    await new PuppeteerSessionConnector("firefox").connect("ws://bidi");
    expect(mocks.connect).toHaveBeenLastCalledWith({
      browserWSEndpoint: "ws://bidi",
      protocol: "webDriverBiDi",
    });
    mocks.connect.mockClear();
    await new PuppeteerSessionConnector("chromium").connect("ignored", mocks.browser);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("translates navigation, interaction and synchronization", async () => {
    const session = await new PuppeteerSessionConnector("chromium").connect(
      "ignored",
      mocks.browser,
    );
    await session.back();
    await session.check("#check", true);
    mocks.element.checked = true;
    await session.check("#check", true);
    await session.click("#button", { button: "middle", clickCount: 2 });
    await session.fill("#input", "value");
    await session.focus("#input");
    await session.forward();
    await session.goto("https://example.test", "networkidle");
    await session.goto("https://example.test", "load");
    await session.hover("#button");
    await session.press("Enter", "#input");
    await session.press("Escape");
    await session.reload();
    await expect(session.screenshot(true)).resolves.toBe("base64");
    await session.scroll(1, 2, "#target");
    await session.scroll(3, 4);
    await session.select("#select", ["one", "two"]);
    await session.setViewport(1280, 720);
    await session.type("#input", "text", 1);
    await session.wait(1);
    await session.waitForSelector("#ready", "visible", 100);
    await session.waitForSelector("#ready", "hidden", 100);
    await session.waitForSelector("#ready", "attached", 100);
    mocks.page.$.mockResolvedValueOnce(null as never);
    await session.waitForSelector("#ready", "detached", 100);
    await session.waitForUrl("/done", 100);
    await session.close();
    expect(mocks.page.close).toHaveBeenCalled();
    expect(mocks.browser.close).toHaveBeenCalled();
  });

  it("extracts all portable values and reports missing arguments/elements", async () => {
    const session = await new PuppeteerSessionConnector("chromium").connect(
      "ignored",
      mocks.browser,
    );
    await expect(session.extract("title")).resolves.toBe("title");
    await expect(session.extract("url")).resolves.toContain("/done");
    await expect(session.extract("count", "#item")).resolves.toBe(2);
    await expect(session.extract("visible", "#item")).resolves.toBe(true);
    vi.stubGlobal("window", {
      getComputedStyle: () => ({ display: "none", visibility: "hidden" }),
      scrollBy: vi.fn(),
    });
    await expect(session.extract("visible", "#item")).resolves.toBe(false);
    await expect(session.extract("text", "#item")).resolves.toBe("text");
    await expect(session.extract("html", "#item")).resolves.toBe("<div>html</div>");
    await expect(session.extract("value", "#item")).resolves.toBe("value");
    delete (mocks.element as { value?: string }).value;
    await expect(session.extract("value", "#item")).resolves.toBe("");
    mocks.element.value = "value";
    await expect(session.extract("attribute", "#item", "name")).resolves.toBe("attribute");
    await expect(session.extract("attribute", "#item", "missing")).resolves.toBe("");
    await expect(session.extract("count")).rejects.toThrow("selector is required");
    await expect(session.extract("attribute", "#item")).rejects.toThrow("attribute is required");
    mocks.page.waitForSelector.mockResolvedValueOnce(null as never);
    await expect(session.fill("#missing", "value")).rejects.toThrow("Element not found");
  });
});
