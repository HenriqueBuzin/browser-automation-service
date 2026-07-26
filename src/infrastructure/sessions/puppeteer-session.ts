import puppeteer, {
  type Browser,
  type ElementHandle,
  type KeyInput,
  type Page,
} from "puppeteer-core";
import type {
  AutomationSession,
  AutomationSessionConnector,
} from "../../application/automation-session.js";
import type { AutomationBrowser } from "../../domain/automation-provider.js";
import type { ExtractKind, MouseButton, SelectorState } from "../../domain/automation-job.js";
import { pollUntil } from "./polling.js";

export class PuppeteerSessionConnector implements AutomationSessionConnector {
  public readonly driver = "puppeteer";

  public constructor(public readonly browser: AutomationBrowser) {}

  public async connect(endpoint: string, nativeHandle?: unknown): Promise<AutomationSession> {
    const browser =
      nativeHandle instanceof Object && "newPage" in nativeHandle
        ? (nativeHandle as Browser)
        : await puppeteer.connect({
            browserWSEndpoint: endpoint,
            protocol: this.browser === "firefox" ? "webDriverBiDi" : "cdp",
          });
    const page = await browser.newPage();
    return new PuppeteerAutomationSession(browser, page);
  }
}

class PuppeteerAutomationSession implements AutomationSession {
  public constructor(
    private readonly browser: Browser,
    private readonly page: Page,
  ) {}

  public async back(): Promise<void> {
    await this.page.goBack();
  }

  public async check(selector: string, checked: boolean): Promise<void> {
    const element = await this.#element(selector);
    const current = await element.evaluate(
      (node) => node instanceof HTMLInputElement && node.checked,
    );
    if (current !== checked) await element.click();
  }

  public async click(
    selector: string,
    options: { button: MouseButton; clickCount: number },
  ): Promise<void> {
    await this.page.click(selector, {
      button: options.button,
      count: options.clickCount,
    });
  }

  public async close(): Promise<void> {
    await this.page.close();
    await this.browser.close();
  }

  public async extract(
    kind: ExtractKind,
    selector?: string,
    attribute?: string,
  ): Promise<boolean | number | string> {
    if (kind === "title") return this.page.title();
    if (kind === "url") return this.page.url();
    const target = requiredSelector(kind, selector);
    if (kind === "count") return (await this.page.$$(target)).length;
    const element = await this.#element(target);
    if (kind === "visible") {
      return element.evaluate((node) => {
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.height > 0;
      });
    }
    if (kind === "text") return element.evaluate((node) => node.textContent);
    if (kind === "html") return element.evaluate((node) => node.outerHTML);
    if (kind === "value") {
      return element.evaluate((node) => ("value" in node ? (node as HTMLInputElement).value : ""));
    }
    return element.evaluate(
      (node, name) => node.getAttribute(name) ?? "",
      requiredAttribute(attribute),
    );
  }

  public async fill(selector: string, value: string): Promise<void> {
    const element = await this.#element(selector);
    await element.click({ count: 3 });
    await this.page.keyboard.press("Backspace");
    await element.type(value);
  }

  public async focus(selector: string): Promise<void> {
    await this.page.focus(selector);
  }

  public async forward(): Promise<void> {
    await this.page.goForward();
  }

  public async goto(
    url: string,
    waitUntil: "domcontentloaded" | "load" | "networkidle",
  ): Promise<void> {
    await this.page.goto(url, {
      waitUntil: waitUntil === "networkidle" ? "networkidle0" : waitUntil,
    });
  }

  public async hover(selector: string): Promise<void> {
    await this.page.hover(selector);
  }

  public async press(key: string, selector?: string): Promise<void> {
    if (selector) await this.page.focus(selector);
    await this.page.keyboard.press(key as KeyInput);
  }

  public async reload(): Promise<void> {
    await this.page.reload();
  }

  public async screenshot(fullPage: boolean): Promise<string> {
    return await this.page.screenshot({ encoding: "base64", fullPage });
  }

  public async scroll(x: number, y: number, selector?: string): Promise<void> {
    if (selector) {
      await (
        await this.#element(selector)
      ).evaluate((node) => node.scrollIntoView({ block: "center" }));
    }
    await this.page.evaluate(({ left, top }) => window.scrollBy({ left, top }), {
      left: x,
      top: y,
    });
  }

  public async select(selector: string, values: string[]): Promise<void> {
    await this.page.select(selector, ...values);
  }

  public async setViewport(width: number, height: number): Promise<void> {
    await this.page.setViewport({ height, width });
  }

  public async type(selector: string, text: string, delayMs: number): Promise<void> {
    await this.page.type(selector, text, { delay: delayMs });
  }

  public async wait(durationMs: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, durationMs));
  }

  public async waitForSelector(
    selector: string,
    state: SelectorState,
    timeoutMs: number,
  ): Promise<void> {
    if (state === "visible") {
      await this.page.waitForSelector(selector, { timeout: timeoutMs, visible: true });
      return;
    }
    if (state === "hidden") {
      await this.page.waitForSelector(selector, { hidden: true, timeout: timeoutMs });
      return;
    }
    await pollUntil(
      async () => ((await this.page.$(selector)) !== null) === (state === "attached"),
      timeoutMs,
      `${selector} to be ${state}`,
    );
  }

  public async waitForUrl(contains: string, timeoutMs: number): Promise<void> {
    await pollUntil(
      () => Promise.resolve(this.page.url().includes(contains)),
      timeoutMs,
      `URL containing '${contains}'`,
    );
  }

  async #element(selector: string): Promise<ElementHandle> {
    const element = await this.page.waitForSelector(selector);
    if (!element) throw new Error(`Element not found: ${selector}`);
    return element;
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
