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
 * GET /api/devices/:assetId
 * EP-N3: Full device detail — asset info, device_state, telemetry_history (latest), config defaults.
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

  // Extract assetId from path: /api/devices/:assetId
  const pathParts = event.rawPath.split("/");
  const devicesIdx = pathParts.indexOf("devices");
  const assetId = devicesIdx >= 0 ? pathParts[devicesIdx + 1] : "";

  if (!assetId) {
    return apiError(400, "assetId is required");
  }

  // Q1: Asset + gateway info
  const assetResult = await queryWithOrg(
    `SELECT a.asset_id, a.name, a.asset_type, a.brand, a.model, a.serial_number,
            a.capacidade_kw, a.capacity_kwh, a.operation_mode, a.allow_export,
            a.retail_buy_rate_kwh, a.retail_sell_rate_kwh,
            g.gateway_id, g.name AS gateway_name, g.status AS gateway_status
     FROM assets a
     JOIN gateways g ON a.gateway_id = g.gateway_id
     WHERE a.asset_id = $1`,
    [assetId],
    rlsOrgId,
  );

  if (assetResult.rows.length === 0) {
    return apiError(404, "Device not found");
  }

  const asset = assetResult.rows[0] as Record<string, unknown>;

  // Q2, Q3, Q4 in parallel
  const [stateResult, historyResult, strategyResult] = await Promise.all([
    queryWithOrg(
      `SELECT ds.*
       FROM device_state ds
       WHERE ds.asset_id = $1`,
      [assetId],
      rlsOrgId,
    ),
    queryWithOrg(
      `SELECT th.battery_soh, th.battery_voltage, th.battery_current,
              th.battery_temperature, th.flload_power, th.inverter_temp,
              th.max_charge_current, th.max_discharge_current,
              th.telemetry_extra
       FROM telemetry_history th
       WHERE th.asset_id = $1
       ORDER BY th.recorded_at DESC LIMIT 1`,
      [assetId],
      rlsOrgId,
    ),
    queryWithOrg(
      `SELECT min_soc, max_soc, max_charge_rate_kw
       FROM vpp_strategies
       WHERE org_id = $1 AND is_active = true AND is_default = true
       LIMIT 1`,
      [ctx.orgId],
      rlsOrgId,
    ),
  ]);

  const ds = (stateResult.rows[0] ?? {}) as Record<string, unknown>;
  const th = (historyResult.rows[0] ?? {}) as Record<string, unknown>;
  const vs = (strategyResult.rows[0] ?? {}) as Record<string, unknown>;
  const extra = (th.telemetry_extra ?? {}) as Record<string, unknown>;
  const gridExtra = (extra.grid ?? {}) as Record<string, unknown>;

  const safeFloat = (val: unknown): number | null =>
    val != null ? parseFloat(String(val)) : null;

  const body = ok({
    device: {
      assetId: asset.asset_id as string,
      name: asset.name as string,
      assetType: asset.asset_type as string,
      brand: asset.brand as string,
      model: asset.model as string,
      serialNumber: asset.serial_number as string | null,
      capacidadeKw: safeFloat(asset.capacidade_kw),
      capacityKwh: safeFloat(asset.capacity_kwh),
      operationMode: asset.operation_mode as string | null,
      allowExport: asset.allow_export as boolean | null,
      retailBuyRateKwh: safeFloat(asset.retail_buy_rate_kwh),
      retailSellRateKwh: safeFloat(asset.retail_sell_rate_kwh),
      gatewayId: asset.gateway_id as string,
      gatewayName: asset.gateway_name as string,
      gatewayStatus: (asset.gateway_status as string) ?? "offline",
    },
    state: {
      batterySoc: safeFloat(ds.battery_soc),
      batSoh: safeFloat(th.battery_soh ?? ds.bat_soh),
      batteryVoltage: safeFloat(th.battery_voltage),
      batteryCurrent: safeFloat(th.battery_current),
      batteryTemperature: safeFloat(th.battery_temperature),
      batteryPower: safeFloat(ds.battery_power),
      pvPower: safeFloat(ds.pv_power),
      gridPowerKw: safeFloat(ds.grid_power_kw),
      loadPower: safeFloat(ds.load_power),
      flloadPower: safeFloat(th.flload_power),
      inverterTemp: safeFloat(th.inverter_temp ?? ds.inverter_temp),
      maxChargeCurrent: safeFloat(th.max_charge_current),
      maxDischargeCurrent: safeFloat(th.max_discharge_current),
      isOnline: (ds.is_online as boolean) ?? false,
      updatedAt: ds.updated_at ? new Date(ds.updated_at as string).toISOString() : null,
    },
    telemetryExtra: {
      gridVoltageR: safeFloat(gridExtra.volt_a),
      gridCurrentR: safeFloat(gridExtra.current_a),
      gridPf:       safeFloat(gridExtra.factor_a),
      totalBuyKwh:  safeFloat(gridExtra.total_buy_kwh),
      totalSellKwh: safeFloat(gridExtra.total_sell_kwh),
    },
    config: {
      socMin: safeFloat(ds.soc_min) ?? safeFloat(vs.min_soc) ?? 20,
      socMax: safeFloat(ds.soc_max) ?? safeFloat(vs.max_soc) ?? 95,
      maxChargeRateKw: safeFloat(vs.max_charge_rate_kw) ?? safeFloat(asset.capacidade_kw),
      maxDischargeRateKw: safeFloat(asset.capacidade_kw),
      gridImportLimitKw: null,
      defaults: {
        socMin: safeFloat(vs.min_soc) ?? 20,
        socMax: safeFloat(vs.max_soc) ?? 95,
        source: "vpp_strategies",
      },
    },
    _tenant: { orgId: ctx.orgId, role: ctx.role },
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
