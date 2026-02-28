import type { Request, Response } from "express";
import { getPool } from "../../shared/db";

function getWebhookSecret(): string {
  return process.env.WEBHOOK_SECRET ?? "dev-secret-2026";
}

export interface WeatherPayload {
  location: string; // e.g. 'SP', 'RJ'
  forecast_time: string; // ISO 8601, e.g. '2026-02-28T17:00:00-03:00'
  temperature_c: number;
  irradiance_w_m2: number;
  cloud_cover_pct: number;
  source?: string; // e.g. 'mock-weather-publisher'
}

export async function handleWeatherWebhook(
  req: Request,
  res: Response,
): Promise<void> {
  // 1. Verify secret
  const secret = req.headers["x-webhook-secret"];
  if (secret !== getWebhookSecret()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // 2. Parse payload
  const payload = req.body as WeatherPayload;
  if (
    !payload.location ||
    !payload.forecast_time ||
    payload.temperature_c == null ||
    payload.irradiance_w_m2 == null
  ) {
    res.status(400).json({ error: "Invalid payload" });
    return;
  }

  // 3. UPSERT weather_cache
  try {
    const pool = getPool();
    await pool.query(
      `
      INSERT INTO weather_cache (location, recorded_at, temperature, irradiance, cloud_cover, source)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (location, recorded_at)
      DO UPDATE SET
        temperature = EXCLUDED.temperature,
        irradiance  = EXCLUDED.irradiance,
        cloud_cover = EXCLUDED.cloud_cover,
        source      = EXCLUDED.source
    `,
      [
        payload.location,
        new Date(payload.forecast_time),
        payload.temperature_c,
        payload.irradiance_w_m2,
        payload.cloud_cover_pct ?? null,
        payload.source ?? "webhook",
      ],
    );

    res.status(200).json({
      status: "accepted",
      rows_upserted: 1,
      detail: `weather_cache updated: ${payload.location} at ${payload.forecast_time}`,
    });
  } catch (err) {
    console.error("[weather-webhook] DB error:", err);
    res.status(500).json({ error: "Database error" });
  }
}
