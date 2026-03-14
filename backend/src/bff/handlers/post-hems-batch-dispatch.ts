import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import * as crypto from "crypto";
import { ok } from "../../shared/types/api";
import { Role } from "../../shared/types/auth";
import {
  extractTenantContext,
  requireRole,
  apiError,
} from "../middleware/auth";
import { queryWithOrg } from "../../shared/db";
import {
  validateSchedule,
  type DomainSchedule,
  type DomainSlot,
} from "../../iot-hub/handlers/schedule-translator";

// ── Types ────────────────────────────────────────────────────────────────

interface BatchDispatchRequest {
  mode: string;
  socMinLimit: number;
  socMaxLimit: number;
  gridImportLimitKw?: number;
  arbSlots?: Array<{
    startHour: number;
    endHour: number;
    action: string;
  }>;
  gatewayIds: string[];
}

interface GatewayResult {
  gatewayId: string;
  status: "pending" | "skipped";
  commandId?: number;
  reason?: string;
}

// ── Safe Defaults ────────────────────────────────────────────────────────

const SAFE_DEFAULTS = {
  maxChargeCurrent: 100,
  maxDischargeCurrent: 100,
  gridImportLimitKw: 3000,
};

const VALID_MODES = [
  "self_consumption",
  "peak_shaving",
  "peak_valley_arbitrage",
];

// ── Handler ──────────────────────────────────────────────────────────────

