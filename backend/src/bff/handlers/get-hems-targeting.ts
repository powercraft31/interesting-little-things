import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { ok } from "../../shared/types/api";
import { Role } from "../../shared/types/auth";
import {
  extractTenantContext,
  requireRole,
  apiError,
} from "../middleware/auth";
import { queryWithOrg } from "../../shared/db";

// ── Types ────────────────────────────────────────────────────────────────

interface GatewayRow {
  gateway_id: string;
  name: string;
  home_alias: string | null;
  integrator: string;
  status: string;
  last_seen_at: string | null;
  device_count: string;
  [key: string]: unknown;
}

interface ScheduleRow {
  gateway_id: string;
  payload_json: Record<string, unknown> | null;
  [key: string]: unknown;
}

interface ActiveCommandRow {
  gateway_id: string;
  batch_id: string;
  [key: string]: unknown;
}

interface SlotEntry {
  mode?: string;
  action?: string;
  startMinute?: number;
  endMinute?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function extractMode(payload: Record<string, unknown> | null | undefined): string | null {
  try {
    if (!payload) return null;
    const slots = payload.slots as SlotEntry[] | undefined;
    if (!Array.isArray(slots) || slots.length === 0) return null;
    return slots[0].mode ?? null;
  } catch {
    return null;
  }
}

function extractSlots(payload: Record<string, unknown> | null | undefined): SlotEntry[] | null {
  try {
    if (!payload) return null;
    const slots = payload.slots as SlotEntry[] | undefined;
    if (!Array.isArray(slots) || slots.length === 0) return null;
    return slots.map((s) => ({
      mode: s.mode,
      action: s.action,
      startMinute: s.startMinute,
      endMinute: s.endMinute,
    }));
  } catch {
    return null;
  }
}

// ── Handler ──────────────────────────────────────────────────────────────

/**
 * GET /api/hems/targeting
 * Returns fleet-wide gateway eligibility data for the HEMS Control Workbench.
 * 3 batch queries → merge → HEMSTargetingResponse
 */
export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  // 1. Auth
  let ctx;
  try {
    ctx = extractTenantContext(event);
    requireRole(ctx, [
      Role.SOLFACIL_ADMIN,
      Role.ORG_MANAGER,
      Role.ORG_OPERATOR,
    ]);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    return apiError(e.statusCode ?? 500, e.message ?? "Error");
  }

  const rlsOrgId = ctx.orgId;

  // 2. Query 1 — Gateway list with device count
  const { rows: q1Rows } = await queryWithOrg<GatewayRow>(
    `SELECT
       g.gateway_id,
       g.name,
       g.home_alias,
       o.name AS integrator,
       g.status,
       g.last_seen_at,
       COUNT(a.asset_id) AS device_count
     FROM gateways g
     LEFT JOIN organizations o ON o.org_id = g.org_id
     LEFT JOIN assets a ON a.gateway_id = g.gateway_id
     WHERE ($1::VARCHAR IS NULL OR g.org_id = $1)
     GROUP BY g.gateway_id, g.name, g.home_alias, o.name, g.status, g.last_seen_at`,
    [rlsOrgId],
    rlsOrgId,
  );

  if (q1Rows.length === 0) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ok({ gateways: [] })),
    };
  }

  const gatewayIds = q1Rows.map((r) => r.gateway_id);

  // 3. Query 2 — Latest successful schedule per gateway
  const { rows: q2Rows } = await queryWithOrg<ScheduleRow>(
    `SELECT DISTINCT ON (gateway_id)
       gateway_id, payload_json
     FROM device_command_logs
     WHERE gateway_id = ANY($1)
       AND command_type = 'set'
       AND config_name = 'battery_schedule'
       AND result IN ('success', 'accepted')
     ORDER BY gateway_id, created_at DESC`,
    [gatewayIds],
    rlsOrgId,
  );

  // 4. Query 3 — Active commands per gateway (most recent blocking batch)
  const { rows: q3Rows } = await queryWithOrg<ActiveCommandRow>(
    `SELECT DISTINCT ON (gateway_id)
       gateway_id, batch_id
     FROM device_command_logs
     WHERE gateway_id = ANY($1)
       AND command_type = 'set'
       AND config_name = 'battery_schedule'
       AND result IN ('pending', 'dispatched', 'accepted')
     ORDER BY gateway_id, created_at DESC`,
    [gatewayIds],
    rlsOrgId,
  );

  // 5. Application-level merge
  const scheduleMap = new Map(q2Rows.map((r) => [r.gateway_id, r.payload_json]));
  const activeMap = new Map(q3Rows.map((r) => [r.gateway_id, r.batch_id]));

  const gateways = q1Rows.map((g) => ({
    gatewayId: g.gateway_id,
    name: g.name,
    homeAlias: g.home_alias,
    integrator: g.integrator,
    status: g.status,
    deviceCount: Number(g.device_count),
    lastSeenAt: g.last_seen_at,
    currentMode: extractMode(scheduleMap.get(g.gateway_id)),
    currentSlots: extractSlots(scheduleMap.get(g.gateway_id)),
    hasActiveCommand: activeMap.has(g.gateway_id),
    activeCommandBatchId: activeMap.get(g.gateway_id) ?? null,
  }));

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ok({ gateways })),
  };
}
