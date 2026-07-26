import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const option = { click: vi.fn(async () => undefined) };
  const element = {
    clear: vi.fn(async () => undefined),
    click: vi.fn(async () => undefined),
    findElement: vi.fn(() => option),
    getAttribute: vi.fn(async (name: string) => {
      if (name === "missing") return null;
      return name === "outerHTML" ? "<div>html</div>" : name === "value" ? "value" : "attribute";
    }),
    getText: vi.fn(async () => "text"),
    isDisplayed: vi.fn(async () => true),
    isSelected: vi.fn(async () => false),
    sendKeys: vi.fn(async () => undefined),
  };
  const actions = {
    click: vi.fn(),
    move: vi.fn(),
    perform: vi.fn(async () => undefined),
    press: vi.fn(),
    release: vi.fn(),
  };
  for (const method of ["click", "move", "press", "release"] as const) {
    actions[method].mockReturnValue(actions);
  }
  const navigation = {
    back: vi.fn(async () => undefined),
    forward: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
  };
  const activeElement = { sendKeys: vi.fn(async () => undefined) };
  const driver = {
    actions: vi.fn(() => actions),
    executeScript: vi.fn(async () => undefined),
    findElements: vi.fn(async () => [element]),
    get: vi.fn(async () => undefined),
    getCurrentUrl: vi.fn(async () => "https://example.test/done"),
    getTitle: vi.fn(async () => "title"),
    manage: vi.fn(() => ({
      window: () => ({ setRect: vi.fn(async () => undefined) }),
    })),
    navigate: vi.fn(() => navigation),
    quit: vi.fn(async () => undefined),
    switchTo: vi.fn(() => ({ activeElement: () => activeElement })),
    takeScreenshot: vi.fn(async () => "base64"),
    wait: vi.fn(async (condition: { kind?: string }) =>
      condition.kind === "located" ? element : undefined,
    ),
  };
  const builder = {
    build: vi.fn(async () => driver),
    forBrowser: vi.fn(),
    usingServer: vi.fn(),
  };
  builder.forBrowser.mockReturnValue(builder);
  builder.usingServer.mockReturnValue(builder);
  return { actions, activeElement, builder, driver, element, navigation, option };
});

vi.mock("selenium-webdriver", () => ({
  Builder: class {
    usingServer = mocks.builder.usingServer;
    forBrowser = mocks.builder.forBrowser;
    build = mocks.builder.build;
  },
  Button: { LEFT: 0, MIDDLE: 1, RIGHT: 2 },
  By: { css: (value: string) => ({ css: value }) },
  Key: {
    ARROW_DOWN: "ARROW_DOWN",
    ARROW_LEFT: "ARROW_LEFT",
    ARROW_RIGHT: "ARROW_RIGHT",
    ARROW_UP: "ARROW_UP",
    BACK_SPACE: "BACK_SPACE",
    DELETE: "DELETE",
    END: "END",
    ENTER: "ENTER",
    ESCAPE: "ESCAPE",
    HOME: "HOME",
    PAGE_DOWN: "PAGE_DOWN",
    PAGE_UP: "PAGE_UP",
    SPACE: "SPACE",
    TAB: "TAB",
  },
  until: {
    elementIsVisible: (element: unknown) => ({ element, kind: "visible" }),
    elementLocated: (locator: unknown) => ({ kind: "located", locator }),
    urlContains: (value: string) => ({ kind: "url", value }),
  },
}));

import { SeleniumSessionConnector } from "../src/infrastructure/sessions/selenium-session.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.builder.forBrowser.mockReturnValue(mocks.builder);
  mocks.builder.usingServer.mockReturnValue(mocks.builder);
  mocks.element.isSelected.mockResolvedValue(false);
  mocks.element.isDisplayed.mockResolvedValue(true);
  mocks.driver.findElements.mockResolvedValue([mocks.element]);
  mocks.driver.wait.mockImplementation(async (condition: { kind?: string }) =>
    condition.kind === "located" ? mocks.element : undefined,
  );
  for (const method of ["click", "move", "press", "release"] as const) {
    mocks.actions[method].mockReturnValue(mocks.actions);
  }
});

