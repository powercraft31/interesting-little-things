import { Pool } from "pg";

/**
 * In-memory cache mapping device serial numbers to asset IDs.
 * Refreshes every 5 minutes from the database.
 * Uses Service Pool (no JWT, no RLS).
 */
export class DeviceAssetCache {
  private cache = new Map<string, string>();
  private lastRefresh = 0;
  private readonly refreshIntervalMs = 5 * 60 * 1000;

  constructor(private readonly pool: Pool) {}

  async resolve(deviceSn: string): Promise<string | null> {
    if (Date.now() - this.lastRefresh > this.refreshIntervalMs) {
      await this.refresh();
    }
    // Direct match first
    const direct = this.cache.get(deviceSn);
    if (direct) return direct;
    // XuHeng protocol quirk: telemetry batList uses "battery_{deviceSn}"
    // but deviceList uses "{deviceSn}" without prefix. Strip and retry.
    if (deviceSn.startsWith("battery_")) {
      return this.cache.get(deviceSn.slice(8)) ?? null;
    }
    return null;
  }

  private async refresh(): Promise<void> {
    const result = await this.pool.query<{
      serial_number: string;
      asset_id: string;
    }>(
      `SELECT serial_number, asset_id FROM assets WHERE serial_number IS NOT NULL AND is_active = true`,
    );
    const newCache = new Map<string, string>();
    for (const row of result.rows) {
      newCache.set(row.serial_number, row.asset_id);
    }
    this.cache = newCache;
    this.lastRefresh = Date.now();
    console.log(`[DeviceAssetCache] Refreshed: ${newCache.size} mappings`);
  }
}
