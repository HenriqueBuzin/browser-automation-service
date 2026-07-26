import type {
  AutomationBrowser,
  AutomationEngine,
  AutomationProvider,
} from "../domain/automation-provider.js";

export class ProviderNotAvailableError extends Error {
  public constructor(engine: AutomationEngine) {
    super(`Automation engine '${engine}' is not available`);
    this.name = "ProviderNotAvailableError";
  }
}

export class BrowserNotSupportedError extends Error {
  public constructor(engine: AutomationEngine, browser: AutomationBrowser) {
    super(`Automation engine '${engine}' does not support browser '${browser}'`);
    this.name = "BrowserNotSupportedError";
  }
}

export type ProviderCapability = {
  browser: AutomationBrowser;
  engine: AutomationEngine;
};

export class ProviderRegistry {
  readonly #providers: Map<AutomationEngine, AutomationProvider>;

  public constructor(providers: AutomationProvider[]) {
    this.#providers = new Map(providers.map((provider) => [provider.engine, provider]));
  }

  public get(engine: AutomationEngine): AutomationProvider {
    const provider = this.#providers.get(engine);
    if (!provider) throw new ProviderNotAvailableError(engine);
    return provider;
  }

  public getForBrowser(engine: AutomationEngine, browser: AutomationBrowser): AutomationProvider {
    const provider = this.get(engine);
    if (!provider.browsers.includes(browser)) throw new BrowserNotSupportedError(engine, browser);
    return provider;
  }

  public capabilities(): ProviderCapability[] {
    return [...this.#providers.values()].flatMap((provider) =>
      provider.browsers.map((browser) => ({ browser, engine: provider.engine })),
    );
  }

  public engines(): AutomationEngine[] {
    return [...this.#providers.keys()];
  }
}
