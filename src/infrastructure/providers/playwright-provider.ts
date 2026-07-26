import { chromium, firefox, webkit } from "playwright";
import type {
  AutomationBrowser,
  AutomationProvider,
  ProviderSession,
} from "../../domain/automation-provider.js";

export class PlaywrightProvider implements AutomationProvider {
  public readonly browsers = ["chromium", "firefox", "webkit"] as const;
  public readonly engine = "playwright";

  public async launch(leaseId: string, browser: AutomationBrowser): Promise<ProviderSession> {
    const browserType =
      browser === "chromium" ? chromium : browser === "firefox" ? firefox : webkit;
    const server = await browserType.launchServer({
      chromiumSandbox: false,
      headless: true,
      wsPath: `/browser/${leaseId}`,
    });
    return {
      browser,
      close: async () => {
        await server.close();
      },
      endpoint: server.wsEndpoint(),
      engine: this.engine,
      onClose: (listener) => {
        server.once("close", listener);
      },
      protocol: "playwright",
    };
  }
}
