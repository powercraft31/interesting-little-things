/**
 * M8 Admin 控制面板 — 查询 VPP 策略
 *
 * 列出调用方所属组织的 VPP 策略。
 * ORG_OPERATOR 可读取策略；仅 ORG_MANAGER 及以上可修改。
 */
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { Pool } from "pg";
import type { PoolClient } from "pg";
import { Role } from "../../shared/types/auth";
import type { AdminListResponse, VppStrategy } from "../../shared/types/api";
import {
  verifyTenantToken,
  requireRole,
} from "../../shared/middleware/tenant-context";

// ---------------------------------------------------------------------------
// 数据库连接池
// ---------------------------------------------------------------------------

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ---------------------------------------------------------------------------
// 允许的角色：ORG_OPERATOR 可读取策略
// ---------------------------------------------------------------------------

const ALLOWED_ROLES = [Role.ORG_MANAGER, Role.ORG_OPERATOR];

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
      body: JSON.stringify({ error: e.message ?? "Unauthorized" }),
    };
  }

  let client: PoolClient | undefined;
  try {
    client = await pool.connect();

    await client.query("BEGIN");
    await client.query("SET LOCAL app.current_org_id = $1", [tenant.orgId]);

    const result = await client.query(
      `SELECT id, org_id, strategy_name, min_soc, max_soc, emergency_soc,
              profit_margin, active_hours, active_weekdays, is_default, is_active,
              created_at, updated_at
       FROM vpp_strategies
       ORDER BY is_default DESC, strategy_name`,
    );

    await client.query("COMMIT");

    const strategies: VppStrategy[] = result.rows.map((row) => ({
      id: row.id,
      orgId: row.org_id,
      strategyName: row.strategy_name,
      minSoc: parseFloat(row.min_soc),
      maxSoc: parseFloat(row.max_soc),
      emergencySoc: parseFloat(row.emergency_soc),
      profitMargin: parseFloat(row.profit_margin),
      activeHours: row.active_hours,
      activeWeekdays: row.active_weekdays,
      isDefault: row.is_default,
      isActive: row.is_active,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }));

    const response: AdminListResponse<VppStrategy> = {
      data: strategies,
      total: strategies.length,
      orgId: tenant.orgId,
    };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(response),
    };
  } catch (err) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }
    console.error(
      JSON.stringify({
        level: "ERROR",
        module: "M8",
        action: "get_vpp_strategies",
        error: String(err),
      }),
    );
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    };
  } finally {
    client?.release();
  }
}
