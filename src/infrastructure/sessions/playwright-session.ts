import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import type {
  AutomationSession,
  AutomationSessionConnector,
} from "../../application/automation-session.js";
import type { AutomationBrowser } from "../../domain/automation-adapter.js";
import type { ExtractKind, MouseButton, SelectorState } from "../../domain/automation-job.js";

export class PlaywrightSessionConnector implements AutomationSessionConnector {
  public readonly adapter = "playwright";

  public constructor(public readonly browser: AutomationBrowser) {}

  public async connect(endpoint: string): Promise<AutomationSession> {
    const browserType =
      this.browser === "chromium" ? chromium : this.browser === "firefox" ? firefox : webkit;
    const browser = await browserType.connect(endpoint);
    const context = await browser.newContext();
    const page = await context.newPage();
    return new PlaywrightAutomationSession(browser, context, page);
  }
}

class PlaywrightAutomationSession implements AutomationSession {
  public constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly page: Page,
  ) {}

  public async back(): Promise<void> {
    await this.page.goBack();
  }

  public async check(selector: string, checked: boolean): Promise<void> {
    if (checked) await this.page.locator(selector).check();
    else await this.page.locator(selector).uncheck();
  }

  public async click(
    selector: string,
    options: { button: MouseButton; clickCount: number },
  ): Promise<void> {
    await this.page.locator(selector).click(options);
  }

  public async close(): Promise<void> {
    await this.context.close();
    await this.browser.close();
  }

  public async extract(
    kind: ExtractKind,
    selector?: string,
    attribute?: string,
  ): Promise<boolean | number | string> {
    if (kind === "title") return this.page.title();
    if (kind === "url") return this.page.url();
    const locator = this.page.locator(requiredSelector(kind, selector));
    if (kind === "count") return locator.count();
    if (kind === "visible") return locator.first().isVisible();
    if (kind === "text") return (await locator.first().textContent()) ?? "";
    if (kind === "value") return locator.first().inputValue();
    if (kind === "html") return locator.first().evaluate((element) => element.outerHTML);
    return (await locator.first().getAttribute(requiredAttribute(attribute))) ?? "";
  }

  public async fill(selector: string, value: string): Promise<void> {
    await this.page.locator(selector).fill(value);
  }

  public async focus(selector: string): Promise<void> {
    await this.page.locator(selector).focus();
  }

  public async forward(): Promise<void> {
    await this.page.goForward();
  }

  public async goto(
    url: string,
    waitUntil: "domcontentloaded" | "load" | "networkidle",
  ): Promise<void> {
    await this.page.goto(url, { waitUntil });
  }

  public async hover(selector: string): Promise<void> {
    await this.page.locator(selector).hover();
  }

  public async press(key: string, selector?: string): Promise<void> {
    if (selector) await this.page.locator(selector).press(key);
    else await this.page.keyboard.press(key);
  }

  public async reload(): Promise<void> {
    await this.page.reload();
  }

  public async screenshot(fullPage: boolean): Promise<string> {
    return (await this.page.screenshot({ fullPage })).toString("base64");
  }

  public async scroll(x: number, y: number, selector?: string): Promise<void> {
    if (selector) await this.page.locator(selector).scrollIntoViewIfNeeded();
    await this.page.evaluate(({ left, top }) => window.scrollBy({ left, top }), {
      left: x,
      top: y,
    });
  }

  public async select(selector: string, values: string[]): Promise<void> {
    await this.page.locator(selector).selectOption(values);
  }

  public async setViewport(width: number, height: number): Promise<void> {
    await this.page.setViewportSize({ height, width });
  }

  public async type(selector: string, text: string, delayMs: number): Promise<void> {
    await this.page.locator(selector).pressSequentially(text, { delay: delayMs });
  }

  public async wait(durationMs: number): Promise<void> {
    await this.page.waitForTimeout(durationMs);
  }

  public async waitForSelector(
    selector: string,
    state: SelectorState,
    timeoutMs: number,
  ): Promise<void> {
    await this.page.locator(selector).waitFor({ state, timeout: timeoutMs });
  }

  public async waitForUrl(contains: string, timeoutMs: number): Promise<void> {
    await this.page.waitForURL((url) => url.toString().includes(contains), {
      timeout: timeoutMs,
    });
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
