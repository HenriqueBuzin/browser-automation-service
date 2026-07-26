export const automationEngines = ["playwright", "puppeteer", "selenium"] as const;
export type AutomationEngine = (typeof automationEngines)[number];
export type AutomationProtocol = "playwright" | "cdp" | "webdriver";

export type ProviderSession = {
  close: () => Promise<void>;
  endpoint: string;
  engine: AutomationEngine;
  onClose: (listener: () => void) => void;
  protocol: AutomationProtocol;
};

export type AutomationProvider = {
  engine: AutomationEngine;
  launch: (leaseId: string) => Promise<ProviderSession>;
};
