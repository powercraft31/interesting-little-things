/**
 * M8 Admin 控制面板 — 更新 VPP 策略
 *
 * 根据 ID 局部更新 VPP 策略。
 * 应用层验证在数据库约束之前执行，实现纵深防御。
 */
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { Pool } from "pg";
import type { PoolClient } from "pg";
import { Role } from "../../shared/types/auth";
import type {
  UpdateVppStrategyRequest,
  AdminItemResponse,
  VppStrategy,
} from "../../shared/types/api";
import {
  verifyTenantToken,
  requireRole,
} from "../../shared/middleware/tenant-context";

// ---------------------------------------------------------------------------
// 数据库连接池
// ---------------------------------------------------------------------------

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ---------------------------------------------------------------------------
// 输入验证
// ---------------------------------------------------------------------------

function validateSocConstraints(
  update: UpdateVppStrategyRequest,
): string | null {
  const { minSoc, maxSoc, emergencySoc, profitMargin } = update;

  if (minSoc !== undefined) {
    if (minSoc < 10 || minSoc > 50)
      return `minSoc must be between 10 and 50, got ${minSoc}`;
  }
  if (maxSoc !== undefined) {
    if (maxSoc < 70 || maxSoc > 100)
      return `maxSoc must be between 70 and 100, got ${maxSoc}`;
  }
  if (emergencySoc !== undefined) {
    if (emergencySoc < 5 || emergencySoc > 20)
      return `emergencySoc must be between 5 and 20, got ${emergencySoc}`;
  }
  if (minSoc !== undefined && maxSoc !== undefined) {
    if (minSoc >= maxSoc)
      return `minSoc (${minSoc}) must be less than maxSoc (${maxSoc})`;
  }
  if (emergencySoc !== undefined && minSoc !== undefined) {
    if (emergencySoc >= minSoc)
      return `emergencySoc (${emergencySoc}) must be less than minSoc (${minSoc})`;
  }
  if (profitMargin !== undefined) {
    if (profitMargin < 0.01 || profitMargin > 0.5) {
      return `profitMargin must be between 0.01 and 0.5, got ${profitMargin}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

const ALLOWED_ROLES = [Role.ORG_MANAGER];

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

  const strategyId = event.pathParameters?.id;
  if (!strategyId) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Strategy ID is required" }),
    };
  }

  let body: UpdateVppStrategyRequest;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Invalid JSON body" }),
    };
  }

  const validationError = validateSocConstraints(body);
  if (validationError) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: validationError }),
    };
  }

  let client: PoolClient | undefined;
  try {
    client = await pool.connect();

    await client.query("BEGIN");
    await client.query("SET LOCAL app.current_org_id = $1", [tenant.orgId]);

    // 检查记录是否存在（RLS 过滤跨组织访问，返回 404 防止枚举攻击）
    const existing = await client.query(
      "SELECT id FROM vpp_strategies WHERE id = $1",
      [strategyId],
    );
    if (existing.rowCount === 0) {
      await client.query("ROLLBACK");
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Strategy not found" }),
      };
    }

    const setClauses: string[] = ["updated_at = NOW()"];
    const values: unknown[] = [];
    let paramIdx = 1;

    const fieldMap: Record<string, string> = {
      strategyName: "strategy_name",
      minSoc: "min_soc",
      maxSoc: "max_soc",
      emergencySoc: "emergency_soc",
      profitMargin: "profit_margin",
      isDefault: "is_default",
      isActive: "is_active",
    };

    for (const [tsKey, pgCol] of Object.entries(fieldMap)) {
      const val = (body as Record<string, unknown>)[tsKey];
      if (val !== undefined) {
        setClauses.push(`${pgCol} = $${paramIdx++}`);
        values.push(val);
      }
    }

    if (body.activeHours !== undefined) {
      setClauses.push(`active_hours = $${paramIdx++}`);
      values.push(JSON.stringify(body.activeHours));
    }
    if (body.activeWeekdays !== undefined) {
      setClauses.push(`active_weekdays = $${paramIdx++}`);
      values.push(JSON.stringify(body.activeWeekdays));
    }

    values.push(strategyId);

    const result = await client.query(
      `UPDATE vpp_strategies
       SET ${setClauses.join(", ")}
       WHERE id = $${paramIdx}
       RETURNING id, org_id, strategy_name, min_soc, max_soc, emergency_soc,
                 profit_margin, active_hours, active_weekdays, is_default, is_active,
                 created_at, updated_at`,
      values,
    );

    await client.query("COMMIT");

    const row = result.rows[0];
    const strategy: VppStrategy = {
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
    };

    const response: AdminItemResponse<VppStrategy> = {
      data: strategy,
      orgId: tenant.orgId,
    };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(response),
    };
  } catch (err: unknown) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }
    const msg = String(err);
    if (msg.includes("vpp_strategies_soc_order")) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "min_soc must be less than max_soc" }),
      };
    }
    if (msg.includes("vpp_strategies_emergency_below_min")) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "emergency_soc must be less than min_soc",
        }),
      };
    }
    if (msg.includes("vpp_strategies_min_soc_range")) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "min_soc out of valid range (10-50)" }),
      };
    }
    if (msg.includes("vpp_strategies_max_soc_range")) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "max_soc out of valid range (70-100)" }),
      };
    }
    console.error(
      JSON.stringify({
        level: "ERROR",
        module: "M8",
        action: "update_vpp_strategy",
        error: msg,
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
