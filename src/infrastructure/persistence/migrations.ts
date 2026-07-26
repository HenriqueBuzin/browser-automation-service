import type { Pool, PoolClient } from "pg";

type Migration = { name: string; sql: string; version: number };

export const migrations: Migration[] = [
  {
    name: "initial platform schema",
    version: 1,
    sql: `
CREATE TABLE IF NOT EXISTS browser_jobs (
  id uuid PRIMARY KEY,
  client_id varchar(64) NOT NULL,
  idempotency_key varchar(200) NOT NULL,
  definition jsonb NOT NULL,
  definition_hash varchar(64) NOT NULL,
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
  ON browser_outbox(created_at) WHERE published_at IS NULL;
CREATE TABLE IF NOT EXISTS browser_artifacts (
  id uuid PRIMARY KEY,
  execution_id uuid NOT NULL REFERENCES browser_executions(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  content_type varchar(100) NOT NULL,
  path text NOT NULL,
  size bigint NOT NULL,
  created_at timestamptz NOT NULL,
  deletion_status varchar(20) NOT NULL DEFAULT 'active',
  deletion_attempts integer NOT NULL DEFAULT 0,
  delete_after timestamptz
);`,
  },
  {
    name: "platform indexes",
    version: 2,
    sql: `
CREATE INDEX IF NOT EXISTS browser_jobs_client_status_idx
  ON browser_jobs(client_id, status);
CREATE INDEX IF NOT EXISTS browser_artifacts_retention_idx
  ON browser_artifacts(created_at, delete_after)
  WHERE deletion_status IN ('active', 'retry');`,
  },
];

export async function runMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(682736421)");
    await client.query(`
      CREATE TABLE IF NOT EXISTS browser_schema_migrations (
        version integer PRIMARY KEY,
        name text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const applied = await client.query<{ version: number }>(
      "SELECT version FROM browser_schema_migrations",
    );
    const versions = new Set(applied.rows.map(({ version }) => version));
    for (const migration of migrations) {
      if (!versions.has(migration.version)) await applyMigration(client, migration);
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(682736421)").catch(() => undefined);
    client.release();
  }
}

async function applyMigration(client: PoolClient, migration: Migration): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(migration.sql);
    await client.query("INSERT INTO browser_schema_migrations(version, name) VALUES ($1, $2)", [
      migration.version,
      migration.name,
    ]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
