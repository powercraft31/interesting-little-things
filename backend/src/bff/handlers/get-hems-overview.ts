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
 * GET /api/hems/overview
 * EP-9: Mode distribution + tarifa rates + last dispatch.
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

  const [modeResult, tarifaResult, dispatchResult] = await Promise.all([
    // Mode distribution
    queryWithOrg(
      `SELECT
         a.operation_mode,
         COUNT(a.asset_id)::int AS device_count
       FROM assets a
       WHERE a.is_active = true AND a.operation_mode IS NOT NULL
       GROUP BY a.operation_mode`,
      [],
      rlsOrgId,
    ),
    // Tarifa rates
    queryWithOrg(
      `SELECT
         COALESCE(disco, schedule_name) AS disco,
         peak_rate AS peak,
         offpeak_rate AS off_peak,
         COALESCE(intermediate_rate, (peak_rate + offpeak_rate) / 2.0) AS intermediate,
         feed_in_rate AS feed_in,
         effective_from AS effective_date,
         peak_start,
         peak_end,
         intermediate_start,
         intermediate_end
       FROM tariff_schedules
       ORDER BY effective_from DESC
       LIMIT 1`,
      [],
      rlsOrgId,
    ),
    // Last dispatch batch
    queryWithOrg(
      `SELECT
         dc.dispatched_at AS timestamp,
         dc.action AS to_mode,
         dc.status,
         dc.asset_id,
         dc.completed_at
       FROM dispatch_commands dc
       ORDER BY dc.dispatched_at DESC
       LIMIT 20`,
      [],
      rlsOrgId,
    ),
  ]);

  // Mode distribution
  const modeDistribution: Record<string, number> = {
    self_consumption: 0,
    peak_valley_arbitrage: 0,
    peak_shaving: 0,
  };
  for (const r of modeResult.rows) {
    const row = r as Record<string, unknown>;
    const mode = row.operation_mode as string;
    if (mode in modeDistribution) {
      modeDistribution[mode] = Number(row.device_count);
    }
  }

  // Tarifa rates
  const tarifa = tarifaResult.rows[0] as Record<string, unknown> | undefined;
  const tarifaRates = tarifa
    ? {
        disco: tarifa.disco as string,
        peak: parseFloat(String(tarifa.peak)),
        intermediate: parseFloat(String(tarifa.intermediate)),
        offPeak: parseFloat(String(tarifa.off_peak)),
        effectiveDate: tarifa.effective_date
          ? new Date(tarifa.effective_date as string).toISOString().slice(0, 10)
          : null,
        peakHours: `${String(tarifa.peak_start ?? "17:00").slice(0, 5)}-${String(tarifa.peak_end ?? "22:00").slice(0, 5)}`,
        intermediateHours: tarifa.intermediate_start
          ? `${String(tarifa.intermediate_start).slice(0, 5)}-${String(tarifa.intermediate_end).slice(0, 5)}`
          : null,
      }
    : null;

  // Last dispatch
  const dispatchRows = dispatchResult.rows as Array<Record<string, unknown>>;
  const lastDispatch =
    dispatchRows.length > 0
      ? {
          timestamp: new Date(dispatchRows[0].timestamp as string).toISOString(),
          toMode: dispatchRows[0].to_mode as string,
          affectedDevices: dispatchRows.length,
          successRate:
            dispatchRows.length > 0
              ? Math.round(
                  (100 * dispatchRows.filter((r) => r.status === "completed").length) /
                    dispatchRows.length,
                )
              : 0,
        }
      : null;

  const body = ok({
    modeDistribution,
    tarifaRates,
    lastDispatch,
    _tenant: { orgId: ctx.orgId, role: ctx.role },
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
