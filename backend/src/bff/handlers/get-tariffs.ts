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
 * GET /api/tariffs
 * EP-N7: Read latest tariff schedule.
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

  const { rows } = await queryWithOrg(
    `SELECT COALESCE(disco, schedule_name) AS disco,
            peak_rate, offpeak_rate,
            COALESCE(intermediate_rate, (peak_rate + offpeak_rate) / 2.0) AS intermediate_rate,
            feed_in_rate,
            peak_start, peak_end,
            COALESCE(intermediate_start, peak_start - INTERVAL '1 hour') AS intermediate_start,
            COALESCE(intermediate_end, peak_end + INTERVAL '1 hour') AS intermediate_end,
            effective_from,
            demand_charge_rate_per_kva,
            billing_power_factor
     FROM tariff_schedules
     ORDER BY effective_from DESC
     LIMIT 1`,
    [],
    rlsOrgId,
  );

  if (rows.length === 0) {
    const body = ok({});
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    };
  }

  const r = rows[0] as Record<string, unknown>;

  const safeFloat = (val: unknown): number | null =>
    val != null ? parseFloat(String(val)) : null;

  const body = ok({
    disco: r.disco as string,
    peakRate: safeFloat(r.peak_rate),
    intermediateRate: safeFloat(r.intermediate_rate),
    offPeakRate: safeFloat(r.offpeak_rate),
    feedInRate: safeFloat(r.feed_in_rate),
    peakStart: r.peak_start ? String(r.peak_start).slice(0, 5) : null,
    peakEnd: r.peak_end ? String(r.peak_end).slice(0, 5) : null,
    intermediateStart: r.intermediate_start ? String(r.intermediate_start).slice(0, 5) : null,
    intermediateEnd: r.intermediate_end ? String(r.intermediate_end).slice(0, 5) : null,
    effectiveFrom: r.effective_from
      ? new Date(r.effective_from as string).toISOString().slice(0, 10)
      : null,
    demandChargeRate: safeFloat(r.demand_charge_rate_per_kva),
    billingPowerFactor: safeFloat(r.billing_power_factor),
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
