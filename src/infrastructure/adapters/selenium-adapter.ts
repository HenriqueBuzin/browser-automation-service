import type {
  AutomationBrowser,
  AdapterRuntime,
  AdapterSession,
} from "../../domain/automation-adapter.js";

/**
 * Selenium Grid already owns browser processes, its session queue and cleanup.
 * This adapter reserves capacity in the control plane and returns the Grid URL.
 */
export class SeleniumAdapter implements AdapterRuntime {
  public readonly adapter = "selenium";

  public constructor(
    private readonly remoteUrl: string,
    public readonly browsers: readonly AutomationBrowser[] = ["chromium"],
  ) {}

  public async launch(_leaseId: string, browser: AutomationBrowser): Promise<AdapterSession> {
    return {
      browser,
      close: async () => undefined,
      endpoint: this.remoteUrl,
      adapter: this.adapter,
      onClose: () => undefined,
      protocol: "webdriver",
    };
  }
}
