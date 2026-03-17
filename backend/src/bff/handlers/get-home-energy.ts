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
 * GET /api/homes/:homeId/energy
 * EP-7: 24hr time-series energy data for a home (96 × 15-min buckets).
 * Query param: date (ISO, default today)
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

  const rlsOrgId = ctx.orgId;

  // Extract homeId from path: /api/homes/:homeId/energy
  const pathParts = event.rawPath.split("/");
  const homesIdx = pathParts.indexOf("homes");
  const homeId = homesIdx >= 0 ? pathParts[homesIdx + 1] : "";

  if (!homeId) {
    return apiError(400, "homeId is required");
  }

  const dateParam = event.queryStringParameters?.date ?? new Date().toISOString().slice(0, 10);

  const { rows } = await queryWithOrg(
    `SELECT
       date_trunc('minute', th.recorded_at)
         - (EXTRACT(MINUTE FROM th.recorded_at)::INT % 15) * INTERVAL '1 minute' AS time_bucket,
       COALESCE(SUM(th.pv_power), 0) AS pv,
       COALESCE(SUM(th.load_power), 0) AS load,
       COALESCE(SUM(th.battery_power), 0) AS battery,
       COALESCE(SUM(th.grid_power_kw), 0) AS grid,
       COALESCE(AVG(th.battery_soc), 0) AS soc
     FROM telemetry_history th
     JOIN assets a ON th.asset_id = a.asset_id
     WHERE a.home_id = $1
       AND a.is_active = true
       AND th.recorded_at >= $2::DATE
       AND th.recorded_at < $2::DATE + INTERVAL '1 day'
     GROUP BY time_bucket
     ORDER BY time_bucket`,
    [homeId, dateParam],
    rlsOrgId,
  );

  // Build 96 time labels
  const timeLabels: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      timeLabels.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }

  // Initialize 96-point arrays
  const pv = new Array(96).fill(0);
  const load = new Array(96).fill(0);
  const battery = new Array(96).fill(0);
  const grid = new Array(96).fill(0);
  const soc = new Array(96).fill(0);

  for (const row of rows) {
    const r = row as Record<string, unknown>;
    const bucket = new Date(r.time_bucket as string);
    const idx = bucket.getHours() * 4 + Math.floor(bucket.getMinutes() / 15);
    if (idx >= 0 && idx < 96) {
      pv[idx] = parseFloat(String(r.pv));
      load[idx] = parseFloat(String(r.load));
      battery[idx] = parseFloat(String(r.battery));
      grid[idx] = parseFloat(String(r.grid));
      soc[idx] = parseFloat(String(r.soc));
    }
  }

  // Compute baseline (load without PV/battery)
  const baseline = load.map((l: number, i: number) => l + Math.max(0, grid[i]));

  // Compute daily savings estimate
  const totalGridImport = grid.reduce((sum: number, g: number) => sum + Math.max(0, g), 0);
  const baselineImport = baseline.reduce((sum: number, b: number) => sum + b, 0);
  const savingsKwh = baselineImport - totalGridImport;
  const savings = Math.round(savingsKwh * 0.85 * 100) / 100; // R$ estimate

  const body = ok({
    homeId,
    date: dateParam,
    timeLabels,
    pv,
    load,
    battery,
    grid,
    soc,
    acPower: new Array(96).fill(0), // Placeholder — needs per-device telemetry
    evCharge: new Array(96).fill(0), // Placeholder — needs per-device telemetry
    baseline,
    savings,
    _tenant: { orgId: ctx.orgId, role: ctx.role },
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
