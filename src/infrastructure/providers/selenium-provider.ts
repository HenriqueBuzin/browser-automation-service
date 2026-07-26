import type { AutomationProvider, ProviderSession } from "../../domain/automation-provider.js";

/**
 * Selenium Grid already owns browser processes, its session queue and cleanup.
 * This provider reserves capacity in the control plane and returns the Grid URL.
 */
export class SeleniumProvider implements AutomationProvider {
  public readonly engine = "selenium";

  public constructor(private readonly remoteUrl: string) {}

  public async launch(): Promise<ProviderSession> {
    return {
      close: async () => undefined,
      endpoint: this.remoteUrl,
      engine: this.engine,
      onClose: () => undefined,
      protocol: "webdriver",
    };
  }
}
