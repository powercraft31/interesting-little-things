import { Pool } from "pg";
import type { ParsedTelemetry } from "../../shared/types/telemetry";

/**
 * Buffers parsed telemetry by assetId, flushing to DB after debounce interval.
 * Prevents duplicate writes when multiple messages arrive within the window.
 * Uses latest values per asset (last-write-wins within buffer window).
 */
export class MessageBuffer {
  private buffer = new Map<
    string,
    { assetId: string; telemetry: ParsedTelemetry; timer: NodeJS.Timeout }
  >();

  constructor(
    private readonly pool: Pool,
    private readonly debounceMs: number = 2000,
  ) {}

  enqueue(assetId: string, telemetry: ParsedTelemetry): void {
    const existing = this.buffer.get(assetId);
    if (existing) {
      clearTimeout(existing.timer);
    }

    const timer = setTimeout(() => this.flushOne(assetId), this.debounceMs);
    this.buffer.set(assetId, { assetId, telemetry, timer });
  }

  private async flushOne(assetId: string): Promise<void> {
    const entry = this.buffer.get(assetId);
    if (!entry) return;
    this.buffer.delete(assetId);

    const t = entry.telemetry;
    try {
      await this.pool.query(
        `INSERT INTO telemetry_history
           (asset_id, recorded_at, battery_soc, battery_power, pv_power,
            grid_power_kw, load_power, grid_import_kwh, grid_export_kwh,
            battery_soh, battery_voltage, battery_current, battery_temperature,
            do0_active, do1_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          assetId,
          t.recordedAt,
          t.batterySoc,
          t.batteryPowerKw,
          t.pvPowerKw,
          t.gridPowerKw,
          t.loadPowerKw,
          t.gridDailyBuyKwh,
          t.gridDailySellKwh,
          // v5.14: store NULL if BMS doesn't report (0 -> NULL for physical state)
          t.batterySoh || null,
          t.batteryVoltage || null,
          t.batteryCurrent || null,
          t.batteryTemperature || null,
          // v5.16: DO relay states
          t.do0Active || null,
          t.do1Active || null,
        ],
      );
    } catch (err) {
      console.error(`[MessageBuffer] Write error for ${assetId}:`, err);
    }
  }

  /** Flush all pending entries immediately (for graceful shutdown). */
  flush(): void {
    for (const [assetId] of this.buffer) {
      this.flushOne(assetId);
    }
  }
}
