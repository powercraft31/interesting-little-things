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

/**
 * GET /api/assets/:assetId/health?from=&to=
 * P3-2: Device health — SOC/SOH/temperature history + DO events + battery cycles.
 */
export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  let ctx;
  try {
    ctx = extractTenantContext(event);
    requireRole(ctx, [
      Role.SOLFACIL_ADMIN,
      Role.ORG_MANAGER,
      Role.ORG_OPERATOR,
      Role.ORG_VIEWER,
    ]);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    return apiError(e.statusCode ?? 500, e.message ?? "Error");
  }

  const isAdmin = ctx.role === Role.SOLFACIL_ADMIN;
  const rlsOrgId = isAdmin ? null : ctx.orgId;

  // Extract assetId from path: /api/assets/:assetId/health
  const pathParts = event.rawPath.split("/");
  const assetsIdx = pathParts.indexOf("assets");
  const assetId = assetsIdx >= 0 ? pathParts[assetsIdx + 1] : "";

  if (!assetId) {
    return apiError(400, "assetId is required");
  }

  // Validate query parameters
  const from = event.queryStringParameters?.from;
  const to = event.queryStringParameters?.to;

  if (!from || !to) {
    return apiError(400, "from and to are required (ISO datetime)");
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return apiError(400, "from and to are required (ISO datetime)");
  }

  if (toDate <= fromDate) {
    return apiError(400, "to must be after from");
  }

  // Q1: Current state (latest record)
  const currentSQL = `
    SELECT
      battery_soc,
      battery_soh,
      battery_temperature,
      inverter_temp,
      bat_work_status
    FROM telemetry_history
    WHERE asset_id = $1
    ORDER BY recorded_at DESC
    LIMIT 1`;

  // Q2: SOC history
  const socSQL = `
    SELECT recorded_at AS t, battery_soc AS soc
    FROM telemetry_history
    WHERE asset_id = $1
      AND recorded_at >= $2
      AND recorded_at < $3
    ORDER BY recorded_at`;

  // Q3: SOH daily trend
  const sohSQL = `
    SELECT
      date_trunc('day', recorded_at AT TIME ZONE 'America/Sao_Paulo') AS day,
      AVG(battery_soh) AS soh
    FROM telemetry_history
    WHERE asset_id = $1
      AND recorded_at >= $2
      AND recorded_at < $3
      AND battery_soh IS NOT NULL
    GROUP BY day
    ORDER BY day`;

  // Q4: Temperature history
  const tempSQL = `
    SELECT
      recorded_at AS t,
      battery_temperature AS bat_temp,
      inverter_temp AS inv_temp
    FROM telemetry_history
    WHERE asset_id = $1
      AND recorded_at >= $2
      AND recorded_at < $3
    ORDER BY recorded_at`;

  // Q5: Battery cycles (total discharge)
  const cyclesSQL = `
    SELECT
      COALESCE(SUM(sub.day_discharge), 0) AS total_discharge
    FROM (
      SELECT
        date_trunc('day', th.recorded_at AT TIME ZONE 'America/Sao_Paulo') AS day,
        MAX(th.daily_discharge_kwh) AS day_discharge
      FROM telemetry_history th
      WHERE th.asset_id = $1
        AND th.recorded_at >= $2
        AND th.recorded_at < $3
      GROUP BY day
    ) sub`;

  // Q6: DO events (window function: false→true→false intervals)
  const doEventsSQL = `
    WITH ordered AS (
      SELECT
        recorded_at,
        do0_active,
        LAG(do0_active) OVER (ORDER BY recorded_at) AS prev_do0
      FROM telemetry_history
      WHERE asset_id = $1
        AND recorded_at >= $2
        AND recorded_at < $3
    ),
    starts AS (
      SELECT recorded_at AS event_start
      FROM ordered
      WHERE do0_active = true AND (prev_do0 = false OR prev_do0 IS NULL)
    ),
    ends AS (
      SELECT recorded_at AS event_end
      FROM ordered
      WHERE do0_active = false AND prev_do0 = true
    )
    SELECT
      s.event_start,
      (SELECT MIN(e.event_end) FROM ends e WHERE e.event_end > s.event_start) AS event_end
    FROM starts s
    ORDER BY s.event_start`;

  // Q7: Asset capacity_kwh
  const assetSQL = `
    SELECT capacity_kwh
    FROM assets
    WHERE asset_id = $1`;

  // Q8: Voltage/current history
  const voltageSQL = `
    SELECT
      recorded_at AS t,
      battery_voltage AS voltage,
      battery_current AS current
    FROM telemetry_history
    WHERE asset_id = $1
      AND recorded_at >= $2
      AND recorded_at < $3
    ORDER BY recorded_at`;

  const [
    currentResult,
    socResult,
    sohResult,
    tempResult,
    cyclesResult,
    doResult,
    assetResult,
    voltageResult,
  ] = await Promise.all([
    queryWithOrg(currentSQL, [assetId], rlsOrgId),
    queryWithOrg(socSQL, [assetId, from, to], rlsOrgId),
    queryWithOrg(sohSQL, [assetId, from, to], rlsOrgId),
    queryWithOrg(tempSQL, [assetId, from, to], rlsOrgId),
    queryWithOrg(cyclesSQL, [assetId, from, to], rlsOrgId),
    queryWithOrg(doEventsSQL, [assetId, from, to], rlsOrgId),
    queryWithOrg(assetSQL, [assetId], rlsOrgId),
    queryWithOrg(voltageSQL, [assetId, from, to], rlsOrgId),
  ]);

  // Check asset exists
  if (assetResult.rows.length === 0) {
    return apiError(404, "Asset not found");
  }

  // Current state
  const curr = (currentResult.rows[0] ?? {}) as Record<string, unknown>;
  const current = {
    soc: safeNumber(curr.battery_soc),
    soh: safeNumber(curr.battery_soh),
    batTemp: safeNumber(curr.battery_temperature),
    invTemp: safeNumber(curr.inverter_temp),
    status: (curr.bat_work_status as string) ?? null,
  };

  // SOC history
  const socHistory = socResult.rows.map((r: Record<string, unknown>) => ({
    t: r.t,
    soc: safeNumber(r.soc),
  }));

  // SOH trend
  const sohTrend = sohResult.rows.map((r: Record<string, unknown>) => ({
    day: r.day,
    soh: safeNumber(r.soh),
  }));

  // Temperature history
  const tempHistory = tempResult.rows.map((r: Record<string, unknown>) => ({
    t: r.t,
    batTemp: safeNumber(r.bat_temp),
    invTemp: safeNumber(r.inv_temp),
  }));

  // Voltage/current history
  const voltageHistory = voltageResult.rows.map(
    (r: Record<string, unknown>) => ({
      t: r.t,
      voltage: safeNumber(r.voltage),
      current: safeNumber(r.current),
    }),
  );

  // Battery cycles
  const assetRow = assetResult.rows[0] as Record<string, unknown>;
  const capacityKwh = parseFloat(String(assetRow.capacity_kwh ?? 0));
  const cyclesRow = (cyclesResult.rows[0] ?? {}) as Record<string, unknown>;
  const totalDischarge = parseFloat(String(cyclesRow.total_discharge ?? 0));
  const batteryCycles =
    capacityKwh > 0
      ? Math.round((totalDischarge / capacityKwh) * 10) / 10
      : 0;

  // DO events with duration
  const doEvents = doResult.rows.map((r: Record<string, unknown>) => {
    const start = r.event_start as string;
    const end = r.event_end as string | null;
    const durationMin =
      end != null
        ? Math.round(
            (new Date(end).getTime() - new Date(start).getTime()) / 60000,
          )
        : null;
    return { start, end, durationMin };
  });

  const body = ok({
    current,
    socHistory,
    sohTrend,
    tempHistory,
    voltageHistory,
    batteryCycles,
    doEvents,
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function safeNumber(val: unknown): number | null {
  if (val == null) return null;
  const n = parseFloat(String(val));
  return isNaN(n) ? null : n;
}
