export const automationEngines = ["playwright", "puppeteer", "selenium"] as const;
export type AutomationEngine = (typeof automationEngines)[number];
export type AutomationProtocol = "playwright" | "cdp" | "webdriver" | "webdriver-bidi";

export const automationBrowsers = ["chromium", "firefox", "webkit", "edge"] as const;
export type AutomationBrowser = (typeof automationBrowsers)[number];

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
  launch: (leaseId: string, browser: AutomationBrowser) => Promise<ProviderSession>;
};
