import type { AutomationBrowser, AutomationEngine } from "../contracts/job-contract.js";

export const automationEngines = ["playwright", "puppeteer", "selenium"] as const;
export const automationBrowsers = ["chromium", "firefox", "webkit", "edge"] as const;

export type { AutomationBrowser, AutomationEngine };
export type AutomationProtocol = "playwright" | "cdp" | "webdriver" | "webdriver-bidi";

export type ProviderSession = {
  browser: AutomationBrowser;
  close: () => Promise<void>;
  endpoint: string;
  engine: AutomationEngine;
  nativeHandle?: unknown;
  onClose: (listener: () => void) => void;
  protocol: AutomationProtocol;
};

export type AutomationProvider = {
  browsers: readonly AutomationBrowser[];
  engine: AutomationEngine;
  launch: (executionId: string, browser: AutomationBrowser) => Promise<ProviderSession>;
};
