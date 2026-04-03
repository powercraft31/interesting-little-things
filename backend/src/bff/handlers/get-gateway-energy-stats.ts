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
 * GET /api/gateways/{gatewayId}/energy-stats
 * v6.3: Energy statistics for 7d / 30d / 12m windows.
 * Query params:
 *   window: '7d' | '30d' | '12m'
 *   endDate: 'YYYY-MM-DD' (7d/30d) or 'YYYY-MM' (12m)
 *
 * Returns per-bucket energy metrics + totals with clamped self-consumption/sufficiency.
 * Peak demand uses MAX(load_power) from telemetry_history (not kWh approximation).
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

  // Extract gatewayId
  const pathParts = event.rawPath.split("/");
  const gatewaysIdx = pathParts.indexOf("gateways");
  const gatewayId = gatewaysIdx >= 0 ? pathParts[gatewaysIdx + 1] : "";

  if (!gatewayId) {
    return apiError(400, "gatewayId is required");
  }

  const windowParam = event.queryStringParameters?.window;
  const endDateParam = event.queryStringParameters?.endDate;

  if (!windowParam || !["7d", "30d", "12m"].includes(windowParam)) {
    return apiError(400, "window must be '7d', '30d', or '12m'");
  }
  if (!endDateParam) {
    return apiError(400, "endDate is required");
  }

  // Calculate date range
  let startDate: string;
  let endDateExclusive: string; // exclusive upper bound for SQL

  if (windowParam === "12m") {
    // endDate is YYYY-MM, compute 12-month range
    const [yearStr, monthStr] = endDateParam.split("-");
    const endYear = parseInt(yearStr, 10);
    const endMonth = parseInt(monthStr, 10);

    // End = last moment of endMonth → first day of next month
    const endNextMonth = endMonth === 12
      ? `${endYear + 1}-01-01`
      : `${endYear}-${String(endMonth + 1).padStart(2, "0")}-01`;
    endDateExclusive = endNextMonth;

    // Start = 11 months before endMonth (12 months total)
    let startYear = endYear;
    let startMonth = endMonth - 11;
    if (startMonth <= 0) {
      startMonth += 12;
      startYear -= 1;
    }
    startDate = `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
  } else {
    // 7d or 30d: endDate is YYYY-MM-DD
    const days = windowParam === "7d" ? 6 : 29;
    const end = new Date(endDateParam + "T00:00:00Z");
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - days);
    startDate = start.toISOString().slice(0, 10);
    // endDateExclusive = day after endDate
    const endPlus1 = new Date(end);
    endPlus1.setUTCDate(endPlus1.getUTCDate() + 1);
    endDateExclusive = endPlus1.toISOString().slice(0, 10);
  }

  // Determine GROUP BY expression based on window
  const groupExpr = windowParam === "12m"
    ? "TO_CHAR(DATE_TRUNC('month', m.window_start AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM')"
    : "TO_CHAR(DATE(m.window_start AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM-DD')";

  const fallbackGroupExpr = windowParam === "12m"
    ? "TO_CHAR(DATE_TRUNC('month', th.recorded_at AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM')"
    : "TO_CHAR(DATE(th.recorded_at AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM-DD')";

  // Try asset_5min_metrics first (pre-computed), fallback to telemetry_history
  const metricsResult = await queryWithOrg(
    `SELECT
       ${groupExpr} AS bucket_label,
       SUM(m.pv_energy_kwh)     AS pv_kwh,
       SUM(m.load_kwh)          AS load_kwh,
       SUM(m.grid_import_kwh)   AS grid_import_kwh,
       SUM(m.grid_export_kwh)   AS grid_export_kwh,
       SUM(m.bat_charge_kwh)    AS battery_charge_kwh,
       SUM(m.bat_discharge_kwh) AS battery_discharge_kwh
     FROM asset_5min_metrics m
     JOIN assets a ON a.asset_id = m.asset_id
     WHERE a.gateway_id = $1
       AND a.is_active = true
       AND m.window_start >= ($2::TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')
       AND m.window_start < ($3::TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')
     GROUP BY bucket_label
     ORDER BY bucket_label`,
    [gatewayId, startDate, endDateExclusive],
    rlsOrgId,
  );

  let buckets: Array<{
    label: string;
    pvKwh: number;
    loadKwh: number;
    gridImportKwh: number;
    gridExportKwh: number;
    batteryChargeKwh: number;
    batteryDischargeKwh: number;
  }>;

  if (metricsResult.rows.length > 0) {
    // Use pre-computed metrics
    buckets = metricsResult.rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        label: String(r.bucket_label),
        pvKwh: parseFloat(String(r.pv_kwh)) || 0,
        loadKwh: parseFloat(String(r.load_kwh)) || 0,
        gridImportKwh: parseFloat(String(r.grid_import_kwh)) || 0,
        gridExportKwh: parseFloat(String(r.grid_export_kwh)) || 0,
        batteryChargeKwh: parseFloat(String(r.battery_charge_kwh)) || 0,
        batteryDischargeKwh: parseFloat(String(r.battery_discharge_kwh)) || 0,
      };
    });
  } else {
    // Fallback: compute from telemetry_history directly
    const fallbackResult = await queryWithOrg(
      `SELECT
         ${fallbackGroupExpr} AS bucket_label,
         SUM(GREATEST(th.pv_power, 0) * 5.0 / 60)          AS pv_kwh,
         SUM(GREATEST(th.load_power, 0) * 5.0 / 60)         AS load_kwh,
         SUM(GREATEST(th.grid_power_kw, 0) * 5.0 / 60)      AS grid_import_kwh,
         SUM(GREATEST(-th.grid_power_kw, 0) * 5.0 / 60)     AS grid_export_kwh,
         SUM(GREATEST(-th.battery_power, 0) * 5.0 / 60)     AS battery_charge_kwh,
         SUM(GREATEST(th.battery_power, 0) * 5.0 / 60)      AS battery_discharge_kwh
       FROM telemetry_history th
       JOIN assets a ON a.asset_id = th.asset_id
       WHERE a.gateway_id = $1
         AND a.is_active = true
         AND th.recorded_at >= ($2::TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')
         AND th.recorded_at < ($3::TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')
       GROUP BY bucket_label
       ORDER BY bucket_label`,
      [gatewayId, startDate, endDateExclusive],
      rlsOrgId,
    );

    buckets = fallbackResult.rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        label: String(r.bucket_label),
        pvKwh: parseFloat(String(r.pv_kwh)) || 0,
        loadKwh: parseFloat(String(r.load_kwh)) || 0,
        gridImportKwh: parseFloat(String(r.grid_import_kwh)) || 0,
        gridExportKwh: parseFloat(String(r.grid_export_kwh)) || 0,
        batteryChargeKwh: parseFloat(String(r.battery_charge_kwh)) || 0,
        batteryDischargeKwh: parseFloat(String(r.battery_discharge_kwh)) || 0,
      };
    });
  }

  // Compute totals from buckets
  const totals = buckets.reduce(
    (acc, b) => ({
      pvGenerationKwh: acc.pvGenerationKwh + b.pvKwh,
      loadConsumptionKwh: acc.loadConsumptionKwh + b.loadKwh,
      gridImportKwh: acc.gridImportKwh + b.gridImportKwh,
      gridExportKwh: acc.gridExportKwh + b.gridExportKwh,
      batteryChargeKwh: acc.batteryChargeKwh + b.batteryChargeKwh,
      batteryDischargeKwh: acc.batteryDischargeKwh + b.batteryDischargeKwh,
    }),
    {
      pvGenerationKwh: 0,
      loadConsumptionKwh: 0,
      gridImportKwh: 0,
      gridExportKwh: 0,
      batteryChargeKwh: 0,
      batteryDischargeKwh: 0,
    },
  );

  // Self-consumption: CLAMP(0, 100, (pvGen - gridExport) / pvGen * 100)
  // Division by zero: pvGen = 0 → 0
  const selfConsumptionPct = totals.pvGenerationKwh > 0
    ? Math.max(0, Math.min(100, Math.round(
        (totals.pvGenerationKwh - totals.gridExportKwh) /
          totals.pvGenerationKwh * 100,
      )))
    : 0;

  // Self-sufficiency: CLAMP(0, 100, (load - gridImport) / load * 100)
  // Division by zero: load = 0 → 0
  const selfSufficiencyPct = totals.loadConsumptionKwh > 0
    ? Math.max(0, Math.min(100, Math.round(
        (totals.loadConsumptionKwh - totals.gridImportKwh) /
          totals.loadConsumptionKwh * 100,
      )))
    : 0;

  // Peak demand: MAX(load_power) from telemetry_history (REVIEW M2: must use real peak)
  const peakResult = await queryWithOrg(
    `SELECT COALESCE(MAX(th.load_power), 0) AS peak_demand_kw
     FROM telemetry_history th
     JOIN assets a ON a.asset_id = th.asset_id
     WHERE a.gateway_id = $1
       AND a.is_active = true
       AND th.recorded_at >= ($2::TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')
       AND th.recorded_at < ($3::TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')`,
    [gatewayId, startDate, endDateExclusive],
    rlsOrgId,
  );

  const peakDemandKw = parseFloat(
    String((peakResult.rows[0] as Record<string, unknown>)?.peak_demand_kw),
  ) || 0;

  // Round totals
  const roundedTotals = {
    pvGenerationKwh: Math.round(totals.pvGenerationKwh * 100) / 100,
    loadConsumptionKwh: Math.round(totals.loadConsumptionKwh * 100) / 100,
    gridImportKwh: Math.round(totals.gridImportKwh * 100) / 100,
    gridExportKwh: Math.round(totals.gridExportKwh * 100) / 100,
    batteryChargeKwh: Math.round(totals.batteryChargeKwh * 100) / 100,
    batteryDischargeKwh: Math.round(totals.batteryDischargeKwh * 100) / 100,
    selfConsumptionPct,
    selfSufficiencyPct,
    peakDemandKw: Math.round(peakDemandKw * 100) / 100,
  };

  // Round bucket values
  const roundedBuckets = buckets.map((b) => ({
    label: b.label,
    pvKwh: Math.round(b.pvKwh * 100) / 100,
    loadKwh: Math.round(b.loadKwh * 100) / 100,
    gridImportKwh: Math.round(b.gridImportKwh * 100) / 100,
    gridExportKwh: Math.round(b.gridExportKwh * 100) / 100,
    batteryChargeKwh: Math.round(b.batteryChargeKwh * 100) / 100,
    batteryDischargeKwh: Math.round(b.batteryDischargeKwh * 100) / 100,
  }));

  const body = ok({
    gatewayId,
    window: windowParam,
    startDate,
    endDate: endDateParam,
    buckets: roundedBuckets,
    totals: roundedTotals,
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
