import type { AutomationBrowser, AutomationAdapter } from "../contracts/job-contract.js";
import type { AdapterProtocol } from "../contracts/adapter-contract.js";

export const automationAdapters = [
  "playwright",
  "puppeteer",
  "selenium",
  "webdriverio",
  "nightwatch",
  "testcafe",
  "taiko",
  "cypress",
  "cdp",
  "webdriver-bidi",
  "appium",
] as const;
export const automationBrowsers = ["chromium", "firefox", "webkit", "edge"] as const;

export type { AutomationBrowser, AutomationAdapter };
export type AdapterSession = {
  browser: AutomationBrowser;
  close: () => Promise<void>;
  endpoint: string;
  adapter: AutomationAdapter;
  nativeHandle?: unknown;
  onClose: (listener: () => void) => void;
  protocol: AdapterProtocol;
};

export type AdapterRuntime = {
  browsers: readonly AutomationBrowser[];
  adapter: AutomationAdapter;
  launch: (executionId: string, browser: AutomationBrowser) => Promise<AdapterSession>;
};
