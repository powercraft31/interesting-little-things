import { Pool, type PoolClient } from "pg";

// ── Connection Strings ──────────────────────────────────────────────────
const APP_DATABASE_URL =
  process.env.APP_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://solfacil_app:solfacil_vpp_2026@127.0.0.1:5433/solfacil_vpp";

const SERVICE_DATABASE_URL =
  process.env.SERVICE_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://solfacil_service:solfacil_service_2026@127.0.0.1:5433/solfacil_vpp";

// ── Singleton Pools ─────────────────────────────────────────────────────
let _appPool: Pool | null = null;
let _servicePool: Pool | null = null;

/** App pool: connects as solfacil_app (NOBYPASSRLS). Used by BFF handlers with RLS. */
export function getAppPool(): Pool {
  if (!_appPool) {
    _appPool = new Pool({
      connectionString: APP_DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    _appPool.on("error", (err) => {
      console.error("[DB AppPool] Unexpected error on idle client:", err);
    });
  }
  return _appPool;
}

/** Service pool: connects as solfacil_service (BYPASSRLS). Used by cron jobs. */
export function getServicePool(): Pool {
  if (!_servicePool) {
    _servicePool = new Pool({
      connectionString: SERVICE_DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    _servicePool.on("error", (err) => {
      console.error("[DB ServicePool] Unexpected error on idle client:", err);
    });
  }
  return _servicePool;
}

/** @deprecated Use getAppPool() instead. */
export function getPool(): Pool {
  return getAppPool();
}

// ── Transaction Helper ──────────────────────────────────────────────────

export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ── Tenant-Scoped Query ─────────────────────────────────────────────────

/**
 * Execute a query with RLS org context.
 *
 * - orgId provided → uses app pool, SET LOCAL app.current_org_id (RLS filters)
 * - orgId null (SOLFACIL_ADMIN) → uses service pool (BYPASSRLS, sees all tenants)
 */
export async function queryWithOrg<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[],
  orgId: string | null,
): Promise<{ rows: T[] }> {
  const pool = orgId ? getAppPool() : getServicePool();
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    if (orgId) {
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

// ── Graceful Shutdown ───────────────────────────────────────────────────

/** Close all pools. Idempotent — safe to call even if pools were never initialized. */
export async function closeAllPools(): Promise<void> {
  const promises: Promise<void>[] = [];
  if (_appPool) {
    promises.push(_appPool.end());
    _appPool = null;
  }
  if (_servicePool) {
    promises.push(_servicePool.end());
    _servicePool = null;
  }
  await Promise.all(promises);
}

/** @deprecated Use closeAllPools() instead. */
export async function closePool(): Promise<void> {
  await closeAllPools();
}
