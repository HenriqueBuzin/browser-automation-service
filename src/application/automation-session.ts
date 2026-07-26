import type { AutomationBrowser, AutomationEngine } from "../domain/automation-provider.js";
import type { ExtractKind, MouseButton, SelectorState } from "../domain/automation-job.js";

export type AutomationSession = {
  back: () => Promise<void>;
  check: (selector: string, checked: boolean) => Promise<void>;
  click: (selector: string, options: { button: MouseButton; clickCount: number }) => Promise<void>;
  close: () => Promise<void>;
  extract: (
    kind: ExtractKind,
    selector?: string,
    attribute?: string,
  ) => Promise<boolean | number | string>;
  fill: (selector: string, value: string) => Promise<void>;
  focus: (selector: string) => Promise<void>;
  forward: () => Promise<void>;
  goto: (url: string, waitUntil: "domcontentloaded" | "load" | "networkidle") => Promise<void>;
  hover: (selector: string) => Promise<void>;
  press: (key: string, selector?: string) => Promise<void>;
  reload: () => Promise<void>;
  screenshot: (fullPage: boolean) => Promise<string>;
  scroll: (x: number, y: number, selector?: string) => Promise<void>;
  select: (selector: string, values: string[]) => Promise<void>;
  setViewport: (width: number, height: number) => Promise<void>;
  type: (selector: string, text: string, delayMs: number) => Promise<void>;
  wait: (durationMs: number) => Promise<void>;
  waitForSelector: (selector: string, state: SelectorState, timeoutMs: number) => Promise<void>;
  waitForUrl: (contains: string, timeoutMs: number) => Promise<void>;
};

export type AutomationSessionConnector = {
  browser: AutomationBrowser;
  driver: AutomationEngine;
  connect: (endpoint: string, nativeHandle?: unknown) => Promise<AutomationSession>;
};
