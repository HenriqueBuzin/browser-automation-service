import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { AutomationJob } from "../../contracts/job-contract.js";
import type { ArtifactRecord } from "../../domain/artifact.js";
import {
  aggregateJobStatus,
  type ExecutionRecord,
  type ExecutionStatus,
  type JobRecord,
  type OutboxMessage,
} from "../../domain/job-state.js";
import type { CreateJobResult, JobRepository } from "../../ports/job-repository.js";

type JobRow = QueryResultRow & {
  client_id: string;
  created_at: Date;
  definition: AutomationJob;
  definition_hash: string;
  id: string;
  idempotency_key: string;
  status: JobRecord["status"];
  updated_at: Date;
};

type ExecutionRow = QueryResultRow & {
  attempt: number;
  browser: ExecutionRecord["browser"];
  created_at: Date;
  adapter: ExecutionRecord["adapter"];
  error: ExecutionRecord["error"] | null;
  finished_at: Date | null;
  id: string;
  job_id: string;
  outputs: ExecutionRecord["outputs"];
  started_at: Date | null;
  status: ExecutionRecord["status"];
  updated_at: Date;
};

type OutboxRow = QueryResultRow & {
  attempts: number;
  created_at: Date;
  execution_id: string;
  id: string;
  published_at: Date | null;
  topic: OutboxMessage["topic"];
};

type ArtifactRow = QueryResultRow & {
  content_type: string;
  created_at: Date;
  execution_id: string;
  id: string;
  name: string;
  path: string;
  size: string;
};

export class PostgresJobRepository implements JobRepository {
  public constructor(private readonly pool: Pool) {}

