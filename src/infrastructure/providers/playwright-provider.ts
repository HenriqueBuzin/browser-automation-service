import { chromium } from "playwright";
import type { AutomationProvider, ProviderSession } from "../../domain/automation-provider.js";

export class PlaywrightProvider implements AutomationProvider {
  public readonly engine = "playwright";

  public async launch(leaseId: string): Promise<ProviderSession> {
    const server = await chromium.launchServer({
      headless: true,
      wsPath: `/browser/${leaseId}`,
    });
    return {
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
