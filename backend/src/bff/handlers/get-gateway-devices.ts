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
 * GET /api/gateways/:gatewayId/devices
 * EP-N2: Device list under a specific gateway with device_state telemetry.
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

  // Extract gatewayId from path: /api/gateways/:gatewayId/devices
  const pathParts = event.rawPath.split("/");
  const gatewaysIdx = pathParts.indexOf("gateways");
  const gatewayId = gatewaysIdx >= 0 ? pathParts[gatewaysIdx + 1] : "";

  if (!gatewayId) {
    return apiError(400, "gatewayId is required");
  }

  // Fetch gateway info
  const gwResult = await queryWithOrg(
    `SELECT g.gateway_id, g.name, g.status
     FROM gateways g
     WHERE g.gateway_id = $1`,
    [gatewayId],
    rlsOrgId,
  );

  if (gwResult.rows.length === 0) {
    return apiError(404, "Gateway not found");
  }

  const gw = gwResult.rows[0] as Record<string, unknown>;

  // Fetch devices under this gateway
  const { rows } = await queryWithOrg(
    `SELECT a.asset_id, a.name, a.asset_type, a.brand, a.model, a.serial_number,
            a.capacidade_kw, a.capacity_kwh, a.operation_mode, a.allow_export, a.is_active,
            ds.battery_soc, ds.battery_power, ds.pv_power, ds.grid_power_kw,
            ds.load_power, ds.inverter_temp, ds.bat_soh,
            ds.telemetry_json, ds.is_online
     FROM assets a
     LEFT JOIN device_state ds ON a.asset_id = ds.asset_id
     WHERE a.gateway_id = $1 AND a.is_active = true
     ORDER BY a.asset_type, a.name`,
    [gatewayId],
    rlsOrgId,
  );

  const devices = rows.map((r: Record<string, unknown>) => {
    const telemetryJson = r.telemetry_json as Record<string, unknown> | null;
    return {
      assetId: r.asset_id as string,
      name: r.name as string,
      assetType: r.asset_type as string,
      brand: r.brand as string,
      model: r.model as string,
      serialNumber: r.serial_number as string | null,
      capacidadeKw: r.capacidade_kw != null ? parseFloat(String(r.capacidade_kw)) : null,
      capacityKwh: r.capacity_kwh != null ? parseFloat(String(r.capacity_kwh)) : null,
      operationMode: r.operation_mode as string | null,
      allowExport: r.allow_export as boolean | null,
      isActive: r.is_active as boolean,
      state: {
        batterySoc: r.battery_soc != null ? parseFloat(String(r.battery_soc)) : null,
        batteryPower: r.battery_power != null ? parseFloat(String(r.battery_power)) : null,
        pvPower: r.pv_power != null ? parseFloat(String(r.pv_power)) : null,
        gridPowerKw: r.grid_power_kw != null ? parseFloat(String(r.grid_power_kw)) : null,
        loadPower: r.load_power != null ? parseFloat(String(r.load_power)) : null,
        inverterTemp: r.inverter_temp != null ? parseFloat(String(r.inverter_temp)) : null,
        batSoh: r.bat_soh != null ? parseFloat(String(r.bat_soh)) : null,
        batteryTemperature: telemetryJson?.batteryTemperature != null
          ? parseFloat(String(telemetryJson.batteryTemperature)) : null,
        isOnline: r.is_online as boolean ?? false,
      },
    };
  });

  const body = ok({
    gateway: {
      gatewayId: gw.gateway_id as string,
      name: gw.name as string,
      status: (gw.status as string) ?? "offline",
    },
    devices,
    _tenant: { orgId: ctx.orgId, role: ctx.role },
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
