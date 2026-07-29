import type {
  AutomationBrowser,
  AutomationAdapter,
  AdapterRuntime,
} from "../domain/automation-adapter.js";

export class AdapterNotAvailableError extends Error {
  public constructor(adapter: AutomationAdapter) {
    super(`Automation adapter '${adapter}' is not available`);
    this.name = "AdapterNotAvailableError";
  }
}

export class BrowserNotSupportedError extends Error {
  public constructor(adapter: AutomationAdapter, browser: AutomationBrowser) {
    super(`Automation adapter '${adapter}' does not support browser '${browser}'`);
    this.name = "BrowserNotSupportedError";
  }
}

export type AdapterCapability = {
  browser: AutomationBrowser;
  adapter: AutomationAdapter;
};

export class AdapterRegistry {
  readonly #adapters: Map<AutomationAdapter, AdapterRuntime>;

  public constructor(adapters: AdapterRuntime[]) {
    this.#adapters = new Map(adapters.map((adapter) => [adapter.adapter, adapter]));
  }

  public get(adapter: AutomationAdapter): AdapterRuntime {
    const runtime = this.#adapters.get(adapter);
    if (!runtime) throw new AdapterNotAvailableError(adapter);
    return runtime;
  }

  public getForBrowser(adapter: AutomationAdapter, browser: AutomationBrowser): AdapterRuntime {
    const runtime = this.get(adapter);
    if (!runtime.browsers.includes(browser)) throw new BrowserNotSupportedError(adapter, browser);
    return runtime;
  }

  public capabilities(): AdapterCapability[] {
    return [...this.#adapters.values()].flatMap((runtime) =>
      runtime.browsers.map((browser) => ({ browser, adapter: runtime.adapter })),
    );
  }

  public adapters(): AutomationAdapter[] {
    return [...this.#adapters.keys()];
  }
}
