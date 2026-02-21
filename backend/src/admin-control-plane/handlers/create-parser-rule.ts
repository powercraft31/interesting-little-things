/**
 * M8 Admin 控制面板 — 创建解析规则
 *
 * 为调用方所属组织创建新的设备解析规则。
 * 先做输入验证，再在 RLS 激活状态下插入记录。
 */
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { Pool } from "pg";
import type { PoolClient } from "pg";
import { Role } from "../../shared/types/auth";
import type {
  CreateDeviceParserRuleRequest,
  AdminItemResponse,
  DeviceParserRule,
} from "../../shared/types/api";
import {
  extractTenantContext,
  requireRole,
  apiError,
} from "../../bff/middleware/tenant-context";

// ---------------------------------------------------------------------------
// 数据库连接池
// ---------------------------------------------------------------------------

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ---------------------------------------------------------------------------
// 输入验证
// ---------------------------------------------------------------------------

function validateParserRule(body: CreateDeviceParserRuleRequest): string | null {
  if (!body.manufacturer || typeof body.manufacturer !== "string") {
    return "manufacturer is required";
  }
  if (!body.mappingRule || typeof body.mappingRule !== "object") {
    return "mappingRule must be a non-empty object";
  }
  if (body.unitConversions) {
    for (const [key, conv] of Object.entries(body.unitConversions)) {
      if (typeof conv.factor !== "number" || conv.factor <= 0) {
        return `unitConversions.${key}.factor must be a positive number`;
      }
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
    tenant = extractTenantContext(event);
    requireRole(tenant, ALLOWED_ROLES);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    return apiError(
      e.statusCode ?? 401,
      e.message ?? "Unauthorized",
    ) as APIGatewayProxyStructuredResultV2;
  }

  let body: CreateDeviceParserRuleRequest;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Invalid JSON body" }),
    };
  }

  const validationError = validateParserRule(body);
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

    const result = await client.query(
      `INSERT INTO device_parser_rules
         (org_id, manufacturer, model_version, mapping_rule, unit_conversions, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, org_id, manufacturer, model_version, mapping_rule,
                 unit_conversions, is_active, created_at, updated_at`,
      [
        tenant.orgId,
        body.manufacturer,
        body.modelVersion ?? "*",
        JSON.stringify(body.mappingRule),
        JSON.stringify(body.unitConversions ?? {}),
        body.isActive ?? true,
      ],
    );

    await client.query("COMMIT");

    const row = result.rows[0];
    const rule: DeviceParserRule = {
      id: row.id,
      orgId: row.org_id,
      manufacturer: row.manufacturer,
      modelVersion: row.model_version,
      mappingRule: row.mapping_rule,
      unitConversions: row.unit_conversions,
      isActive: row.is_active,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };

    const response: AdminItemResponse<DeviceParserRule> = {
      data: rule,
      orgId: tenant.orgId,
    };

    return {
      statusCode: 201,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(response),
    };
  } catch (err: unknown) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }
    const msg = String(err);
    if (msg.includes("device_parser_rules_org_idx")) {
      return {
        statusCode: 409,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Parser rule for this manufacturer/version already exists" }),
      };
    }
    console.error(
      JSON.stringify({ level: "ERROR", module: "M8", action: "create_parser_rule", error: msg }),
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
