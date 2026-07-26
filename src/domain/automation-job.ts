import type { AutomationStep } from "../contracts/job-contract.js";

export type {
  AutomationJob,
  AutomationStep,
  ExtractKind,
  MouseButton,
  SelectorState,
} from "../contracts/job-contract.js";

export type SerializedError = {
  message: string;
  name: string;
};

export type StepResult = {
  action: AutomationStep["action"];
  durationMs: number;
  error?: SerializedError;
  index: number;
  output?: boolean | number | string;
  outputName?: string;
  status: "failed" | "passed";
};
