import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type {
  AuthenticationCredentials,
  AuthenticationScope,
  Authenticator,
} from "../../application/authenticator.js";
import { readBearerToken } from "./api-key-authenticator.js";

export class PostgresApiKeyAuthenticator implements Authenticator {
  public constructor(private readonly pool: Pool) {}

  public async authorize(
    credentials: AuthenticationCredentials,
    requiredScope: AuthenticationScope,
  ): Promise<boolean> {
    const key = readBearerToken(credentials.authorization) ?? credentials.apiKey;
    if (!key) return false;
    const result = await this.pool.query<{ authorized: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM browser_api_clients
         WHERE key_hash = $1
           AND active = true
           AND $2 = ANY(scopes)
       ) AS authorized`,
      [hashKey(key), requiredScope],
    );
    return result.rows[0]?.authorized === true;
  }
}

export async function ensureBootstrapClient(pool: Pool, apiKey: string): Promise<void> {
  await pool.query(
    `INSERT INTO browser_api_clients
     (id, name, key_hash, scopes, active, created_at)
     VALUES ($1, 'bootstrap', $2, $3, true, now())
     ON CONFLICT (name)
     DO UPDATE SET key_hash = EXCLUDED.key_hash, scopes = EXCLUDED.scopes, active = true`,
    [
      randomUUID(),
      hashKey(apiKey),
      ["jobs:read", "jobs:write", "artifacts:read", "capabilities:read", "metrics:read"],
    ],
  );
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}
