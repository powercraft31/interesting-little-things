/**
 * Mock Hardware Client — v5.9
 * Simulates battery inverters posting telemetry to the /api/telemetry/mock endpoint,
 * and polls dispatch_commands to simulate hardware ACK responses.
 *
 * Usage (standalone, does not affect main server):
 *   npx ts-node backend/scripts/mock-hardware-client.ts
 *
 * Effect:
 *   - Posts telemetry for 4 assets every 10 seconds
 *   - battery_soc drifts between 20-80% (random walk +-2%)
 *   - battery_power alternates charge/discharge based on hour of day
 *   - energy_kwh = abs(battery_power) * (10/3600)  [10s interval in hours]
 *   - Polls dispatch_commands every 5 seconds and ACKs with 90% success rate
 */

import { getPool } from "../src/shared/db";

const BASE_URL = process.env.BFF_URL ?? "http://localhost:3000";
const INTERVAL_MS = 10_000; // 10 seconds

const ASSET_IDS = [
  "ASSET_SP_001",
  "ASSET_RJ_002",
  "ASSET_MG_003",
  "ASSET_PR_004",
];

// Mutable state per asset — tracks SOC drift
const assetState: Record<string, { soc: number }> = {};
for (const id of ASSET_IDS) {
  assetState[id] = { soc: 50 + Math.random() * 20 }; // initial 50-70%
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function generateTelemetry(assetId: string): {
  asset_id: string;
  timestamp: string;
  battery_soc: number;
  battery_power: number;
  energy_kwh: number;
  pv_power: number;
  grid_power_kw: number;
  load_power: number;
} {
  const state = assetState[assetId];
  const hour = new Date().getHours();

  // Drift SOC by +-2%
  const drift = (Math.random() - 0.5) * 4; // -2 to +2
  state.soc = clamp(state.soc + drift, 20, 80);
  const soc = Math.round(state.soc * 10) / 10;

  // Charge during solar hours (6-16), discharge during peak (17-21), idle otherwise
  let batteryPower: number;
  if (hour >= 6 && hour < 16) {
    batteryPower = 2 + Math.random() * 3; // +2 to +5 kW (charging)
  } else if (hour >= 17 && hour < 21) {
    batteryPower = -(2 + Math.random() * 3); // -2 to -5 kW (discharging)
  } else {
    batteryPower = (Math.random() - 0.5) * 1; // -0.5 to +0.5 kW (idle)
  }
  batteryPower = Math.round(batteryPower * 100) / 100;

  // energy_kwh = abs(batteryPower) * (10s / 3600s)
  const energyKwh =
    Math.round(Math.abs(batteryPower) * (10 / 3600) * 10000) / 10000;
  // Sign matches battery_power: positive=charge, negative=discharge
  const signedEnergyKwh = batteryPower >= 0 ? energyKwh : -energyKwh;

  // Simulated PV (solar hours only)
  const pvPower =
    hour >= 6 && hour <= 18
      ? Math.round((3 + Math.random() * 5) * 100) / 100
      : 0;

  // Simulated grid & load
  const loadPower = Math.round((1 + Math.random() * 3) * 100) / 100;
  const gridPowerKw =
    Math.round((loadPower - pvPower - batteryPower) * 100) / 100;

  return {
    asset_id: assetId,
    timestamp: new Date().toISOString(),
    battery_soc: soc,
    battery_power: batteryPower,
    energy_kwh: signedEnergyKwh,
    pv_power: pvPower,
    grid_power_kw: gridPowerKw,
    load_power: loadPower,
  };
}

async function pushTelemetry(): Promise<void> {
  for (const assetId of ASSET_IDS) {
    const payload = generateTelemetry(assetId);
    try {
      const res = await fetch(`${BASE_URL}/api/telemetry/mock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (res.ok) {
        console.log(
          `[MockHW][${assetId}] SOC=${payload.battery_soc}% power=${payload.battery_power}kW energy=${payload.energy_kwh}kWh → ${res.status}`,
        );
      } else {
        console.error(`[MockHW][${assetId}] Error:`, json);
      }
    } catch (err) {
      console.error(`[MockHW][${assetId}] Fetch failed:`, err);
    }
  }
}

// ---------------------------------------------------------------------------
// v5.9: Dispatch poll-and-ACK loop
// ---------------------------------------------------------------------------

// In-memory lock: Set<number> (dispatch_commands.id is BIGSERIAL → number)
const inFlightDispatchIds = new Set<number>();
const pool = getPool();

async function pollAndAck(): Promise<void> {
  try {
    const { rows } = await pool.query<{
      id: number;
      asset_id: string;
      action: string;
      volume_kwh: number;
    }>(`
      SELECT id, asset_id, action, volume_kwh
      FROM dispatch_commands
      WHERE status = 'dispatched'
        AND dispatched_at > NOW() - INTERVAL '5 minutes'
    `);

    for (const cmd of rows) {
      const id = Number(cmd.id);
      if (inFlightDispatchIds.has(id)) continue; // already in-flight
      inFlightDispatchIds.add(id);

      const delay = 3000 + Math.random() * 7000; // 3-10 seconds
      setTimeout(async () => {
        const status = Math.random() < 0.9 ? "completed" : "failed";
        try {
          const res = await fetch(`${BASE_URL}/api/dispatch/ack`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              dispatch_id: id,
              status,
              asset_id: cmd.asset_id,
            }),
          });
          console.log(
            `[MockHW][ACK] dispatch_id=${id} asset=${cmd.asset_id} action=${cmd.action} → ${status} (HTTP ${res.status})`,
          );
        } catch (err) {
          console.error(`[MockHW][ACK] dispatch_id=${id} fetch failed:`, err);
        } finally {
          inFlightDispatchIds.delete(id);
        }
      }, delay);
    }
  } catch (err) {
    console.error("[MockHW][ACK] Poll failed:", err);
  }
}

// Start
console.log("[MockHW] Starting mock hardware client — pushing to", BASE_URL);
console.log(`  Telemetry interval: every ${INTERVAL_MS / 1000}s`);
console.log(`  Dispatch ACK poll: every 5s`);
console.log(`  Assets: ${ASSET_IDS.join(", ")}`);

// Push once immediately
void pushTelemetry();
void pollAndAck();

// Periodic push
setInterval(() => void pushTelemetry(), INTERVAL_MS);
setInterval(() => void pollAndAck(), 5000);
