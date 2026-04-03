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
 * GET /api/gateways/{gatewayId}/energy-24h
 * v6.3: 24h time-series energy data for a gateway (288 × 5-min buckets).
 * Query param: date (YYYY-MM-DD, default today in BRT)
 *
 * All time boundaries use BRT (America/Sao_Paulo).
 * Returns named-field points with BRT timestamps (-03:00) + directional summary.
 * Sign semantics:
 *   Battery: positive = discharge, negative = charge
 *   Grid:    positive = import,    negative = export
 */

/** Get today's date in BRT as YYYY-MM-DD */
function todayBRT(): string {
  const now = new Date();
  const brt = new Date(now.getTime() - 3 * 3600_000);
  return brt.toISOString().slice(0, 10);
}
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

  // Extract gatewayId from path: /api/gateways/{gatewayId}/energy-24h
  const pathParts = event.rawPath.split("/");
  const gatewaysIdx = pathParts.indexOf("gateways");
  const gatewayId = gatewaysIdx >= 0 ? pathParts[gatewaysIdx + 1] : "";

  if (!gatewayId) {
    return apiError(400, "gatewayId is required");
  }

  const dateParam =
    event.queryStringParameters?.date ?? todayBRT();

  // Query telemetry_history with 5-minute bucketing (288 points/day)
  // All boundaries in BRT: AT TIME ZONE 'America/Sao_Paulo'
  const energyResult = await queryWithOrg(
    `SELECT
       EXTRACT(HOUR FROM th.recorded_at AT TIME ZONE 'America/Sao_Paulo')::INT AS brt_hour,
       (EXTRACT(MINUTE FROM th.recorded_at AT TIME ZONE 'America/Sao_Paulo')::INT / 5 * 5)::INT AS brt_5min,
       COALESCE(AVG(th.pv_power), 0)       AS pv,
       COALESCE(AVG(th.load_power), 0)      AS load,
       COALESCE(AVG(th.battery_power), 0)   AS battery,
       COALESCE(AVG(th.grid_power_kw), 0)   AS grid,
       AVG(th.battery_soc)                  AS soc
     FROM telemetry_history th
     JOIN assets a ON th.asset_id = a.asset_id
     WHERE a.gateway_id = $1
       AND a.is_active = true
       AND th.recorded_at >= ($2::TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')
       AND th.recorded_at < (($2::DATE + 1)::TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')
     GROUP BY brt_hour, brt_5min
     ORDER BY brt_hour, brt_5min`,
    [gatewayId, dateParam],
    rlsOrgId,
  );

  // Build 288-point array with named fields
  const pointsMap = new Map<number, {
    pv: number;
    load: number;
    battery: number;
    grid: number;
    soc: number | null;
  }>();

  for (const row of energyResult.rows) {
    const r = row as Record<string, unknown>;
    const brtHour = Number(r.brt_hour);
    const brtMinute = Number(r.brt_5min);
    const idx = brtHour * 12 + Math.floor(brtMinute / 5);
    if (idx >= 0 && idx < 288) {
      pointsMap.set(idx, {
        pv: parseFloat(String(r.pv)),
        load: parseFloat(String(r.load)),
        battery: parseFloat(String(r.battery)),
        grid: parseFloat(String(r.grid)),
        soc: r.soc != null ? parseFloat(String(r.soc)) : null,
      });
    }
  }

  // Build points array with ISO timestamps
  const points: Array<{
    ts: string;
    pv: number;
    load: number;
    battery: number;
    grid: number;
    soc: number | null;
  }> = [];

  // Compute directional summary while iterating
  let batteryChargeKwh = 0;
  let batteryDischargeKwh = 0;
  let gridImportKwh = 0;
  let gridExportKwh = 0;

  for (let i = 0; i < 288; i++) {
    const h = Math.floor(i / 12);
    const m = (i % 12) * 5;
    const ts = `${dateParam}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00-03:00`;

    const p = pointsMap.get(i);
    if (p) {
      points.push({ ts, ...p });
      // Convert 5-min power (kW) to energy (kWh): kW * (5/60)
      if (p.battery < 0) {
        batteryChargeKwh += Math.abs(p.battery) * (5 / 60);
      } else {
        batteryDischargeKwh += p.battery * (5 / 60);
      }
      if (p.grid > 0) {
        gridImportKwh += p.grid * (5 / 60);
      } else {
        gridExportKwh += Math.abs(p.grid) * (5 / 60);
      }
    } else {
      points.push({ ts, pv: 0, load: 0, battery: 0, grid: 0, soc: null });
    }
  }

  // Round summary values to 2 decimal places
  const summary = {
    batteryChargeKwh: Math.round(batteryChargeKwh * 100) / 100,
    batteryDischargeKwh: Math.round(batteryDischargeKwh * 100) / 100,
    gridImportKwh: Math.round(gridImportKwh * 100) / 100,
    gridExportKwh: Math.round(gridExportKwh * 100) / 100,
  };

  const body = ok({
    gatewayId,
    date: dateParam,
    resolution: "5min",
    points,
    summary,
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
