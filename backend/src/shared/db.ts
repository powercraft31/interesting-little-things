import { Pool, type PoolClient } from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://solfacil_app:solfacil_vpp_2026@localhost:5432/solfacil_vpp";

// Singleton Pool — 整個進程共享一個 Pool，避免連線數爆炸
let _pool: Pool | null = null;

export function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    _pool.on("error", (err) => {
      console.error("[DB Pool] Unexpected error on idle client:", err);
    });
  }
  return _pool;
}

/**
 * Execute a read query with RLS org context.
 *
 * - orgId provided → SET LOCAL app.current_org_id, RLS filters to that org
 * - orgId null (ADMIN) → GUC stays empty, admin-bypass policy allows all rows
 *
 * All queries run inside a transaction so SET LOCAL is scoped correctly.
 */
export async function queryWithOrg<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[],
  orgId: string | null,
): Promise<{ rows: T[] }> {
  const pool = getPool();
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    if (orgId) {
      // set_config(name, value, is_local) — is_local=true scopes to transaction
      await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [
        orgId,
      ]);
    }
    const result = await client.query(sql, params);
    await client.query("COMMIT");
    return { rows: result.rows as T[] };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** 釋放 Pool（測試用，生產環境不需呼叫） */
export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
