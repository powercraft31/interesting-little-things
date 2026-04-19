import { Pool } from "pg";
import type { SolfacilMessage, SolfacilListItem } from "../../shared/types/solfacil-protocol";
import { parseTelemetryPayload } from "../services/fragment-assembler";
import { DeviceAssetCache } from "../services/device-asset-cache";
import { parseProtocolTimestamp } from "../../shared/protocol-time";
import { parseRuntimeFlags } from "../../shared/runtime/flags";
import { emitIngestParserFailed } from "../../shared/runtime/ingest-emitters";

/**
 * BackfillAssembler — Accumulates fragmented backfill messages per clientId.
 *
 * Backfill data arrives as 4 fragments per timestamp (no emsList):
 *   MSG#1: dido
 *   MSG#2: meterList (single-phase)
 *   MSG#3: meterList (three-phase)
 *   MSG#4: batList+gridList+pvList+loadList+flloadList (core)
 *
 * Same accumulation pattern as live FragmentAssembler:
 *   - Core (batList) arrives → immediate flush
 *   - 3s debounce timeout → flush partial
 *
 * Differences from live path:
 *   ⛔ No pg_notify('telemetry_update') — no SSE storm from historical data
 *   ⛔ No updateDeviceState() — historical data ≠ current state
 *   ⛔ No emsList processing — backfill doesn't send it
 *   INSERT uses ON CONFLICT (asset_id, recorded_at) DO NOTHING — dedup guarantee
 */

interface BackfillAccumulator {
  readonly clientId: string;
  readonly recordedAt: Date;
  dido?: {
    readonly do: ReadonlyArray<{
      id: string;
      type: string;
      value: string;
      gpionum?: string;
    }>;
    readonly di?: ReadonlyArray<{
      id: string;
      type: string;
      value: string;
      gpionum?: string;
    }>;
  };
  meters: SolfacilListItem[];
  core?: Record<string, unknown>;
  timer: NodeJS.Timeout | null;
}

const BACKFILL_INSERT_SQL = `INSERT INTO telemetry_history (
  asset_id, recorded_at, battery_soc, battery_power, pv_power,
  grid_power_kw, load_power, grid_import_kwh, grid_export_kwh,
  battery_soh, battery_voltage, battery_current, battery_temperature,
  do0_active, do1_active,
  flload_power, inverter_temp, pv_daily_energy_kwh,
  max_charge_current, max_discharge_current,
  daily_charge_kwh, daily_discharge_kwh,
  telemetry_extra
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
ON CONFLICT (asset_id, recorded_at) DO NOTHING`;

/** Shared cache instance per pool (same pattern as FragmentAssembler). */
const cacheMap = new WeakMap<Pool, DeviceAssetCache>();

function getCache(pool: Pool): DeviceAssetCache {
  let cache = cacheMap.get(pool);
  if (!cache) {
    cache = new DeviceAssetCache(pool);
    cacheMap.set(pool, cache);
  }
  return cache;
}

class BackfillAssembler {
  private readonly accumulators = new Map<string, BackfillAccumulator>();
  private readonly debounceMs: number = 3000;

  constructor(
    private readonly pool: Pool,
  ) {}

  receive(clientId: string, gatewayId: string, payload: SolfacilMessage): void {
    const data = payload.data;
    if (!data || Object.keys(data).length === 0) {
      console.log(`[BackfillAssembler] Empty backfill response from ${gatewayId}`);
      return;
    }

    let recordedAt: Date;
    try {
      recordedAt = parseProtocolTimestamp(payload.timeStamp);
    } catch (err) {
      console.warn(`[BackfillAssembler] Invalid timeStamp "${payload.timeStamp}" for ${gatewayId}, skipping`);
      // WS5: runtime parser-failure fact — backfill fragment rejected.
      void emitIngestParserFailed(
        { flags: parseRuntimeFlags(process.env) },
        {
          parserId: "missed-data.protocol-timestamp",
          error: err instanceof Error ? err : new Error(String(err)),
          gatewayId,
          reason: "invalid_protocol_timestamp",
        },
      ).catch(() => {
        /* best-effort — backfill flow must not break on emitter failure */
      });
      return;
    }
    const acc = this.getOrCreateAccumulator(clientId, recordedAt);
    const isCoreMessage = this.classifyAndAccumulate(acc, data);

    if (isCoreMessage) {
      this.clearTimer(acc);
      this.flushAsync(clientId, gatewayId);
    } else {
      this.resetTimer(clientId, gatewayId, acc);
    }
  }

  destroy(): void {
    for (const [, acc] of this.accumulators) {
      this.clearTimer(acc);
    }
    this.accumulators.clear();
  }