describe("Selenium session adapter", () => {
  it.each([
    ["chromium", "chrome"],
    ["firefox", "firefox"],
    ["edge", "MicrosoftEdge"],
  ] as const)("connects %s using the Grid browser name", async (browser, seleniumName) => {
    await new SeleniumSessionConnector(browser).connect("http://grid");
    expect(mocks.builder.usingServer).toHaveBeenCalledWith("http://grid");
    expect(mocks.builder.forBrowser).toHaveBeenCalledWith(seleniumName);
  });

  it("rejects WebKit before creating a Grid session", async () => {
    await expect(new SeleniumSessionConnector("webkit").connect("http://grid")).rejects.toThrow(
      "does not support WebKit",
    );
  });

  it("translates interaction and navigation including mouse buttons", async () => {
    const session = await new SeleniumSessionConnector("chromium").connect("http://grid");
    await session.back();
    await session.check("#check", true);
    mocks.element.isSelected.mockResolvedValueOnce(true);
    await session.check("#check", true);
    await session.click("#button", { button: "left", clickCount: 2 });
    await session.click("#button", { button: "right", clickCount: 1 });
    await session.click("#button", { button: "middle", clickCount: 1 });
    await session.fill("#input", "value");
    await session.focus("#input");
    await session.forward();
    await session.goto("https://example.test", "load");
    vi.useFakeTimers();
    const networkIdle = session.goto("https://example.test", "networkidle");
    await vi.runAllTimersAsync();
    await networkIdle;
    vi.useRealTimers();
    await session.hover("#target");
    await session.press("Enter", "#input");
    await session.press("x");
    await session.reload();
    await expect(session.screenshot(false)).resolves.toBe("base64");
    await session.scroll(1, 2, "#target");
    await session.scroll(3, 4);
    await session.select("#select", ['a"b', "c\\d"]);
    await session.setViewport(1280, 720);
    await session.type("#input", "text", 0);
    vi.useFakeTimers();
    const typed = session.type("#input", "ab", 5);
    await vi.runAllTimersAsync();
    await typed;
    vi.useRealTimers();
    await session.close();
    expect(mocks.navigation.back).toHaveBeenCalled();
    expect(mocks.actions.click).toHaveBeenCalled();
    expect(mocks.actions.press).toHaveBeenCalled();
    expect(mocks.driver.quit).toHaveBeenCalled();
  });

  it("extracts every portable kind with null fallbacks and argument validation", async () => {
    const session = await new SeleniumSessionConnector("chromium").connect("http://grid");
    await expect(session.extract("title")).resolves.toBe("title");
    await expect(session.extract("url")).resolves.toContain("/done");
    await expect(session.extract("count", "#item")).resolves.toBe(1);
    await expect(session.extract("visible", "#item")).resolves.toBe(true);
    await expect(session.extract("text", "#item")).resolves.toBe("text");
    await expect(session.extract("html", "#item")).resolves.toBe("<div>html</div>");
    await expect(session.extract("value", "#item")).resolves.toBe("value");
    await expect(session.extract("attribute", "#item", "name")).resolves.toBe("attribute");
    await expect(session.extract("attribute", "#item", "missing")).resolves.toBe("");
    mocks.element.getAttribute.mockResolvedValueOnce(null);
    await expect(session.extract("html", "#item")).resolves.toBe("");
    mocks.element.getAttribute.mockResolvedValueOnce(null);
    await expect(session.extract("value", "#item")).resolves.toBe("");
    await expect(session.extract("count")).rejects.toThrow("selector is required");
    await expect(session.extract("attribute", "#item")).rejects.toThrow("attribute is required");
  });

  it("waits for attached, visible, detached, hidden and URL states", async () => {
    const session = await new SeleniumSessionConnector("chromium").connect("http://grid");
    await session.waitForSelector("#item", "attached", 100);
    await session.waitForSelector("#item", "visible", 100);
    mocks.driver.findElements.mockResolvedValueOnce([]);
    await session.waitForSelector("#item", "detached", 100);
    mocks.element.isDisplayed.mockResolvedValueOnce(false);
    await session.waitForSelector("#item", "hidden", 100);
    mocks.driver.findElements.mockResolvedValueOnce([]);
    await session.waitForSelector("#item", "hidden", 100);
    await session.waitForUrl("/done", 100);
    expect(mocks.driver.wait).toHaveBeenCalled();
  });
});
