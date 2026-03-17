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
import { getRateForHour } from "../../shared/tarifa";
import type { TariffSchedule } from "../../shared/tarifa";

const VALID_RESOLUTIONS = ["5min", "hour", "day", "month"] as const;
type Resolution = (typeof VALID_RESOLUTIONS)[number];

const MAX_RANGE_DAYS = 400;

/**
 * GET /api/assets/:assetId/telemetry?from=&to=&resolution=5min|hour|day|month
 * P3-1: Multi-resolution energy flow + summary + savings.
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

  // Extract assetId from path: /api/assets/:assetId/telemetry
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

  const rangeDays =
    (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24);
  if (rangeDays > MAX_RANGE_DAYS) {
    return apiError(400, "Date range must not exceed 400 days");
  }

  const resolution =
    (event.queryStringParameters?.resolution as Resolution) ?? "5min";
  if (!VALID_RESOLUTIONS.includes(resolution)) {
    return apiError(
      400,
      "resolution must be one of: 5min, hour, day, month",
    );
  }

  // Build resolution-dependent SQL
  const timeSeriesSQL = buildTimeSeriesSQL(resolution);

  const summarySQL = `
    SELECT
      SUM(day_pv) AS pv_total,
      SUM(day_load) AS load_total,
      SUM(day_grid_import) AS grid_import_total,
      SUM(day_grid_export) AS grid_export_total,
      MAX(max_load) AS peak_demand
    FROM (
      SELECT
        date_trunc('day', recorded_at AT TIME ZONE 'America/Sao_Paulo') AS day,
        MAX(pv_daily_energy_kwh) AS day_pv,
        SUM(load_power) / 12 AS day_load,
        SUM(grid_import_kwh) AS day_grid_import,
        SUM(grid_export_kwh) AS day_grid_export,
        MAX(load_power) AS max_load
      FROM telemetry_history
      WHERE asset_id = $1
        AND recorded_at >= $2
        AND recorded_at < $3
      GROUP BY day
    ) daily`;

  const tariffSQL = `
    SELECT
      peak_rate, offpeak_rate, feed_in_rate,
      COALESCE(intermediate_rate, (peak_rate + offpeak_rate) / 2.0) AS intermediate_rate,
      peak_start, peak_end, intermediate_start, intermediate_end
    FROM tariff_schedules
    WHERE org_id = $1
      AND (effective_to IS NULL OR effective_to > NOW())
    ORDER BY effective_from DESC
    LIMIT 1`;

  // For savings calculation, always fetch raw 5min data
  const rawSQL = `
    SELECT
      recorded_at,
      load_power,
      grid_import_kwh,
      grid_export_kwh
    FROM telemetry_history
    WHERE asset_id = $1
      AND recorded_at >= $2
      AND recorded_at < $3
    ORDER BY recorded_at`;

  const [pointsResult, summaryResult, tariffResult, rawResult] =
    await Promise.all([
      queryWithOrg(timeSeriesSQL, [assetId, from, to], rlsOrgId),
      queryWithOrg(summarySQL, [assetId, from, to], rlsOrgId),
      queryWithOrg(tariffSQL, [ctx.orgId], rlsOrgId),
      queryWithOrg(rawSQL, [assetId, from, to], rlsOrgId),
    ]);

  // If no data at all, check if asset exists for this org
  if (
    pointsResult.rows.length === 0 &&
    summaryResult.rows.length === 0 &&
    rawResult.rows.length === 0
  ) {
    const assetCheck = await queryWithOrg(
      `SELECT asset_id FROM assets WHERE asset_id = $1`,
      [assetId],
      rlsOrgId,
    );
    if (assetCheck.rows.length === 0) {
      return apiError(404, "Asset not found");
    }
  }

  // Map points
  const points = pointsResult.rows.map((row: Record<string, unknown>) => {
    if (resolution === "5min" || resolution === "hour") {
      return {
        t: row.t,
        pv: safeNumber(row.pv_power),
        load: safeNumber(row.load_power),
        bat: safeNumber(row.battery_power),
        grid: safeNumber(row.grid_power_kw),
        soc: safeNumber(row.battery_soc),
        gridImport: safeNumber(row.grid_import_kwh),
        gridExport: safeNumber(row.grid_export_kwh),
      };
    }
    // day / month resolution
    return {
      t: row.t,
      pvTotal: safeNumber(row.pv_total),
      loadTotal: safeNumber(row.load_total),
      gridImport: safeNumber(row.grid_import),
      gridExport: safeNumber(row.grid_export),
      charge: safeNumber(row.charge),
      discharge: safeNumber(row.discharge),
      ...(resolution === "day" ? { avgSoc: safeNumber(row.avg_soc) } : {}),
    };
  });

  // Build summary
  const summaryRow = (summaryResult.rows[0] ?? {}) as Record<string, unknown>;
  const pvTotal = safeNumber(summaryRow.pv_total) ?? 0;
  const loadTotal = safeNumber(summaryRow.load_total) ?? 0;
  const gridImport = safeNumber(summaryRow.grid_import_total) ?? 0;
  const gridExport = safeNumber(summaryRow.grid_export_total) ?? 0;
  const peakDemand = safeNumber(summaryRow.peak_demand) ?? 0;

  const selfConsumption =
    pvTotal > 0
      ? Math.round(((pvTotal - gridExport) / pvTotal) * 1000) / 10
      : null;

  const selfSufficiency =
    loadTotal > 0
      ? Math.round(((loadTotal - gridImport) / loadTotal) * 1000) / 10
      : null;

  // Savings calculation
  const tariffRow = (tariffResult.rows[0] ?? null) as Record<
    string,
    unknown
  > | null;
  let savings: number | null = null;

  if (tariffRow) {
    const schedule: TariffSchedule = {
      peakRate: parseFloat(String(tariffRow.peak_rate)),
      offpeakRate: parseFloat(String(tariffRow.offpeak_rate)),
      intermediateRate: parseFloat(String(tariffRow.intermediate_rate)),
    };
    const feedInRate = parseFloat(String(tariffRow.feed_in_rate ?? 0));

    let hypotheticalBill = 0;
    let actualBill = 0;

    for (const row of rawResult.rows) {
      const r = row as Record<string, unknown>;
      const recordedAt = new Date(r.recorded_at as string);
      // BRT = UTC-3
      const brtHour = (recordedAt.getUTCHours() - 3 + 24) % 24;
      const rate = getRateForHour(brtHour, schedule);
      const loadPower = parseFloat(String(r.load_power ?? 0));
      const importKwh = parseFloat(String(r.grid_import_kwh ?? 0));
      const exportKwh = parseFloat(String(r.grid_export_kwh ?? 0));

      hypotheticalBill += (loadPower / 12) * rate;
      actualBill += importKwh * rate - exportKwh * feedInRate;
    }

    savings = Math.round((hypotheticalBill - actualBill) * 100) / 100;
  }

  const body = ok({
    points,
    summary: {
      pvTotal: round2(pvTotal),
      loadTotal: round2(loadTotal),
      gridImport: round2(gridImport),
      gridExport: round2(gridExport),
      selfConsumption,
      selfSufficiency,
      peakDemand: round2(peakDemand),
      savings,
      currency: "BRL",
    },
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function buildTimeSeriesSQL(resolution: Resolution): string {
  switch (resolution) {
    case "5min":
      return `
        SELECT
          recorded_at AS t,
          pv_power,
          load_power,
          battery_power,
          grid_power_kw,
          battery_soc,
          grid_import_kwh,
          grid_export_kwh
        FROM telemetry_history
        WHERE asset_id = $1
          AND recorded_at >= $2
          AND recorded_at < $3
        ORDER BY recorded_at`;

    case "hour":
      return `
        SELECT
          date_trunc('hour', recorded_at AT TIME ZONE 'America/Sao_Paulo') AS t,
          AVG(pv_power) AS pv_power,
          AVG(load_power) AS load_power,
          AVG(battery_power) AS battery_power,
          AVG(grid_power_kw) AS grid_power_kw,
          AVG(battery_soc) AS battery_soc,
          SUM(grid_import_kwh) AS grid_import_kwh,
          SUM(grid_export_kwh) AS grid_export_kwh
        FROM telemetry_history
        WHERE asset_id = $1
          AND recorded_at >= $2
          AND recorded_at < $3
        GROUP BY t
        ORDER BY t`;

    case "day":
      return `
        SELECT
          date_trunc('day', recorded_at AT TIME ZONE 'America/Sao_Paulo') AS t,
          MAX(pv_daily_energy_kwh) AS pv_total,
          SUM(load_power) / 12 AS load_total,
          SUM(grid_import_kwh) AS grid_import,
          SUM(grid_export_kwh) AS grid_export,
          MAX(daily_charge_kwh) AS charge,
          MAX(daily_discharge_kwh) AS discharge,
          AVG(battery_soc) AS avg_soc
        FROM telemetry_history
        WHERE asset_id = $1
          AND recorded_at >= $2
          AND recorded_at < $3
        GROUP BY t
        ORDER BY t`;

    case "month":
      return `
        SELECT
          date_trunc('month', sub.day) AS t,
          SUM(sub.day_pv) AS pv_total,
          SUM(sub.day_load) AS load_total,
          SUM(sub.day_grid_import) AS grid_import,
          SUM(sub.day_grid_export) AS grid_export,
          SUM(sub.day_charge) AS charge,
          SUM(sub.day_discharge) AS discharge
        FROM (
          SELECT
            date_trunc('day', recorded_at AT TIME ZONE 'America/Sao_Paulo') AS day,
            MAX(pv_daily_energy_kwh) AS day_pv,
            SUM(load_power) / 12 AS day_load,
            SUM(grid_import_kwh) AS day_grid_import,
            SUM(grid_export_kwh) AS day_grid_export,
            MAX(daily_charge_kwh) AS day_charge,
            MAX(daily_discharge_kwh) AS day_discharge
          FROM telemetry_history
          WHERE asset_id = $1
            AND recorded_at >= $2
            AND recorded_at < $3
          GROUP BY day
        ) sub
        GROUP BY date_trunc('month', sub.day)
        ORDER BY date_trunc('month', sub.day)`;
  }
}

function safeNumber(val: unknown): number | null {
  if (val == null) return null;
  const n = parseFloat(String(val));
  return isNaN(n) ? null : n;
}

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}
