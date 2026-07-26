import { chromium } from "playwright";
import puppeteer from "puppeteer-core";
import type { AutomationProvider, ProviderSession } from "../../domain/automation-provider.js";

export class PuppeteerProvider implements AutomationProvider {
  public readonly engine = "puppeteer";

  public constructor(private readonly executablePath = resolveExecutablePath()) {}

  public async launch(): Promise<ProviderSession> {
    const browser = await puppeteer.launch({
      args: ["--no-sandbox"],
      executablePath: this.executablePath,
      headless: true,
    });
    return {
      close: async () => {
        await browser.close();
      },
      endpoint: browser.wsEndpoint(),
      engine: this.engine,
      onClose: (listener) => {
        browser.once("disconnected", listener);
      },
      protocol: "cdp",
    };
  }
}

function resolveExecutablePath(): string {
  const configured = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
  return configured === undefined || configured === "" ? chromium.executablePath() : configured;
}