/**
 * POST /api/hems/batch-dispatch
 * Batch dispatch mode to multiple gateways via device_command_logs pipeline.
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

  const isAdmin = ctx.role === Role.SOLFACIL_ADMIN;
  const rlsOrgId = isAdmin ? null : ctx.orgId;

  // 2. Parse body
  let body: BatchDispatchRequest;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return apiError(400, "Invalid JSON body");
  }

  // 3. Request-level validation
  const validationError = validateRequest(body);
  if (validationError) {
    return apiError(400, validationError);
  }

  // 4. Generate batch_id
  const batchId = `batch-${Date.now()}-${crypto.randomBytes(2).toString("hex")}`;

  // 5. Generate slots from mode + arbSlots
  const slots = generateSlots(body.mode, body.arbSlots);

  // 6. Batch queries (3 SELECTs instead of N×4 per-gateway)
  const gatewayIds = body.gatewayIds;

  // 6a. Batch RLS check
  const { rows: validRows } = await queryWithOrg<{ gateway_id: string }>(
    `SELECT gateway_id FROM gateways WHERE gateway_id = ANY($1)`,
    [gatewayIds],
    rlsOrgId,
  );
  const validSet = new Set(validRows.map((r) => r.gateway_id));

  // 6b. Batch read latest successful schedules
  const historyMap = await batchReadHistoricalSchedules(gatewayIds);

  // 6c. Batch check active commands
  const activeSet = await batchCheckActiveCommands(gatewayIds);

  // 6d. Batch read rated capacity (Phase 2)
  const ratedMap = await batchReadRatedCapacity(gatewayIds);

  // 7. Per-gateway merge + insert
  const results: GatewayResult[] = [];

  for (const gatewayId of gatewayIds) {
    if (!validSet.has(gatewayId)) {
      results.push({
        gatewayId,
        status: "skipped",
        reason: "gateway_not_found",
      });
      continue;
    }

    if (activeSet.has(gatewayId)) {
      results.push({ gatewayId, status: "skipped", reason: "active_command" });
      continue;
    }

    try {
      const historical = historyMap.get(gatewayId);
      const ratedMax = ratedMap.get(gatewayId) ?? null;
      const schedule = buildDomainSchedule(body, slots, historical, ratedMax);

      validateSchedule(schedule);

      const insertResult = await queryWithOrg<{ id: string }>(
        `INSERT INTO device_command_logs
           (gateway_id, command_type, config_name, payload_json, result, batch_id, source)
         VALUES ($1, 'set', 'battery_schedule', $2, 'pending', $3, 'p4')
         RETURNING id`,
        [gatewayId, JSON.stringify(schedule), batchId],
        rlsOrgId,
      );

      results.push({
        gatewayId,
        status: "pending",
        commandId: Number(insertResult.rows[0].id),
      });
    } catch {
      results.push({
        gatewayId,
        status: "skipped",
        reason: "validation_failed",
      });
    }
  }

  // 8. Build response
  const pending = results.filter((r) => r.status === "pending").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  const responseBody = ok({
    batchId,
    results,
    summary: {
      total: results.length,
      pending,
      skipped,
    },
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(responseBody),
  };
}

// ── Validation ───────────────────────────────────────────────────────────

function validateRequest(body: BatchDispatchRequest): string | null {
  if (!body.mode || !VALID_MODES.includes(body.mode)) {
    return `mode must be one of: ${VALID_MODES.join(", ")}`;
  }

  if (
    !Number.isInteger(body.socMinLimit) ||
    body.socMinLimit < 5 ||
    body.socMinLimit > 50
  ) {
    return "socMinLimit must be an integer between 5 and 50";
  }

  if (
    !Number.isInteger(body.socMaxLimit) ||
    body.socMaxLimit < 70 ||
    body.socMaxLimit > 100
  ) {
    return "socMaxLimit must be an integer between 70 and 100";
  }

  if (body.socMinLimit >= body.socMaxLimit) {
    return "socMinLimit must be less than socMaxLimit";
  }

  if (!Array.isArray(body.gatewayIds) || body.gatewayIds.length === 0) {
    return "gatewayIds must be a non-empty array";
  }

  if (body.gatewayIds.length > 100) {
    return "gatewayIds must contain at most 100 entries";
  }

  if (body.mode === "peak_shaving") {
    if (body.gridImportLimitKw == null || body.gridImportLimitKw < 0) {
      return "gridImportLimitKw is required and must be >= 0 for peak_shaving mode";
    }
  }

  if (body.mode === "peak_valley_arbitrage") {
    const arbError = validateArbSlots(body.arbSlots);
    if (arbError) return arbError;
  }

  return null;
}

function validateArbSlots(
  arbSlots: BatchDispatchRequest["arbSlots"],
): string | null {
  if (!Array.isArray(arbSlots) || arbSlots.length === 0) {
    return "arbSlots is required for peak_valley_arbitrage mode";
  }

  for (let i = 0; i < arbSlots.length; i++) {
    const s = arbSlots[i];
    if (!Number.isInteger(s.startHour) || s.startHour < 0 || s.startHour > 23) {
      return `arbSlots[${i}].startHour must be integer 0-23`;
    }
    if (!Number.isInteger(s.endHour) || s.endHour < 1 || s.endHour > 24) {
      return `arbSlots[${i}].endHour must be integer 1-24`;
    }
    if (s.endHour <= s.startHour) {
      return `arbSlots[${i}].endHour must be > startHour`;
    }
    if (s.action !== "charge" && s.action !== "discharge") {
      return `arbSlots[${i}].action must be 'charge' or 'discharge'`;
    }
  }

  // Check 0-24h coverage
  const sorted = [...arbSlots].sort((a, b) => a.startHour - b.startHour);
  if (sorted[0].startHour !== 0) {
    return "arbSlots must start at hour 0";
  }
  if (sorted[sorted.length - 1].endHour !== 24) {
    return "arbSlots must end at hour 24";
  }
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startHour !== sorted[i - 1].endHour) {
      return `arbSlots gap or overlap between hour ${sorted[i - 1].endHour} and ${sorted[i].startHour}`;
    }
  }

  return null;
}

// ── Slot Generation ──────────────────────────────────────────────────────

function generateSlots(
  mode: string,
  arbSlots?: BatchDispatchRequest["arbSlots"],
): ReadonlyArray<DomainSlot> {
  if (mode === "self_consumption") {
    return [{ mode: "self_consumption", startMinute: 0, endMinute: 1440 }];
  }

  if (mode === "peak_shaving") {
    return [{ mode: "peak_shaving", startMinute: 0, endMinute: 1440 }];
  }

  // peak_valley_arbitrage
  return (arbSlots ?? []).map(
    (s): DomainSlot => ({
      mode: "peak_valley_arbitrage",
      action: s.action as "charge" | "discharge",
      startMinute: s.startHour * 60,
      endMinute: s.endHour * 60,
    }),
  );
}

// ── Batch Queries ────────────────────────────────────────────────────────

async function batchReadHistoricalSchedules(
  gatewayIds: string[],
): Promise<Map<string, DomainSchedule>> {
  const { rows } = await queryWithOrg<{
    gateway_id: string;
    payload_json: DomainSchedule;
  }>(
    `SELECT DISTINCT ON (gateway_id)
            gateway_id, payload_json
     FROM device_command_logs
     WHERE gateway_id = ANY($1)
       AND command_type = 'set'
       AND config_name = 'battery_schedule'
       AND result IN ('success', 'accepted')
     ORDER BY gateway_id, created_at DESC`,
    [gatewayIds],
    null, // Use service pool to see all commands
  );

  const map = new Map<string, DomainSchedule>();
  for (const row of rows) {
    try {
      const payload =
        typeof row.payload_json === "string"
          ? JSON.parse(row.payload_json as unknown as string)
          : row.payload_json;
      if (payload && typeof payload.maxChargeCurrent === "number") {
        map.set(row.gateway_id, payload as DomainSchedule);
      }
    } catch {
      // Malformed payload — skip, will use defaults
    }
  }
  return map;
}

async function batchCheckActiveCommands(
  gatewayIds: string[],
): Promise<Set<string>> {
  const { rows } = await queryWithOrg<{ gateway_id: string }>(
    `SELECT DISTINCT gateway_id
     FROM device_command_logs
     WHERE gateway_id = ANY($1)
       AND command_type = 'set'
       AND config_name = 'battery_schedule'
       AND result IN ('pending', 'dispatched', 'accepted')`,
    [gatewayIds],
    null, // Service pool
  );

  return new Set(rows.map((r) => r.gateway_id));
}

// ── Rated Capacity ──────────────────────────────────────────────────────

async function batchReadRatedCapacity(
  gatewayIds: string[],
): Promise<Map<string, number>> {
  const { rows } = await queryWithOrg<{
    gateway_id: string;
    rated_max_power_kw: number | null;
  }>(
    `SELECT gateway_id, rated_max_power_kw
     FROM assets
     WHERE gateway_id = ANY($1)
       AND asset_type = 'INVERTER_BATTERY'
       AND is_active = true`,
    [gatewayIds],
    null, // Service pool
  );

  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.rated_max_power_kw != null) {
      map.set(row.gateway_id, row.rated_max_power_kw);
    }
  }
  return map;
}

// ── DomainSchedule Builder ───────────────────────────────────────────────

function buildDomainSchedule(
  request: BatchDispatchRequest,
  slots: ReadonlyArray<DomainSlot>,
  historical: DomainSchedule | undefined,
  ratedMaxPowerKw: number | null,
): DomainSchedule {
  const hist = historical ?? (SAFE_DEFAULTS as unknown as DomainSchedule);

  let maxChargeCurrent =
    typeof hist.maxChargeCurrent === "number"
      ? hist.maxChargeCurrent
      : SAFE_DEFAULTS.maxChargeCurrent;

  let maxDischargeCurrent =
    typeof hist.maxDischargeCurrent === "number"
      ? hist.maxDischargeCurrent
      : SAFE_DEFAULTS.maxDischargeCurrent;

  // Phase 2: Clamp against hardware rated capacity (don't reject)
  if (ratedMaxPowerKw != null) {
    maxChargeCurrent = Math.min(maxChargeCurrent, ratedMaxPowerKw);
    maxDischargeCurrent = Math.min(maxDischargeCurrent, ratedMaxPowerKw);
  }

  // gridImportLimitKw: peak_shaving → use P4 new value; others → historical
  const gridImportLimitKw =
    request.mode === "peak_shaving"
      ? (request.gridImportLimitKw ?? SAFE_DEFAULTS.gridImportLimitKw)
      : typeof hist.gridImportLimitKw === "number"
        ? hist.gridImportLimitKw
        : SAFE_DEFAULTS.gridImportLimitKw;

  return {
    socMinLimit: request.socMinLimit,
    socMaxLimit: request.socMaxLimit,
    maxChargeCurrent,
    maxDischargeCurrent,
    gridImportLimitKw,
    slots,
  };
}