  private classifyAndAccumulate(
    acc: BackfillAccumulator,
    data: Record<string, unknown>,
  ): boolean {
    let isCoreMessage = false;

    // No emsList handling — backfill doesn't send it

    if (data.dido) {
      acc.dido = data.dido as BackfillAccumulator["dido"];
    }

    if (data.meterList) {
      const meters = data.meterList as SolfacilListItem[];
      acc.meters = [...acc.meters, ...meters];
    }

    if (data.batList) {
      acc.core = data;
      isCoreMessage = true;
    }

    return isCoreMessage;
  }

  private getOrCreateAccumulator(
    clientId: string,
    recordedAt: Date,
  ): BackfillAccumulator {
    const existing = this.accumulators.get(clientId);
    if (existing) return existing;

    const acc: BackfillAccumulator = {
      clientId,
      recordedAt,
      meters: [],
      timer: null,
    };
    this.accumulators.set(clientId, acc);
    return acc;
  }

  private resetTimer(clientId: string, gatewayId: string, acc: BackfillAccumulator): void {
    this.clearTimer(acc);
    acc.timer = setTimeout(() => this.flushAsync(clientId, gatewayId), this.debounceMs);
  }

  private clearTimer(acc: BackfillAccumulator): void {
    if (acc.timer) {
      clearTimeout(acc.timer);
      acc.timer = null;
    }
  }

  private flushAsync(clientId: string, gatewayId: string): void {
    this.flush(clientId, gatewayId).catch((err) => {
      console.error(`[BackfillAssembler] Flush error for ${clientId}:`, err);
    });
  }

  private async flush(clientId: string, gatewayId: string): Promise<void> {
    const acc = this.accumulators.get(clientId);
    if (!acc) return;

    this.accumulators.delete(clientId);

    if (!acc.core) {
      console.warn(
        `[BackfillAssembler] ${clientId}: No core in backfill cycle. ` +
          `fragments: dido=${!!acc.dido}, meters=${acc.meters.length}`,
      );
      return;
    }

    const parsed = parseTelemetryPayload(
      clientId,
      acc.recordedAt,
      acc.core,
      acc.dido,
      acc.meters,
      undefined, // no ems for backfill
    );
    if (!parsed) return;

    const cache = getCache(this.pool);
    const assetId = await cache.resolve(parsed.deviceSn);
    if (!assetId) {
      console.warn(`[BackfillAssembler] Unknown device: ${parsed.deviceSn}`);
      return;
    }

    const t = parsed;
    const result = await this.pool.query(BACKFILL_INSERT_SQL, [
      assetId,
      t.recordedAt,
      t.batterySoc,
      t.batteryPowerKw,
      t.pvPowerKw,
      t.gridPowerKw,
      t.loadPowerKw,
      t.gridDailyBuyKwh,
      t.gridDailySellKwh,
      t.batterySoh || null,
      t.batteryVoltage || null,
      t.batteryCurrent || null,
      t.batteryTemperature || null,
      t.do0Active || null,
      t.do1Active || null,
      t.flloadPowerKw || null,
      t.inverterTemp || null,
      t.pvDailyEnergyKwh || null,
      t.maxChargeCurrent || null,
      t.maxDischargeCurrent || null,
      t.dailyChargeKwh || null,
      t.dailyDischargeKwh || null,
      t.telemetryExtra ? JSON.stringify(t.telemetryExtra) : null,
    ]);

    // ⛔ Do NOT call pg_notify('telemetry_update') — no SSE storm from historical data
    // ⛔ Do NOT call updateDeviceState() — historical data ≠ current state

    const inserted = result.rowCount ?? 0;
    console.log(
      `[BackfillAssembler] Backfill wrote ${inserted} rows for ${gatewayId}`,
    );
  }
}

/** Singleton BackfillAssembler per pool. */
const assemblerMap = new WeakMap<Pool, BackfillAssembler>();

function getBackfillAssembler(pool: Pool): BackfillAssembler {
  let assembler = assemblerMap.get(pool);
  if (!assembler) {
    assembler = new BackfillAssembler(pool);
    assemblerMap.set(pool, assembler);
  }
  return assembler;
}

/**
 * Handle `device/ems/{cid}/data/missed` messages.
 * Feeds into BackfillAssembler for fragment accumulation, then INSERT ON CONFLICT DO NOTHING.
 */
export async function handleMissedData(
  pool: Pool,
  gatewayId: string,
  clientId: string,
  payload: SolfacilMessage,
): Promise<void> {
  // V2.4: total/index tracking for backfill progress
  const total = typeof payload.data?.total === "number" ? payload.data.total : undefined;
  const index = typeof payload.data?.index === "number" ? payload.data.index : undefined;

  // Empty backfill response (total=0, index=0) -> early return
  if (total === 0 && index === 0) {
    console.log(`[MissedData] ${gatewayId}: empty backfill response (total=0, index=0)`);
    return;
  }

  // Progress logging
  if (total !== undefined && index !== undefined) {
    console.log(`[MissedData] ${gatewayId}: processing ${index}/${total}`);
  }

  const assembler = getBackfillAssembler(pool);
  assembler.receive(clientId, gatewayId, payload);
}
