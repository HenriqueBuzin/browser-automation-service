import type { AutomationEngine } from "../contracts/job-contract.js";

export type ExecutionQueue = {
  cancel: (executionId: string, driver: AutomationEngine) => Promise<void>;
  close: () => Promise<void>;
  enqueue: (executionId: string, driver: AutomationEngine) => Promise<void>;
  ready: () => Promise<boolean>;
};
