import type { ArtifactRecord } from "../domain/artifact.js";
import type {
  ExecutionRecord,
  ExecutionStatus,
  JobRecord,
  OutboxMessage,
} from "../domain/job-state.js";

export type CreateJobResult = {
  created: boolean;
  executions: ExecutionRecord[];
  job: JobRecord;
  quotaExceeded?: boolean;
};

export type JobRepository = {
  addArtifact: (artifact: ArtifactRecord) => Promise<void>;
  cancelJob: (jobId: string, now: Date) => Promise<boolean>;
  claimExpiredArtifacts: (before: Date, limit: number, now: Date) => Promise<ArtifactRecord[]>;
  claimExecution: (
    id: string,
    driver: ExecutionRecord["driver"],
    now: Date,
  ) => Promise<ExecutionRecord | undefined>;
  claimOutbox: (limit: number) => Promise<OutboxMessage[]>;
  createJob: (
    job: JobRecord,
    executions: ExecutionRecord[],
    messages: OutboxMessage[],
    maxActiveJobs: number,
  ) => Promise<CreateJobResult>;
  findArtifact: (id: string) => Promise<ArtifactRecord | undefined>;
  findByIdempotency: (
    clientId: string,
    key: string,
  ) => Promise<{ executions: ExecutionRecord[]; job: JobRecord } | undefined>;
  findExecution: (id: string) => Promise<ExecutionRecord | undefined>;
  findJob: (id: string) => Promise<{ executions: ExecutionRecord[]; job: JobRecord } | undefined>;
  markOutboxFailed: (id: string) => Promise<void>;
  markOutboxPublished: (id: string, now: Date) => Promise<void>;
  completeArtifactDeletion: (id: string) => Promise<void>;
  failArtifactDeletion: (id: string, retryAt: Date) => Promise<void>;
  resetExecution: (id: string, now: Date, outbox: OutboxMessage) => Promise<boolean>;
  updateExecution: (
    id: string,
    status: ExecutionStatus,
    patch: Partial<ExecutionRecord>,
  ) => Promise<ExecutionRecord | undefined>;
};
