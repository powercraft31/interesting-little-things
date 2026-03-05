/**
 * M8 Admin 控制面板 — 查询解析规则
 *
 * 列出调用方所属组织的设备解析规则。
 * 通过显式事务中的 SET LOCAL 激活 RLS。
 */
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { Pool } from "pg";
import type { PoolClient } from "pg";
import { Role } from "../../shared/types/auth";
import type {
  AdminListResponse,
  DeviceParserRule,
} from "../../shared/types/api";
import {
  verifyTenantToken,
  requireRole,
} from "../../shared/middleware/tenant-context";

// ---------------------------------------------------------------------------
// 数据库连接池（每次 Lambda 冷启动实例化一次）
// ---------------------------------------------------------------------------

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ---------------------------------------------------------------------------
// 允许的角色：ORG_MANAGER 及以上
// ---------------------------------------------------------------------------

const ALLOWED_ROLES = [Role.ORG_MANAGER];

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
      `SELECT id, org_id, manufacturer, model_version, mapping_rule,
              unit_conversions, is_active, created_at, updated_at
       FROM device_parser_rules
       ORDER BY manufacturer, model_version`,
    );

    await client.query("COMMIT");

    const rules: DeviceParserRule[] = result.rows.map((row) => ({
      id: row.id,
      orgId: row.org_id,
      manufacturer: row.manufacturer,
      modelVersion: row.model_version,
      mappingRule: row.mapping_rule,
      unitConversions: row.unit_conversions,
      isActive: row.is_active,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }));

    const response: AdminListResponse<DeviceParserRule> = {
      data: rules,
      total: rules.length,
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
        action: "get_parser_rules",
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
