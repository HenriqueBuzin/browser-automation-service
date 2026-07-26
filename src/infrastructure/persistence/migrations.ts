import type { Pool } from "pg";

const migration = `
CREATE TABLE IF NOT EXISTS browser_jobs (
  id uuid PRIMARY KEY,
  client_id varchar(64) NOT NULL,
  idempotency_key varchar(200) NOT NULL,
  definition jsonb NOT NULL,
  status varchar(20) NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (client_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS browser_api_clients (
  id uuid PRIMARY KEY,
  name varchar(100) NOT NULL UNIQUE,
  key_hash varchar(64) NOT NULL UNIQUE,
  scopes text[] NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS browser_executions (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES browser_jobs(id) ON DELETE CASCADE,
  driver varchar(20) NOT NULL,
  browser varchar(20) NOT NULL,
  status varchar(20) NOT NULL,
  attempt integer NOT NULL DEFAULT 0,
  outputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  error jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  started_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS browser_executions_job_idx ON browser_executions(job_id);

CREATE TABLE IF NOT EXISTS browser_outbox (
  id uuid PRIMARY KEY,
  execution_id uuid NOT NULL REFERENCES browser_executions(id) ON DELETE CASCADE,
  topic varchar(40) NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  published_at timestamptz,
  locked_until timestamptz
);

CREATE INDEX IF NOT EXISTS browser_outbox_pending_idx
  ON browser_outbox(created_at)
  WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS browser_artifacts (
  id uuid PRIMARY KEY,
  execution_id uuid NOT NULL REFERENCES browser_executions(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  content_type varchar(100) NOT NULL,
  path text NOT NULL,
  size bigint NOT NULL,
  created_at timestamptz NOT NULL
);
`;

export async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(migration);
}
