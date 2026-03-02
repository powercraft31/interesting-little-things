// POST /api/telemetry/mock
// Accepts hardware telemetry, writes to telemetry_history + UPSERTs device_state
import { Pool } from "pg";
import type { Request, Response } from "express";

export interface TelemetryPayload {
  asset_id: string;
  timestamp: string; // ISO8601
  battery_soc: number; // 0-100 (%)
  battery_power: number; // kW, positive=charging, negative=discharging
  energy_kwh: number; // delta kWh this interval
  pv_power?: number;
  grid_power_kw?: number;
  load_power?: number;
}

function validatePayload(
  body: unknown,
): { valid: true; data: TelemetryPayload } | { valid: false; error: string } {
  const b = body as Record<string, unknown>;
  if (!b || typeof b !== "object") {
    return { valid: false, error: "Request body must be a JSON object" };
  }
  if (!b.asset_id || typeof b.asset_id !== "string") {
    return { valid: false, error: "Missing required field: asset_id" };
  }
  if (!b.timestamp || typeof b.timestamp !== "string") {
    return { valid: false, error: "Missing required field: timestamp" };
  }
  if (typeof b.battery_soc !== "number") {
    return { valid: false, error: "Missing required field: battery_soc" };
  }
  if (typeof b.energy_kwh !== "number") {
    return { valid: false, error: "Missing required field: energy_kwh" };
  }

  return {
    valid: true,
    data: {
      asset_id: b.asset_id as string,
      timestamp: b.timestamp as string,
      battery_soc: b.battery_soc as number,
      battery_power: (b.battery_power as number) ?? 0,
      energy_kwh: b.energy_kwh as number,
      pv_power: b.pv_power as number | undefined,
      grid_power_kw: b.grid_power_kw as number | undefined,
      load_power: b.load_power as number | undefined,
    },
  };
}

export function createTelemetryWebhookHandler(pool: Pool) {
  return async (req: Request, res: Response): Promise<void> => {
    const validation = validatePayload(req.body);
    if (!validation.valid) {
      res.status(400).json({ ok: false, error: validation.error });
      return;
    }

    const { data } = validation;

    try {
      // INSERT into telemetry_history
      await pool.query(
        `INSERT INTO telemetry_history
           (asset_id, recorded_at, battery_soc, battery_power, energy_kwh, pv_power, grid_power_kw, load_power)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          data.asset_id,
          data.timestamp,
          data.battery_soc,
          data.battery_power,
          data.energy_kwh,
          data.pv_power ?? null,
          data.grid_power_kw ?? null,
          data.load_power ?? null,
        ],
      );

      // UPSERT device_state
      await pool.query(
        `INSERT INTO device_state (asset_id, battery_soc, battery_power, is_online, updated_at)
         VALUES ($1, $2, $3, true, NOW())
         ON CONFLICT (asset_id) DO UPDATE SET
           battery_soc    = EXCLUDED.battery_soc,
           battery_power  = EXCLUDED.battery_power,
           is_online      = true,
           updated_at     = NOW()`,
        [data.asset_id, data.battery_soc, data.battery_power],
      );

      res.status(201).json({ ok: true, asset_id: data.asset_id });
    } catch (err) {
      console.error("[TelemetryWebhook] Error:", err);
      res.status(500).json({ ok: false, error: "Internal server error" });
    }
  };
}
