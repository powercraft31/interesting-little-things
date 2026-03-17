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
 * GET /api/vpp/capacity
 * EP-11: Aggregated VPP capacity KPIs.
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
    `SELECT
       COALESCE(SUM(a.capacity_kwh), 0) AS total_capacity_kwh,
       COALESCE(SUM(a.capacity_kwh * COALESCE(ds.battery_soc, 0) / 100.0), 0) AS available_kwh,
       ROUND(COALESCE(AVG(ds.battery_soc), 0), 1) AS aggregate_soc,
       COALESCE(SUM(a.capacidade_kw), 0) AS max_discharge_kw,
       COALESCE(SUM(COALESCE(vs.max_charge_rate_kw, a.capacidade_kw * 0.8)), 0) AS max_charge_kw,
       COUNT(a.asset_id) FILTER (WHERE g.status = 'online')::int AS dispatchable_devices
     FROM assets a
     LEFT JOIN device_state ds ON a.asset_id = ds.asset_id
     LEFT JOIN gateways g ON a.gateway_id = g.gateway_id
     LEFT JOIN vpp_strategies vs ON a.org_id = vs.org_id AND vs.is_active = true AND vs.is_default = true
     WHERE a.is_active = true`,
    [],
    rlsOrgId,
  );

  const r = rows[0] as Record<string, unknown>;

  const body = ok({
    totalCapacityKwh:
      Math.round(parseFloat(String(r.total_capacity_kwh)) * 10) / 10,
    availableKwh: Math.round(parseFloat(String(r.available_kwh)) * 10) / 10,
    aggregateSoc: parseFloat(String(r.aggregate_soc)),
    maxDischargeKw:
      Math.round(parseFloat(String(r.max_discharge_kw)) * 10) / 10,
    maxChargeKw: Math.round(parseFloat(String(r.max_charge_kw)) * 10) / 10,
    dispatchableDevices: Number(r.dispatchable_devices),
    _tenant: { orgId: ctx.orgId, role: ctx.role },
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
