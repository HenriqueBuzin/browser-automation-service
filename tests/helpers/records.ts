import type { AutomationJob } from "../../src/contracts/job-contract.js";
import type { ExecutionRecord, JobRecord } from "../../src/domain/job-state.js";

export const fixedNow = new Date("2026-07-26T12:00:00.000Z");

export function jobDefinition(overrides: Partial<AutomationJob> = {}): AutomationJob {
  return {
    clientId: "test-client",
    schemaVersion: 1,
    steps: [{ action: "goto", url: "https://example.test" }],
    ...overrides,
  };
}

export function jobRecord(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    createdAt: fixedNow,
    definition: jobDefinition(),
    id: "00000000-0000-4000-8000-000000000001",
    idempotencyKey: "idem-key",
    status: "queued",
    updatedAt: fixedNow,
    ...overrides,
  };
}

export function executionRecord(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    attempt: 0,
    browser: "chromium",
    createdAt: fixedNow,
    driver: "playwright",
    id: "00000000-0000-4000-8000-000000000002",
    jobId: "00000000-0000-4000-8000-000000000001",
    outputs: {},
    status: "queued",
    updatedAt: fixedNow,
    ...overrides,
  };
}
