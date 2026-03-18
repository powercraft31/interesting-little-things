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

const safeFloat = (val: unknown): number | null =>
  val != null ? parseFloat(String(val)) : null;

const safeBool = (val: unknown): boolean =>
  val === true || val === "true" || val === "t";

/**
 * GET /api/gateways/:gatewayId/detail
 * Gateway-level aggregated detail — merged device state, telemetry extras,
 * config defaults, schedule, and sub-device list.
 * Implements Fix #2 grid data priority: inverter > smart meter > null.
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

  // Extract gatewayId from path: /api/gateways/:gatewayId/detail
  const pathParts = event.rawPath.split("/");
  const gwIdx = pathParts.indexOf("gateways");
  const gatewayId = gwIdx >= 0 ? pathParts[gwIdx + 1] : "";

  if (!gatewayId) {
    return apiError(400, "gatewayId is required");
  }

  // ── 3 parallel queries (Q3 vpp_strategies skipped — table doesn't exist) ──
  const [q1Result, q2Result, q4Result] = await Promise.all([
    // Q1: Gateway info + all devices with device_state
    queryWithOrg(
      `SELECT
        g.gateway_id, g.name, g.status, g.last_seen_at,
        g.contracted_demand_kw, g.ems_health,
        a.asset_id, a.name AS device_name, a.asset_type,
        a.brand, a.model, a.serial_number,
        a.capacidade_kw, a.capacity_kwh, a.operation_mode, a.allow_export,
        a.rated_max_power_kw,
        ds.battery_soc, ds.bat_soh, ds.battery_voltage,
        ds.battery_power, ds.pv_power,
        ds.grid_power_kw, ds.load_power,
        ds.inverter_temp, ds.is_online, ds.updated_at
      FROM gateways g
      LEFT JOIN assets a ON a.gateway_id = g.gateway_id AND a.is_active = true
      LEFT JOIN device_state ds ON ds.asset_id = a.asset_id
      WHERE g.gateway_id = $1
      ORDER BY a.asset_type, a.name`,
      [gatewayId],
      rlsOrgId,
    ),

    // Q2: Latest telemetry extras (inverter priority, smart meter fallback)
    queryWithOrg(
      `SELECT th.telemetry_extra,
              th.battery_soh, th.battery_voltage, th.battery_current,
              th.battery_temperature, th.flload_power, th.inverter_temp,
              th.max_charge_current, th.max_discharge_current
       FROM telemetry_history th
       JOIN assets a ON a.asset_id = th.asset_id
       WHERE a.gateway_id = $1 AND a.is_active = true
       ORDER BY
         CASE a.asset_type WHEN 'INVERTER_BATTERY' THEN 1 ELSE 2 END,
         th.recorded_at DESC
       LIMIT 1`,
      [gatewayId],
      rlsOrgId,
    ),

    // Q4: Latest schedule from device_command_logs
    queryWithOrg(
      `SELECT id, payload_json, result, resolved_at, created_at
       FROM device_command_logs
       WHERE gateway_id = $1
         AND command_type = 'set'
         AND config_name = 'battery_schedule'
       ORDER BY created_at DESC
       LIMIT 1`,
      [gatewayId],
      rlsOrgId,
    ),
  ]);

  // ── Gateway base info ──
  if (q1Result.rows.length === 0) {
    return apiError(404, "Gateway not found");
  }

  const firstRow = q1Result.rows[0] as Record<string, unknown>;
  const emsHealthRaw = firstRow.ems_health as Record<string, unknown> | null;

  const gateway = {
    gatewayId: firstRow.gateway_id as string,
    name: firstRow.name as string,
    status: (firstRow.status as string) ?? "offline",
    lastSeenAt: firstRow.last_seen_at
      ? new Date(firstRow.last_seen_at as string).toISOString()
      : null,
    contractedDemandKw: safeFloat(firstRow.contracted_demand_kw),
    emsHealth: emsHealthRaw
      ? {
          cpuTemp: (emsHealthRaw.CPU_temp as string) ?? null,
          cpuUsage: (emsHealthRaw.CPU_usage as string) ?? null,
          memoryUsage: (emsHealthRaw.memory_usage as string) ?? null,
          diskUsage: (emsHealthRaw.disk_usage as string) ?? null,
          wifiSignalStrength:
            (emsHealthRaw.wifi_signal_strength as string) ?? null,
          systemRuntime: (emsHealthRaw.system_runtime as string) ?? null,
          simStatus: (emsHealthRaw.SIM_status as string) ?? null,
          emsTemp: (emsHealthRaw.ems_temp as string) ?? null,
        }
      : null,
  };

  // ── Group Q1 rows by asset_type ──
  const rows = q1Result.rows as Array<Record<string, unknown>>;
  const inverters = rows.filter(
    (r) => r.asset_type === "INVERTER_BATTERY" && r.asset_id,
  );
  const meters = rows.filter(
    (r) => r.asset_type === "SMART_METER" && r.asset_id,
  );

  // Primary inverter: first online, or first available
  const primary =
    inverters.find((r) => safeBool(r.is_online)) || inverters[0] || null;

  // ── Telemetry extras from Q2 ──
  const th = (q2Result.rows[0] ?? {}) as Record<string, unknown>;
  const extra = (th.telemetry_extra ?? {}) as Record<string, unknown>;

  // ── Build aggregated state from primary inverter ──
  const state = primary
    ? {
        batterySoc: safeFloat(primary.battery_soc),
        batSoh: safeFloat(th.battery_soh ?? primary.bat_soh),
        batteryVoltage: safeFloat(
          th.battery_voltage ?? primary.battery_voltage,
        ),
        batteryCurrent: safeFloat(th.battery_current),
        batteryTemperature: safeFloat(th.battery_temperature),
        batteryPower: safeFloat(primary.battery_power),
        pvPower: safeFloat(primary.pv_power),
        gridPowerKw: safeFloat(primary.grid_power_kw),
        loadPower: safeFloat(primary.load_power),
        flloadPower: safeFloat(th.flload_power),
        inverterTemp: safeFloat(th.inverter_temp ?? primary.inverter_temp),
        maxChargeCurrent: safeFloat(th.max_charge_current),
        maxDischargeCurrent: safeFloat(th.max_discharge_current),
        isOnline: safeBool(primary.is_online),
        updatedAt: primary.updated_at
          ? new Date(primary.updated_at as string).toISOString()
          : null,
      }
    : {
        batterySoc: null,
        batSoh: null,
        batteryVoltage: null,
        batteryCurrent: null,
        batteryTemperature: null,
        batteryPower: null,
        pvPower: null,
        gridPowerKw: null,
        loadPower: null,
        flloadPower: null,
        inverterTemp: null,
        maxChargeCurrent: null,
        maxDischargeCurrent: null,
        isOnline: false,
        updatedAt: null,
      };

  // ── Fix #2: Grid data priority — inverter > smart meter > null ──
  if (state.gridPowerKw == null && meters.length > 0) {
    const meter = meters.find((r) => safeBool(r.is_online)) || meters[0];
    if (meter) {
      state.gridPowerKw = safeFloat(meter.grid_power_kw);
    }
  }

  // ── Telemetry extra grid fields (same inverter > meter fallback via Q2 ORDER BY) ──
  const telemetryExtra = {
    gridVoltageR: safeFloat(extra.gridVoltageR ?? extra.grid_voltage_r),
    gridCurrentR: safeFloat(extra.gridCurrentR ?? extra.grid_current_r),
    gridPf: safeFloat(extra.gridPf ?? extra.grid_pf),
    totalBuyKwh: safeFloat(extra.totalBuyKwh ?? extra.total_buy_kwh),
    totalSellKwh: safeFloat(extra.totalSellKwh ?? extra.total_sell_kwh),
  };

  // ── Config defaults (Q3 skipped — vpp_strategies table doesn't exist) ──
  const primaryAsset = primary ?? ({} as Record<string, unknown>);
  const config = {
    socMin: 10,
    socMax: 100,
    maxChargeRateKw: safeFloat(primaryAsset.capacidade_kw),
    maxDischargeRateKw: safeFloat(primaryAsset.capacidade_kw),
    gridImportLimitKw: null as number | null,
    ratedMaxPowerKw: safeFloat(primaryAsset.rated_max_power_kw),
    defaults: { socMin: 10, socMax: 100, source: "hardcoded" },
  };

  // ── Sub-devices list ──
  const devices = rows
    .filter((r) => r.asset_id != null)
    .map((r) => ({
      assetId: r.asset_id as string,
      name: r.device_name as string,
      assetType: r.asset_type as string,
      brand: (r.brand as string) ?? null,
      model: (r.model as string) ?? null,
      serialNumber: (r.serial_number as string) ?? null,
      isOnline: safeBool(r.is_online),
    }));

  // ── Schedule from Q4 ──
  let schedule: {
    syncStatus: string;
    lastAckAt: string | null;
    slots: unknown[];
  };
  if (q4Result.rows.length === 0) {
    schedule = { syncStatus: "unknown", lastAckAt: null, slots: [] };
  } else {
    const cmd = q4Result.rows[0] as Record<string, unknown>;
    const result = cmd.result as string;
    const payload = cmd.payload_json as Record<string, unknown> | null;
    schedule = {
      syncStatus:
        result === "success"
          ? "synced"
          : result === "pending" ||
              result === "pending_dispatch" ||
              result === "dispatched" ||
              result === "accepted"
            ? "pending"
            : result === "failed" || result === "timeout"
              ? "failed"
              : "unknown",
      lastAckAt: cmd.resolved_at
        ? new Date(cmd.resolved_at as string).toISOString()
        : null,
      slots: (payload?.slots as unknown[]) ?? [],
    };
  }

  const body = ok({
    gateway,
    state,
    telemetryExtra,
    config,
    devices,
    schedule,
    _tenant: { orgId: ctx.orgId, role: ctx.role },
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
