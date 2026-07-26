import type { AutomationBrowser, AutomationEngine } from "../domain/automation-provider.js";
import type { AutomationSessionConnector } from "./automation-session.js";

export class SessionConnectorRegistry {
  readonly #connectors = new Map<string, AutomationSessionConnector>();

  public constructor(connectors: AutomationSessionConnector[]) {
    for (const connector of connectors) {
      this.#connectors.set(this.#key(connector.driver, connector.browser), connector);
    }
  }

  public get(driver: AutomationEngine, browser: AutomationBrowser): AutomationSessionConnector {
    const connector = this.#connectors.get(this.#key(driver, browser));
    if (!connector) throw new Error(`No job connector for ${driver}/${browser}`);
    return connector;
  }

  #key(driver: AutomationEngine, browser: AutomationBrowser): string {
    return `${driver}:${browser}`;
  }
}
