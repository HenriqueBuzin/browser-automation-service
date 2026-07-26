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
};

export type JobRepository = {
  addArtifact: (artifact: ArtifactRecord) => Promise<void>;
  cancelJob: (jobId: string, now: Date) => Promise<boolean>;
  claimOutbox: (limit: number) => Promise<OutboxMessage[]>;
  countActiveJobs: (clientId: string) => Promise<number>;
  createJob: (
    job: JobRecord,
    executions: ExecutionRecord[],
    messages: OutboxMessage[],
  ) => Promise<CreateJobResult>;
  findArtifact: (id: string) => Promise<ArtifactRecord | undefined>;
  findExpiredArtifacts: (before: Date, limit: number) => Promise<ArtifactRecord[]>;
  findByIdempotency: (
    clientId: string,
    key: string,
  ) => Promise<{ executions: ExecutionRecord[]; job: JobRecord } | undefined>;
  findExecution: (id: string) => Promise<ExecutionRecord | undefined>;
  findJob: (id: string) => Promise<{ executions: ExecutionRecord[]; job: JobRecord } | undefined>;
  markOutboxFailed: (id: string) => Promise<void>;
  markOutboxPublished: (id: string, now: Date) => Promise<void>;
  removeArtifact: (id: string) => Promise<void>;
  resetExecution: (id: string, now: Date, outbox: OutboxMessage) => Promise<boolean>;
  updateExecution: (
    id: string,
    status: ExecutionStatus,
    patch: Partial<ExecutionRecord>,
  ) => Promise<ExecutionRecord | undefined>;
};
