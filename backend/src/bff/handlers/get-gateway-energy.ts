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
 * GET /api/gateways/:gatewayId/energy
 * EP-7: 24hr time-series energy data for a gateway (96 × 15-min buckets).
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

  const isAdmin = ctx.role === Role.SOLFACIL_ADMIN;
  const rlsOrgId = isAdmin ? null : ctx.orgId;

  // Extract gatewayId from path: /api/gateways/:gatewayId/energy
  const pathParts = event.rawPath.split("/");
  const gatewaysIdx = pathParts.indexOf("gateways");
  const gatewayId = gatewaysIdx >= 0 ? pathParts[gatewaysIdx + 1] : "";

  if (!gatewayId) {
    return apiError(400, "gatewayId is required");
  }

  const dateParam =
    event.queryStringParameters?.date ?? new Date().toISOString().slice(0, 10);

  const [energyResult, tariffResult] = await Promise.all([
    queryWithOrg(
      `SELECT
         date_trunc('minute', th.recorded_at)
           - (EXTRACT(MINUTE FROM th.recorded_at)::INT % 15) * INTERVAL '1 minute' AS time_bucket,
         COALESCE(SUM(th.pv_power), 0) AS pv,
         COALESCE(SUM(th.load_power), 0) AS load,
         COALESCE(SUM(th.battery_power), 0) AS battery,
         COALESCE(SUM(th.grid_power_kw), 0) AS grid,
         COALESCE(AVG(th.battery_soc), 0) AS soc,
         COALESCE(AVG(th.flload_power), 0) AS flload
       FROM telemetry_history th
       JOIN assets a ON th.asset_id = a.asset_id
       WHERE a.gateway_id = $1
         AND a.is_active = true
         AND th.recorded_at >= $2::DATE
         AND th.recorded_at < $2::DATE + INTERVAL '1 day'
       GROUP BY time_bucket
       ORDER BY time_bucket`,
      [gatewayId, dateParam],
      rlsOrgId,
    ),
    queryWithOrg(
      `SELECT peak_rate, offpeak_rate,
              COALESCE(intermediate_rate, (peak_rate + offpeak_rate) / 2.0) AS intermediate_rate,
              peak_start, peak_end, intermediate_start, intermediate_end
       FROM tariff_schedules
       ORDER BY effective_from DESC LIMIT 1`,
      [],
      rlsOrgId,
    ),
  ]);

  // Build 96 time labels
  const timeLabels: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      timeLabels.push(
        `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
      );
    }
  }

  // Initialize 96-point arrays
  const pv = new Array(96).fill(0);
  const load = new Array(96).fill(0);
  const battery = new Array(96).fill(0);
  const grid = new Array(96).fill(0);
  const soc = new Array(96).fill(0);
  const flload = new Array(96).fill(0);

  for (const row of energyResult.rows) {
    const r = row as Record<string, unknown>;
    const bucket = new Date(r.time_bucket as string);
    const idx = bucket.getHours() * 4 + Math.floor(bucket.getMinutes() / 15);
    if (idx >= 0 && idx < 96) {
      pv[idx] = parseFloat(String(r.pv));
      load[idx] = parseFloat(String(r.load));
      battery[idx] = parseFloat(String(r.battery));
      grid[idx] = parseFloat(String(r.grid));
      soc[idx] = parseFloat(String(r.soc));
      flload[idx] = parseFloat(String(r.flload));
    }
  }

  // Compute baseline (load without PV/battery)
  const baseline = load.map((l: number, i: number) => l + Math.max(0, grid[i]));

  // Compute daily savings using tariff rates
  const tariff = tariffResult.rows[0] as Record<string, unknown> | undefined;
  const peakRate = tariff ? parseFloat(String(tariff.peak_rate)) : null;
  const offpeakRate = tariff ? parseFloat(String(tariff.offpeak_rate)) : null;
  const intermediateRate = tariff
    ? parseFloat(String(tariff.intermediate_rate))
    : null;

  // Parse peak hours for rate assignment
  const peakStartHour = tariff
    ? parseInt(String(tariff.peak_start ?? "17:00").slice(0, 2), 10)
    : 17;
  const peakEndHour = tariff
    ? parseInt(String(tariff.peak_end ?? "20:00").slice(0, 2), 10)
    : 20;
  const intStartHour = tariff
    ? parseInt(String(tariff.intermediate_start ?? "16:00").slice(0, 2), 10)
    : 16;
  const intEndHour = tariff
    ? parseInt(String(tariff.intermediate_end ?? "21:00").slice(0, 2), 10)
    : 21;

  let savingsBrl: number | null = null;
  if (peakRate != null && offpeakRate != null && intermediateRate != null) {
    savingsBrl = 0;
    for (let i = 0; i < 96; i++) {
      const hour = Math.floor(i / 4);
      const savedKwh = Math.max(0, baseline[i] - Math.max(0, grid[i])) * 0.25; // 15-min bucket → kWh
      let rate = offpeakRate;
      if (hour >= peakStartHour && hour < peakEndHour) {
        rate = peakRate;
      } else if (hour >= intStartHour && hour < intEndHour) {
        rate = intermediateRate;
      }
      savingsBrl += savedKwh * rate;
    }
    savingsBrl = Math.round(savingsBrl * 100) / 100;
  }

  const body = ok({
    gatewayId,
    date: dateParam,
    timeLabels,
    pv,
    load,
    battery,
    grid,
    soc,
    flload,
    acPower: new Array(96).fill(0), // Placeholder — needs per-device telemetry
    evCharge: new Array(96).fill(0), // Placeholder — needs per-device telemetry
    baseline,
    savingsBrl,
    _tenant: { orgId: ctx.orgId, role: ctx.role },
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