  public async addArtifact(artifact: ArtifactRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO browser_artifacts
       (id, execution_id, name, content_type, path, size, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        artifact.id,
        artifact.executionId,
        artifact.name,
        artifact.contentType,
        artifact.path,
        artifact.size,
        artifact.createdAt,
      ],
    );
  }

  public async cancelJob(jobId: string, now: Date): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(
        `UPDATE browser_jobs
         SET status = 'canceled', updated_at = $2
         WHERE id = $1 AND status IN ('queued', 'running')
         RETURNING id`,
        [jobId, now],
      );
      if (updated.rowCount === 0) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query(
        `UPDATE browser_executions
         SET status = 'canceled', updated_at = $2, finished_at = $2
         WHERE job_id = $1 AND status IN ('queued', 'running')`,
        [jobId, now],
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async claimOutbox(limit: number): Promise<OutboxMessage[]> {
    const result = await this.pool.query<OutboxRow>(
      `WITH candidates AS (
         SELECT id
         FROM browser_outbox
         WHERE published_at IS NULL
           AND (locked_until IS NULL OR locked_until < now())
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE browser_outbox AS outbox
       SET locked_until = now() + interval '30 seconds'
       FROM candidates
       WHERE outbox.id = candidates.id
       RETURNING outbox.*`,
      [limit],
    );
    return result.rows.map(mapOutbox);
  }

  public async claimExpiredArtifacts(
    before: Date,
    limit: number,
    now: Date,
  ): Promise<ArtifactRecord[]> {
    const result = await this.pool.query<ArtifactRow>(
      `WITH candidates AS (
         SELECT id FROM browser_artifacts
         WHERE created_at < $1
           AND (deletion_status = 'active'
             OR (deletion_status = 'retry' AND delete_after <= $3))
         ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $2
       )
       UPDATE browser_artifacts AS artifact
       SET deletion_status = 'deleting', delete_after = NULL
       FROM candidates WHERE artifact.id = candidates.id
       RETURNING artifact.*`,
      [before, limit, now],
    );
    return result.rows.map(mapArtifact);
  }

  public async claimExecution(
    id: string,
    adapter: ExecutionRecord["adapter"],
    now: Date,
  ): Promise<ExecutionRecord | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<ExecutionRow>(
        `UPDATE browser_executions AS execution
         SET status = 'running', attempt = execution.attempt + 1,
             started_at = $3, updated_at = $3
         FROM browser_jobs AS job
         WHERE execution.id = $1 AND execution.adapter = $2
           AND execution.status = 'queued' AND job.id = execution.job_id
           AND job.status <> 'canceled'
         RETURNING execution.*`,
        [id, adapter, now],
      );
      const row = result.rows[0];
      if (row) await updateAggregate(client, row.job_id, now);
      await client.query("COMMIT");
      return row ? mapExecution(row) : undefined;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async createJob(
    job: JobRecord,
    executions: ExecutionRecord[],
    messages: OutboxMessage[],
    maxActiveJobs = Number.MAX_SAFE_INTEGER,
  ): Promise<CreateJobResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        job.definition.clientId,
      ]);
      const existingJob = await client.query<JobRow>(
        "SELECT * FROM browser_jobs WHERE client_id = $1 AND idempotency_key = $2",
        [job.definition.clientId, job.idempotencyKey],
      );
      if (existingJob.rows[0]) {
        const existingExecutions = await client.query<ExecutionRow>(
          "SELECT * FROM browser_executions WHERE job_id = $1 ORDER BY created_at, id",
          [existingJob.rows[0].id],
        );
        await client.query("COMMIT");
        return {
          created: false,
          executions: existingExecutions.rows.map(mapExecution),
          job: mapJob(existingJob.rows[0]),
        };
      }
      const active = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM browser_jobs
         WHERE client_id = $1 AND status IN ('queued', 'running')`,
        [job.definition.clientId],
      );
      if (Number(active.rows[0]?.count ?? 0) >= maxActiveJobs) {
        await client.query("COMMIT");
        return { created: false, executions, job, quotaExceeded: true };
      }
      await client.query(
        `INSERT INTO browser_jobs
         (id, client_id, idempotency_key, definition, definition_hash, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          job.id,
          job.definition.clientId,
          job.idempotencyKey,
          job.definition,
          job.definitionHash,
          job.status,
          job.createdAt,
          job.updatedAt,
        ],
      );
      for (const execution of executions) await insertExecution(client, execution);
      for (const message of messages) await insertOutbox(client, message);
      await client.query("COMMIT");
      return { created: true, executions, job };
    } catch (error) {
      await client.query("ROLLBACK");
      if (isUniqueViolation(error)) {
        const existing = await this.findByIdempotency(job.definition.clientId, job.idempotencyKey);
        if (existing) return { created: false, ...existing };
      }
      throw error;
    } finally {
      client.release();
    }
  }

  public async countActiveJobs(clientId: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM browser_jobs
       WHERE client_id = $1 AND status IN ('queued', 'running')`,
      [clientId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  public async findArtifact(id: string): Promise<ArtifactRecord | undefined> {
    const result = await this.pool.query<ArtifactRow>(
      "SELECT * FROM browser_artifacts WHERE id = $1 AND deletion_status = 'active'",
      [id],
    );
    return result.rows[0] ? mapArtifact(result.rows[0]) : undefined;
  }

  public async findByIdempotency(
    clientId: string,
    key: string,
  ): Promise<{ executions: ExecutionRecord[]; job: JobRecord } | undefined> {
    const result = await this.pool.query<JobRow>(
      "SELECT * FROM browser_jobs WHERE client_id = $1 AND idempotency_key = $2",
      [clientId, key],
    );
    return result.rows[0] ? this.findJob(result.rows[0].id) : undefined;
  }

  public async findExecution(id: string): Promise<ExecutionRecord | undefined> {
    const result = await this.pool.query<ExecutionRow>(
      "SELECT * FROM browser_executions WHERE id = $1",
      [id],
    );
    return result.rows[0] ? mapExecution(result.rows[0]) : undefined;
  }

  public async findJob(
    id: string,
  ): Promise<{ executions: ExecutionRecord[]; job: JobRecord } | undefined> {
    const jobs = await this.pool.query<JobRow>("SELECT * FROM browser_jobs WHERE id = $1", [id]);
    if (!jobs.rows[0]) return undefined;
    const executions = await this.pool.query<ExecutionRow>(
      "SELECT * FROM browser_executions WHERE job_id = $1 ORDER BY created_at, id",
      [id],
    );
    return {
      executions: executions.rows.map(mapExecution),
      job: mapJob(jobs.rows[0]),
    };
  }

  public async markOutboxFailed(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE browser_outbox
       SET attempts = attempts + 1, locked_until = NULL
       WHERE id = $1`,
      [id],
    );
  }

  public async markOutboxPublished(id: string, now: Date): Promise<void> {
    await this.pool.query(
      `UPDATE browser_outbox
       SET published_at = $2, locked_until = NULL
       WHERE id = $1`,
      [id, now],
    );
  }

  public async resetExecution(id: string, now: Date, outbox: OutboxMessage): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ job_id: string }>(
        `UPDATE browser_executions
         SET status = 'queued', error = NULL, outputs = '{}'::jsonb,
             started_at = NULL, finished_at = NULL, updated_at = $2
         WHERE id = $1 AND status = 'failed'
         RETURNING job_id`,
        [id, now],
      );
      if (!result.rows[0]) {
        await client.query("ROLLBACK");
        return false;
      }
      await insertOutbox(client, outbox);
      await client.query(
        "UPDATE browser_jobs SET status = 'queued', updated_at = $2 WHERE id = $1",
        [result.rows[0].job_id, now],
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async completeArtifactDeletion(id: string): Promise<void> {
    await this.pool.query(
      "DELETE FROM browser_artifacts WHERE id = $1 AND deletion_status = 'deleting'",
      [id],
    );
  }

  public async failArtifactDeletion(id: string, retryAt: Date): Promise<void> {
    await this.pool.query(
      `UPDATE browser_artifacts
       SET deletion_status = 'retry', deletion_attempts = deletion_attempts + 1,
           delete_after = $2
       WHERE id = $1 AND deletion_status = 'deleting'`,
      [id, retryAt],
    );
  }

  public async updateExecution(
    id: string,
    status: ExecutionStatus,
    patch: Partial<ExecutionRecord>,
  ): Promise<ExecutionRecord | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const currentResult = await client.query<ExecutionRow>(
        "SELECT * FROM browser_executions WHERE id = $1 FOR UPDATE",
        [id],
      );
      if (!currentResult.rows[0]) {
        await client.query("ROLLBACK");
        return undefined;
      }
      const current = mapExecution(currentResult.rows[0]);
      const merged = { ...current, ...patch, status };
      const updated = await client.query<ExecutionRow>(
        `UPDATE browser_executions
         SET status = $2, attempt = $3, outputs = $4, error = $5,
             updated_at = $6, started_at = $7, finished_at = $8
         WHERE id = $1
         RETURNING *`,
        [
          id,
          merged.status,
          merged.attempt,
          merged.outputs,
          merged.error ?? null,
          merged.updatedAt,
          merged.startedAt ?? null,
          merged.finishedAt ?? null,
        ],
      );
      await updateAggregate(client, current.jobId, merged.updatedAt);
      await client.query("COMMIT");
      const row = updated.rows[0];
      if (!row) throw new Error(`Execution '${id}' disappeared during update`);
      return mapExecution(row);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

async function insertExecution(client: PoolClient, execution: ExecutionRecord): Promise<void> {
  await client.query(
    `INSERT INTO browser_executions
     (id, job_id, adapter, browser, status, attempt, outputs, error, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      execution.id,
      execution.jobId,
      execution.adapter,
      execution.browser,
      execution.status,
      execution.attempt,
      execution.outputs,
      execution.error ?? null,
      execution.createdAt,
      execution.updatedAt,
    ],
  );
}

async function insertOutbox(client: PoolClient, message: OutboxMessage): Promise<void> {
  await client.query(
    `INSERT INTO browser_outbox
     (id, execution_id, topic, attempts, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [message.id, message.executionId, message.topic, message.attempts, message.createdAt],
  );
}

async function updateAggregate(client: PoolClient, jobId: string, now: Date): Promise<void> {
  const result = await client.query<ExecutionRow>(
    "SELECT * FROM browser_executions WHERE job_id = $1",
    [jobId],
  );
  await client.query("UPDATE browser_jobs SET status = $2, updated_at = $3 WHERE id = $1", [
    jobId,
    aggregateJobStatus(result.rows.map(mapExecution)),
    now,
  ]);
}

function mapJob(row: JobRow): JobRecord {
  return {
    createdAt: row.created_at,
    definition: row.definition,
    definitionHash: row.definition_hash,
    id: row.id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

function mapExecution(row: ExecutionRow): ExecutionRecord {
  return {
    attempt: row.attempt,
    browser: row.browser,
    createdAt: row.created_at,
    adapter: row.adapter,
    ...(row.error ? { error: row.error } : {}),
    ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
    id: row.id,
    jobId: row.job_id,
    outputs: row.outputs,
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    status: row.status,
    updatedAt: row.updated_at,
  };
}

function mapOutbox(row: OutboxRow): OutboxMessage {
  return {
    attempts: row.attempts,
    createdAt: row.created_at,
    executionId: row.execution_id,
    id: row.id,
    ...(row.published_at ? { publishedAt: row.published_at } : {}),
    topic: row.topic,
  };
}

function mapArtifact(row: ArtifactRow): ArtifactRecord {
  return {
    contentType: row.content_type,
    createdAt: row.created_at,
    executionId: row.execution_id,
    id: row.id,
    name: row.name,
    path: row.path,
    size: Number(row.size),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}
