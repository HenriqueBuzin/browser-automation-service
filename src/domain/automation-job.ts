import type { AutomationBrowser, AutomationEngine } from "./automation-provider.js";

export type SelectorState = "attached" | "detached" | "visible" | "hidden";
export type MouseButton = "left" | "middle" | "right";

export type AutomationStep =
  | { action: "back" }
  | { action: "check"; selector: string }
  | { action: "click"; button?: MouseButton; clickCount?: number; selector: string }
  | { action: "extract"; as: string; attribute?: string; kind: ExtractKind; selector?: string }
  | { action: "fill"; selector: string; value: string }
  | { action: "focus"; selector: string }
  | { action: "forward" }
  | { action: "goto"; url: string; waitUntil?: "domcontentloaded" | "load" | "networkidle" }
  | { action: "hover"; selector: string }
  | { action: "press"; key: string; selector?: string }
  | { action: "reload" }
  | { action: "screenshot"; as: string; fullPage?: boolean }
  | { action: "scroll"; selector?: string; x?: number; y?: number }
  | { action: "select"; selector: string; values: string[] }
  | { action: "setViewport"; height: number; width: number }
  | { action: "type"; delayMs?: number; selector: string; text: string }
  | { action: "uncheck"; selector: string }
  | { action: "wait"; durationMs: number }
  | { action: "waitForSelector"; selector: string; state?: SelectorState; timeoutMs?: number }
  | { action: "waitForUrl"; contains: string; timeoutMs?: number }
  | {
      action: "assert";
      attribute?: string;
      expected: boolean | number | string;
      kind: ExtractKind;
      operator?: "contains" | "equals";
      selector?: string;
    };

export type ExtractKind =
  | "attribute"
  | "count"
  | "html"
  | "text"
  | "title"
  | "url"
  | "value"
  | "visible";

export type AutomationJob = {
  browsers?: AutomationBrowser[];
  clientId: string;
  drivers?: AutomationEngine[];
  schemaVersion: 1;
  steps: AutomationStep[];
};

export type StepResult = {
  action: AutomationStep["action"];
  durationMs: number;
  index: number;
  output?: boolean | number | string;
  outputName?: string;
  status: "failed" | "passed";
  error?: SerializedError;
};

export type SerializedError = {
  message: string;
  name: string;
};

export type MatrixExecution = {
  browser: AutomationBrowser;
  driver: AutomationEngine;
  durationMs: number;
  error?: SerializedError;
  outputs: Record<string, boolean | number | string>;
  status: "failed" | "passed" | "unsupported";
  steps: StepResult[];
};

export type MatrixJobResult = {
  clientId: string;
  durationMs: number;
  executions: MatrixExecution[];
  schemaVersion: 1;
  status: "failed" | "passed" | "partial";
};
