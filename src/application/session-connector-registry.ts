import type { AutomationBrowser, AutomationAdapter } from "../domain/automation-adapter.js";
import type { AutomationSessionConnector } from "./automation-session.js";

export class SessionConnectorRegistry {
  readonly #connectors = new Map<string, AutomationSessionConnector>();

  public constructor(connectors: AutomationSessionConnector[]) {
    for (const connector of connectors) {
      this.#connectors.set(this.#key(connector.adapter, connector.browser), connector);
    }
  }

  public get(adapter: AutomationAdapter, browser: AutomationBrowser): AutomationSessionConnector {
    const connector = this.#connectors.get(this.#key(adapter, browser));
    if (!connector) throw new Error(`No job connector for ${adapter}/${browser}`);
    return connector;
  }

  #key(adapter: AutomationAdapter, browser: AutomationBrowser): string {
    return `${adapter}:${browser}`;
  }
}
