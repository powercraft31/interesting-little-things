import { Pool } from "pg";
import {
  computeAsset5MinPartitionSpec,
  runFiveMinAggregation,
  runFiveMinAggregationWindow,
} from "../../src/iot-hub/services/telemetry-5min-aggregator";

jest.mock("node-cron", () => ({
  schedule: jest.fn(),
}));

describe("telemetry-5min-aggregator (v5.15)", () => {
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

  it("aggregates telemetry_history into asset_5min_metrics with correct kWh values", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    // SELECT from telemetry_history
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          asset_id: "SP-BAT-001",
          pv_energy_kwh: "0.5000",    // AVG(pv) * 1/12
          bat_charge_kwh: "0.2000",
          bat_discharge_kwh: "0.0000",
          grid_import_kwh: "0.1000",
          grid_export_kwh: "0.0500",
          load_kwh: "0.6000",
          avg_battery_soc: "75.0",
          data_points: "60",
        },
      ],
    });
    // UPSERT
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await runFiveMinAggregation(pool);

    expect(mockQuery).toHaveBeenCalledTimes(3);

    // Verify SELECT query
    const selectSql = mockQuery.mock.calls[1][0] as string;
    expect(selectSql).toContain("FROM telemetry_history");
    expect(selectSql).toContain("(1.0/12)");
    expect(selectSql).toContain("AVG(battery_soc)");

    // Verify UPSERT
    const upsertSql = mockQuery.mock.calls[2][0] as string;
    expect(upsertSql).toContain("INSERT INTO asset_5min_metrics");
    expect(upsertSql).toContain("ON CONFLICT (asset_id, window_start)");

    const upsertParams = mockQuery.mock.calls[2][1];
    expect(upsertParams[0]).toBe("SP-BAT-001");     // asset_id
    expect(upsertParams[2]).toBeCloseTo(0.5);         // pv_energy_kwh
    expect(upsertParams[3]).toBeCloseTo(0.2);         // bat_charge_kwh
    expect(upsertParams[4]).toBeCloseTo(0.0);         // bat_discharge_kwh
    expect(upsertParams[5]).toBeCloseTo(0.1);         // grid_import_kwh
    expect(upsertParams[6]).toBeCloseTo(0.05);        // grid_export_kwh
    expect(upsertParams[7]).toBeCloseTo(0.6);         // load_kwh
    expect(upsertParams[9]).toBeCloseTo(75.0);        // avg_battery_soc
    expect(upsertParams[10]).toBe(60);                 // data_points
  });

  it("derives bat_charge_from_grid_kwh correctly: charge=0.2, pv=0.5, load=0.6", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    // pvSurplus = max(0, 0.5 - 0.6) = 0
    // pvToBat = min(0.2, 0) = 0
    // batFromGrid = max(0, 0.2 - 0) = 0.2
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          asset_id: "SP-BAT-001",
          pv_energy_kwh: "0.5000",
          bat_charge_kwh: "0.2000",
          bat_discharge_kwh: "0.0000",
          grid_import_kwh: "0.3000",
          grid_export_kwh: "0.0000",
          load_kwh: "0.6000",
          avg_battery_soc: "50.0",
          data_points: "60",
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await runFiveMinAggregation(pool);

    const upsertParams = mockQuery.mock.calls[2][1];
    // bat_charge_from_grid_kwh = 0.2 (all charge from grid since PV < load)
    expect(upsertParams[8]).toBeCloseTo(0.2);
  });

  it("derives bat_charge_from_grid_kwh=0 when PV surplus covers charge fully", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    // pvSurplus = max(0, 1.0 - 0.3) = 0.7
    // pvToBat = min(0.2, 0.7) = 0.2
    // batFromGrid = max(0, 0.2 - 0.2) = 0
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          asset_id: "SP-BAT-001",
          pv_energy_kwh: "1.0000",
          bat_charge_kwh: "0.2000",
          bat_discharge_kwh: "0.0000",
          grid_import_kwh: "0.0000",
          grid_export_kwh: "0.5000",
          load_kwh: "0.3000",
          avg_battery_soc: "60.0",
          data_points: "60",
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await runFiveMinAggregation(pool);

    const upsertParams = mockQuery.mock.calls[2][1];
    expect(upsertParams[8]).toBeCloseTo(0.0);
  });

  it("handles UPSERT conflict (idempotent update)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          asset_id: "SP-BAT-001",
          pv_energy_kwh: "0.1000",
          bat_charge_kwh: "0.0000",
          bat_discharge_kwh: "0.0000",
          grid_import_kwh: "0.1000",
          grid_export_kwh: "0.0000",
          load_kwh: "0.1000",
          avg_battery_soc: null,
          data_points: "5",
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await runFiveMinAggregation(pool);

    const upsertSql = mockQuery.mock.calls[2][0] as string;
    expect(upsertSql).toContain("DO UPDATE SET");
    expect(upsertSql).toContain("EXCLUDED.pv_energy_kwh");

    // null SoC should be passed as null
    const upsertParams = mockQuery.mock.calls[2][1];
    expect(upsertParams[9]).toBeNull();
  });

  it("calculates window boundaries correctly (rounds to 5-min marks)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await runFiveMinAggregation(pool);

    const selectParams = mockQuery.mock.calls[1][1];
    const windowStart = new Date(selectParams[0]);
    const windowEnd = new Date(selectParams[1]);

    // Window start minutes must be divisible by 5
    expect(windowStart.getMinutes() % 5).toBe(0);
    expect(windowStart.getSeconds()).toBe(0);

    // Window duration must be 5 minutes
    const durationMs = windowEnd.getTime() - windowStart.getTime();
    expect(durationMs).toBe(5 * 60 * 1000);
  });

  it("handles empty telemetry_history gracefully", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await runFiveMinAggregation(pool);

    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("logs error and does not throw when query fails", async () => {
    mockQuery.mockRejectedValueOnce(new Error("connection timeout"));

    await expect(runFiveMinAggregation(pool)).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith(
      "[5MinAggregator] Error:",
      expect.any(Error),
    );
  });

  it("processes multiple assets in a single window", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          asset_id: "SP-BAT-001",
          pv_energy_kwh: "0.5000",
          bat_charge_kwh: "0.1000",
          bat_discharge_kwh: "0.0000",
          grid_import_kwh: "0.0000",
          grid_export_kwh: "0.1000",
          load_kwh: "0.3000",
          avg_battery_soc: "80.0",
          data_points: "60",
        },
        {
          asset_id: "RJ-BAT-002",
          pv_energy_kwh: "0.0000",
          bat_charge_kwh: "0.0000",
          bat_discharge_kwh: "0.4000",
          grid_import_kwh: "0.2000",
          grid_export_kwh: "0.0000",
          load_kwh: "0.6000",
          avg_battery_soc: "30.0",
          data_points: "55",
        },
      ],
    });
    // 2 UPSERTs
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    await runFiveMinAggregation(pool);

    // 1 ensure partition + 1 SELECT + 2 UPSERTs
    expect(mockQuery).toHaveBeenCalledTimes(4);

    expect(mockQuery.mock.calls[2][1][0]).toBe("SP-BAT-001");
    expect(mockQuery.mock.calls[3][1][0]).toBe("RJ-BAT-002");
  });

  it("computes partition boundaries using the 03:00 UTC business-day cutoff", () => {
    const afternoon = computeAsset5MinPartitionSpec(new Date("2026-04-15T13:55:00.000Z"));
    expect(afternoon.partitionName).toBe("asset_5min_metrics_20260415");
    expect(afternoon.start.toISOString()).toBe("2026-04-15T03:00:00.000Z");
    expect(afternoon.end.toISOString()).toBe("2026-04-16T03:00:00.000Z");

    const beforeCutoff = computeAsset5MinPartitionSpec(new Date("2026-04-07T02:55:00.000Z"));
    expect(beforeCutoff.partitionName).toBe("asset_5min_metrics_20260406");
    expect(beforeCutoff.start.toISOString()).toBe("2026-04-06T03:00:00.000Z");
    expect(beforeCutoff.end.toISOString()).toBe("2026-04-07T03:00:00.000Z");
  });

  it("creates the target partition before reading telemetry for the window", async () => {
    const realDate = Date;
    class MockDate extends Date {
      constructor(value?: string | number | Date) {
        super(value ?? "2026-04-15T14:00:20.000Z");
      }
      static now() {
        return new realDate("2026-04-15T14:00:20.000Z").getTime();
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    global.Date = MockDate as any;

    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await runFiveMinAggregation(pool);

    const partitionSql = mockQuery.mock.calls[0][0] as string;
    expect(partitionSql).toContain("CREATE TABLE IF NOT EXISTS asset_5min_metrics_20260415 PARTITION OF asset_5min_metrics");
    expect(partitionSql).toContain("FOR VALUES FROM ('2026-04-15T03:00:00.000Z') TO ('2026-04-16T03:00:00.000Z')");

    const selectParams = mockQuery.mock.calls[1][1];
    expect(selectParams[0]).toBe("2026-04-15T13:55:00.000Z");
    expect(selectParams[1]).toBe("2026-04-15T14:00:00.000Z");

    global.Date = realDate;
  });

  it("aggregates an explicitly requested window for backfill usage", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          asset_id: "SP-BAT-001",
          pv_energy_kwh: "0.2500",
          bat_charge_kwh: "0.1000",
          bat_discharge_kwh: "0.0500",
          grid_import_kwh: "0.0200",
          grid_export_kwh: "0.0100",
          load_kwh: "0.3000",
          avg_battery_soc: "62.5",
          data_points: "12",
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await runFiveMinAggregationWindow(
      pool,
      new Date("2026-04-15T13:55:00.000Z"),
      new Date("2026-04-15T14:00:00.000Z"),
    );

    expect(mockQuery).toHaveBeenCalledTimes(3);
    expect((mockQuery.mock.calls[0][0] as string)).toContain("asset_5min_metrics_20260415");
    expect(mockQuery.mock.calls[1][1]).toEqual([
      "2026-04-15T13:55:00.000Z",
      "2026-04-15T14:00:00.000Z",
    ]);
    expect(mockQuery.mock.calls[2][1][0]).toBe("SP-BAT-001");
  });
});
