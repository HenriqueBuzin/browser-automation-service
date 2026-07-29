import { chromium, firefox, webkit } from "playwright";
import type {
  AutomationBrowser,
  AdapterRuntime,
  AdapterSession,
} from "../../domain/automation-adapter.js";

export class PlaywrightAdapter implements AdapterRuntime {
  public readonly browsers = ["chromium", "firefox", "webkit"] as const;
  public readonly adapter = "playwright";

  public async launch(leaseId: string, browser: AutomationBrowser): Promise<AdapterSession> {
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
      adapter: this.adapter,
      onClose: (listener) => {
        server.once("close", listener);
      },
      protocol: "playwright",
    };
  }
}
