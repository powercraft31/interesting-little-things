/**
 * Market & Billing — Get Tariff Schedule
 *
 * Queries tariff_schedules via PostgreSQL with RLS tenant isolation.
 * The RLS "shield" is activated by SET LOCAL app.current_org_id inside
 * an explicit transaction (BEGIN/COMMIT), ensuring a tenant can only
 * see its own rows.
 */
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { Pool } from "pg";
import type { PoolClient } from "pg";
import { ok, fail } from "../../shared/types/api";
import { Role } from "../../shared/types/auth";
import {
  extractTenantContext,
  requireRole,
  apiError,
} from "../../bff/middleware/tenant-context";

// ---------------------------------------------------------------------------
// DB pool (instantiated once per Lambda cold-start)
// ---------------------------------------------------------------------------

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// ---------------------------------------------------------------------------
// Allowed roles for this endpoint
// ---------------------------------------------------------------------------

const ALLOWED_ROLES = [
  Role.SOLFACIL_ADMIN,
  Role.ORG_MANAGER,
  Role.ORG_OPERATOR,
  Role.ORG_VIEWER,
];

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  let tenant;
  try {
    tenant = extractTenantContext(event);
    requireRole(tenant, ALLOWED_ROLES);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    return apiError(
      e.statusCode ?? 401,
      e.message ?? "Unauthorized",
    ) as APIGatewayProxyStructuredResultV2;
  }

  let client: PoolClient | undefined;
  try {
    client = await pool.connect();

    // ── Explicit transaction for SET LOCAL to take effect ────────────
    await client.query("BEGIN");
    await client.query("SET LOCAL app.current_org_id = $1", [tenant.orgId]);

    const result = await client.query(
      "SELECT * FROM tariff_schedules ORDER BY effective_from DESC",
    );

    await client.query("COMMIT");

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        ok({
          schedules: result.rows,
          _tenant: { orgId: tenant.orgId, role: tenant.role },
        }),
      ),
    };
  } catch (err) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }
    console.error("[get-tariff-schedule] Query failed", { error: err });
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fail("Internal server error")),
    };
  } finally {
    client?.release();
  }
}
