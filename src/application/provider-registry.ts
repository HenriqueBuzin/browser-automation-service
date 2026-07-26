import type { AutomationEngine, AutomationProvider } from "../domain/automation-provider.js";

export class ProviderNotAvailableError extends Error {
  public constructor(engine: AutomationEngine) {
    super(`Automation engine '${engine}' is not available`);
    this.name = "ProviderNotAvailableError";
  }
}

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

  public engines(): AutomationEngine[] {
    return [...this.#providers.keys()];
  }
}
