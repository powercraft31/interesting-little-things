import { Pool } from "pg";
import { runHourlyAggregation } from "../../src/iot-hub/services/telemetry-aggregator";

jest.mock("node-cron", () => ({
  schedule: jest.fn(),
}));

describe("telemetry-aggregator (hourly rollup — v5.13 enhanced)", () => {
  let mockQuery: jest.Mock;
  let pool: Pool;

  beforeEach(() => {
    mockQuery = jest.fn();
    pool = { query: mockQuery } as unknown as Pool;
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("queries telemetry_history and UPSERTs into asset_hourly_metrics with all v5.13 columns", async () => {
    // First call: SELECT from telemetry_history (v5.13 enhanced with 6 new columns)
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          asset_id: "ASSET_SP_001",
          charge: "5.5000",
          discharge: "2.3000",
          pv_generation: "3.2000",
          grid_import: "1.5000",
          grid_export: "0.8000",
          load_consumption: "4.0000",
          avg_soc: "72.5",
          peak_bat_power: "5.5",
          count: "12",
        },
        {
          asset_id: "ASSET_RJ_002",
          charge: "0.0000",
          discharge: "8.1000",
          pv_generation: "0.0000",
          grid_import: "2.0000",
          grid_export: "0.0000",
          load_consumption: "6.1000",
          avg_soc: "45.0",
          peak_bat_power: "8.1",
          count: "8",
        },
      ],
    });
    // Subsequent calls: UPSERT into asset_hourly_metrics (one per asset)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    await runHourlyAggregation(pool);

    // First query is the SELECT
    expect(mockQuery).toHaveBeenCalledTimes(3); // 1 SELECT + 2 UPSERTs

    const selectCall = mockQuery.mock.calls[0];
    expect(selectCall[0]).toContain("FROM telemetry_history");
    expect(selectCall[0]).toContain("battery_power > 0");
    expect(selectCall[0]).toContain("pv_power");
    expect(selectCall[0]).toContain("grid_power_kw");
    expect(selectCall[0]).toContain("load_power");

    // First UPSERT: ASSET_SP_001 — verify all 11 params
    const upsert1 = mockQuery.mock.calls[1];
    expect(upsert1[0]).toContain("INSERT INTO asset_hourly_metrics");
    expect(upsert1[0]).toContain("ON CONFLICT");
    expect(upsert1[0]).toContain("pv_generation_kwh");
    expect(upsert1[0]).toContain("grid_import_kwh");
    expect(upsert1[0]).toContain("grid_export_kwh");
    expect(upsert1[0]).toContain("load_consumption_kwh");
    expect(upsert1[0]).toContain("avg_battery_soc");
    expect(upsert1[0]).toContain("peak_battery_power_kw");

    expect(upsert1[1][0]).toBe("ASSET_SP_001");      // asset_id
    expect(upsert1[1][2]).toBeCloseTo(5.5);            // total_charge_kwh
    expect(upsert1[1][3]).toBeCloseTo(2.3);            // total_discharge_kwh
    expect(upsert1[1][4]).toBeCloseTo(3.2);            // pv_generation_kwh
    expect(upsert1[1][5]).toBeCloseTo(1.5);            // grid_import_kwh
    expect(upsert1[1][6]).toBeCloseTo(0.8);            // grid_export_kwh
    expect(upsert1[1][7]).toBeCloseTo(4.0);            // load_consumption_kwh
    expect(upsert1[1][8]).toBeCloseTo(72.5);           // avg_battery_soc
    expect(upsert1[1][9]).toBeCloseTo(5.5);            // peak_battery_power_kw
    expect(upsert1[1][10]).toBe(12);                    // data_points_count

    // Second UPSERT: ASSET_RJ_002
    const upsert2 = mockQuery.mock.calls[2];
    expect(upsert2[1][0]).toBe("ASSET_RJ_002");
    expect(upsert2[1][2]).toBeCloseTo(0);               // no charge
    expect(upsert2[1][3]).toBeCloseTo(8.1);             // discharge
    expect(upsert2[1][10]).toBe(8);
  });

  it("handles empty telemetry_history gracefully (no assets to aggregate)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await runHourlyAggregation(pool);

    // Only the SELECT query, no UPSERTs
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("logs error and does not throw when query fails", async () => {
    mockQuery.mockRejectedValueOnce(new Error("connection timeout"));

    await expect(runHourlyAggregation(pool)).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith(
      "[TelemetryAggregator] Error:",
      expect.any(Error),
    );
  });
});
