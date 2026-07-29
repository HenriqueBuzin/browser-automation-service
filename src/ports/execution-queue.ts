import type { AutomationAdapter } from "../contracts/job-contract.js";

export type ExecutionQueue = {
  cancel: (executionId: string, adapter: AutomationAdapter) => Promise<void>;
  close: () => Promise<void>;
  enqueue: (executionId: string, adapter: AutomationAdapter) => Promise<void>;
  ready: () => Promise<boolean>;
};
