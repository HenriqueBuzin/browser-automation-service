import type { AutomationAdapter, AutomationBrowser, AutomationStep } from "./job-contract.js";

export type AdapterExecutionMode = "portable-plan" | "native-suite";
export type AdapterPlatform = "web" | "android" | "ios";
export type AdapterProtocol = "playwright" | "cdp" | "webdriver" | "webdriver-bidi";

/**
 * Public, versioned description of work a healthy adapter can actually execute.
 * Merely accepting an adapter name in a job does not make it available.
 */
export type AdapterCapabilityManifest = {
  actions: readonly AutomationStep["action"][];
  adapter: AutomationAdapter;
  browser: AutomationBrowser;
  executionMode: AdapterExecutionMode;
  platform: AdapterPlatform;
  protocol: AdapterProtocol;
};
