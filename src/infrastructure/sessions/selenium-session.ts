import {
  Builder,
  Button,
  By,
  Key,
  type WebDriver,
  type WebElement,
  until,
} from "selenium-webdriver";
import type {
  AutomationSession,
  AutomationSessionConnector,
} from "../../application/automation-session.js";
import type { AutomationBrowser } from "../../domain/automation-provider.js";
import type { ExtractKind, MouseButton, SelectorState } from "../../domain/automation-job.js";
import { pollUntil } from "./polling.js";

const seleniumNames: Record<Exclude<AutomationBrowser, "webkit">, string> = {
  chromium: "chrome",
  edge: "MicrosoftEdge",
  firefox: "firefox",
};

export class SeleniumSessionConnector implements AutomationSessionConnector {
  public readonly driver = "selenium";

  public constructor(public readonly browser: AutomationBrowser) {}

  public async connect(endpoint: string): Promise<AutomationSession> {
    if (this.browser === "webkit") throw new Error("Selenium does not support WebKit on Linux");
    const driver = await new Builder()
      .usingServer(endpoint)
      .forBrowser(seleniumNames[this.browser])
      .build();
    return new SeleniumAutomationSession(driver);
  }
}

class SeleniumAutomationSession implements AutomationSession {
  public constructor(private readonly driver: WebDriver) {}

  public async back(): Promise<void> {
    await this.driver.navigate().back();
  }

  public async check(selector: string, checked: boolean): Promise<void> {
    const element = await this.#element(selector);
    if ((await element.isSelected()) !== checked) await element.click();
  }

  public async click(
    selector: string,
    options: { button: MouseButton; clickCount: number },
  ): Promise<void> {
    const element = await this.#element(selector);
    const button = {
      left: Button.LEFT,
      middle: Button.MIDDLE,
      right: Button.RIGHT,
    }[options.button];
    const actions = this.driver.actions({ async: true }).move({ origin: element });
    for (let index = 0; index < options.clickCount; index += 1) {
      if (button === Button.LEFT) actions.click();
      else actions.press(button).release(button);
    }
    await actions.perform();
  }

  public async close(): Promise<void> {
    await this.driver.quit();
  }

  public async extract(
    kind: ExtractKind,
    selector?: string,
    attribute?: string,
  ): Promise<boolean | number | string> {
    if (kind === "title") return this.driver.getTitle();
    if (kind === "url") return this.driver.getCurrentUrl();
    const target = requiredSelector(kind, selector);
    if (kind === "count") return (await this.driver.findElements(By.css(target))).length;
    const element = await this.#element(target);
    if (kind === "visible") return element.isDisplayed();
    if (kind === "text") return element.getText();
    if (kind === "html") return (await element.getAttribute("outerHTML")) ?? "";
    if (kind === "value") return (await element.getAttribute("value")) ?? "";
    return (await element.getAttribute(requiredAttribute(attribute))) ?? "";
  }

  public async fill(selector: string, value: string): Promise<void> {
    const element = await this.#element(selector);
    await element.clear();
    await element.sendKeys(value);
  }

  public async focus(selector: string): Promise<void> {
    await this.driver.executeScript("arguments[0].focus()", await this.#element(selector));
  }

  public async forward(): Promise<void> {
    await this.driver.navigate().forward();
  }

  public async goto(
    url: string,
    waitUntil: "domcontentloaded" | "load" | "networkidle",
  ): Promise<void> {
    await this.driver.get(url);
    if (waitUntil === "networkidle") {
      await this.wait(500);
    }
  }

  public async hover(selector: string): Promise<void> {
    await this.driver
      .actions({ async: true })
      .move({ origin: await this.#element(selector) })
      .perform();
  }

  public async press(key: string, selector?: string): Promise<void> {
    const target = selector
      ? await this.#element(selector)
      : this.driver.switchTo().activeElement();
    await target.sendKeys(seleniumKey(key));
  }

  public async reload(): Promise<void> {
    await this.driver.navigate().refresh();
  }

  public async screenshot(): Promise<string> {
    return this.driver.takeScreenshot();
  }

  public async scroll(x: number, y: number, selector?: string): Promise<void> {
    if (selector) {
      await this.driver.executeScript(
        "arguments[0].scrollIntoView({block:'center'})",
        await this.#element(selector),
      );
    }
    await this.driver.executeScript("window.scrollBy(arguments[0], arguments[1])", x, y);
  }

  public async select(selector: string, values: string[]): Promise<void> {
    const element = await this.#element(selector);
    for (const value of values) {
      await element.findElement(By.css(`option[value="${escapeCssValue(value)}"]`)).click();
    }
  }

  public async setViewport(width: number, height: number): Promise<void> {
    await this.driver.manage().window().setRect({ height, width, x: 0, y: 0 });
  }

  public async type(selector: string, text: string, delayMs: number): Promise<void> {
    const element = await this.#element(selector);
    if (delayMs === 0) {
      await element.sendKeys(text);
      return;
    }
    for (const character of text) {
      await element.sendKeys(character);
      await this.wait(delayMs);
    }
  }

  public async wait(durationMs: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, durationMs));
  }

  public async waitForSelector(
    selector: string,
    state: SelectorState,
    timeoutMs: number,
  ): Promise<void> {
    const locator = By.css(selector);
    if (state === "attached") {
      await this.driver.wait(until.elementLocated(locator), timeoutMs);
      return;
    }
    if (state === "visible") {
      const element = await this.driver.wait(until.elementLocated(locator), timeoutMs);
      await this.driver.wait(until.elementIsVisible(element), timeoutMs);
      return;
    }
    await pollUntil(
      async () => {
        const elements = await this.driver.findElements(locator);
        if (state === "detached") return elements.length === 0;
        const first = elements[0];
        return first === undefined || !(await first.isDisplayed());
      },
      timeoutMs,
      `${selector} to be ${state}`,
    );
  }

  public async waitForUrl(contains: string, timeoutMs: number): Promise<void> {
    await this.driver.wait(until.urlContains(contains), timeoutMs);
  }

  async #element(selector: string): Promise<WebElement> {
    return this.driver.wait(until.elementLocated(By.css(selector)), 30_000);
  }
}

function requiredSelector(kind: ExtractKind, selector: string | undefined): string {
  if (!selector) throw new Error(`selector is required for '${kind}'`);
  return selector;
}

function requiredAttribute(attribute: string | undefined): string {
  if (!attribute) throw new Error("attribute is required for attribute extraction");
  return attribute;
}

function seleniumKey(key: string): string {
  const named: Record<string, string> = {
    ArrowDown: Key.ARROW_DOWN,
    ArrowLeft: Key.ARROW_LEFT,
    ArrowRight: Key.ARROW_RIGHT,
    ArrowUp: Key.ARROW_UP,
    Backspace: Key.BACK_SPACE,
    Delete: Key.DELETE,
    End: Key.END,
    Enter: Key.ENTER,
    Escape: Key.ESCAPE,
    Home: Key.HOME,
    PageDown: Key.PAGE_DOWN,
    PageUp: Key.PAGE_UP,
    Space: Key.SPACE,
    Tab: Key.TAB,
  };
  return named[key] ?? key;
}

function escapeCssValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
