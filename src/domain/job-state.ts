import type {
  AutomationBrowser,
  AutomationEngine,
  AutomationJob,
} from "../contracts/job-contract.js";

export const jobStatuses = [
  "queued",
  "running",
  "passed",
  "partial",
  "failed",
  "canceled",
] as const;
export type JobStatus = (typeof jobStatuses)[number];

export const executionStatuses = [
  "queued",
  "running",
  "passed",
  "failed",
  "unsupported",
  "canceled",
  "timed_out",
] as const;
export type ExecutionStatus = (typeof executionStatuses)[number];

export type FailureCategory = "assertion" | "infrastructure" | "invalid_job" | "timeout";

export type JobRecord = {
  createdAt: Date;
  definition: AutomationJob;
  definitionHash: string;
  id: string;
  idempotencyKey: string;
  status: JobStatus;
  updatedAt: Date;
};

export type ExecutionRecord = {
  attempt: number;
  browser: AutomationBrowser;
  createdAt: Date;
  driver: AutomationEngine;
  error?: {
    category: FailureCategory;
    message: string;
    name: string;
  };
  finishedAt?: Date;
  id: string;
  jobId: string;
  outputs: Record<string, boolean | number | string>;
  startedAt?: Date;
  status: ExecutionStatus;
  updatedAt: Date;
};

export type OutboxMessage = {
  attempts: number;
  createdAt: Date;
  executionId: string;
  id: string;
  publishedAt?: Date;
  topic: `execution.${AutomationEngine}`;
};

export function aggregateJobStatus(executions: ExecutionRecord[]): JobStatus {
  if (executions.some((execution) => execution.status === "running")) return "running";
  if (executions.some((execution) => execution.status === "queued")) return "queued";
  if (executions.every((execution) => execution.status === "canceled")) return "canceled";
  const failed = executions.some((execution) => ["failed", "timed_out"].includes(execution.status));
  const passed = executions.some((execution) => execution.status === "passed");
  const unsupported = executions.some((execution) => execution.status === "unsupported");
  if (failed) return passed ? "partial" : "failed";
  if (unsupported) return passed ? "partial" : "failed";
  return "passed";
}

export function canRetry(execution: ExecutionRecord): boolean {
  return (
    execution.status === "failed" &&
    execution.error?.category === "infrastructure" &&
    execution.attempt < 3
  );
}
