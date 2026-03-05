/**
 * 市场与计费 — 查询电价时间表
 *
 * 通过 PostgreSQL 配合 RLS 租户隔离查询 tariff_schedules。
 * RLS "防护罩"通过显式事务（BEGIN/COMMIT）中的
 * SET LOCAL app.current_org_id 激活，确保租户只能查看自己的数据行。
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
  verifyTenantToken,
  requireRole,
} from "../../shared/middleware/tenant-context";

// ---------------------------------------------------------------------------
// 数据库连接池（每次 Lambda 冷启动实例化一次）
// ---------------------------------------------------------------------------

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// ---------------------------------------------------------------------------
// 此端点允许的角色
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
    const token =
      event.headers?.["authorization"] ??
      event.headers?.["Authorization"] ??
      "";
    tenant = verifyTenantToken(token);
    requireRole(tenant, ALLOWED_ROLES);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    return {
      statusCode: e.statusCode ?? 401,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fail(e.message ?? "Unauthorized")),
    };
  }

  let client: PoolClient | undefined;
  try {
    client = await pool.connect();

    // ── 显式事务，使 SET LOCAL 生效 ──────────────────────────────────
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
