import { chromium, firefox } from "playwright";
import puppeteer from "puppeteer-core";
import type {
  AutomationBrowser,
  AutomationProvider,
  ProviderSession,
} from "../../domain/automation-provider.js";

export class PuppeteerProvider implements AutomationProvider {
  public readonly browsers = ["chromium", "firefox"] as const;
  public readonly engine = "puppeteer";

  public constructor(
    private readonly executablePaths: Record<"chromium" | "firefox", string> = {
      chromium: resolveExecutablePath("chromium"),
      firefox: resolveExecutablePath("firefox"),
    },
  ) {}

  public async launch(_leaseId: string, browserName: AutomationBrowser): Promise<ProviderSession> {
    if (browserName !== "chromium" && browserName !== "firefox") {
      throw new Error(`Puppeteer cannot launch ${browserName}`);
    }
    const browser = await puppeteer.launch({
      args: ["--no-sandbox"],
      browser: browserName === "firefox" ? "firefox" : "chrome",
      executablePath: this.executablePaths[browserName],
      headless: true,
    });
    return {
      browser: browserName,
      close: async () => {
        await browser.close();
      },
      endpoint: browser.wsEndpoint(),
      engine: this.engine,
      nativeHandle: browser,
      onClose: (listener) => {
        browser.once("disconnected", listener);
      },
      protocol: browserName === "firefox" ? "webdriver-bidi" : "cdp",
    };
  }
}

function resolveExecutablePath(browser: "chromium" | "firefox"): string {
  const variable =
    browser === "chromium" ? "PUPPETEER_EXECUTABLE_PATH" : "PUPPETEER_FIREFOX_EXECUTABLE_PATH";
  const configured = process.env[variable]?.trim();
  if (configured !== undefined && configured !== "") return configured;
  return browser === "chromium" ? chromium.executablePath() : firefox.executablePath();
}
