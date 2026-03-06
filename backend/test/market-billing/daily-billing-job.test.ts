import { Pool } from "pg";
import { runDailyBilling } from "../../src/market-billing/services/daily-billing-job";

jest.mock("node-cron", () => ({
  schedule: jest.fn(),
}));

describe("daily-billing-job (M4 — v5.14 DP + Formula Overhaul)", () => {
  let mockQuery: jest.Mock;
  let pool: Pool;

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  beforeEach(() => {
    mockQuery = jest.fn();
    pool = { query: mockQuery } as unknown as Pool;
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reads hour-level metrics + tariff schedules and UPSERTs revenue_daily with v5.14 columns", async () => {
    // Query 1: hourly metrics — v5.14: includes load + soc + DP params
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          asset_id: "ASSET_SP_001",
          org_id: "ORG_ENERGIA_001",
          capacity_kwh: "10",
          soc_min_pct: "10",
          max_charge_rate_kw: "5",
          max_discharge_rate_kw: "5",
          hour: 3,
          total_charge_kwh: "10",
          total_discharge_kwh: "0",
          pv_generation_kwh: "0",
          grid_import_kwh: "10",
          grid_export_kwh: "0",
          load_consumption_kwh: "10",
          avg_battery_soc: null,
        },
        {
          asset_id: "ASSET_SP_001",
          org_id: "ORG_ENERGIA_001",
          capacity_kwh: "10",
          soc_min_pct: "10",
          max_charge_rate_kw: "5",
          max_discharge_rate_kw: "5",
          hour: 19,
          total_charge_kwh: "0",
          total_discharge_kwh: "9",
          pv_generation_kwh: "0",
          grid_import_kwh: "0",
          grid_export_kwh: "0",
          load_consumption_kwh: "5",
          avg_battery_soc: null,
        },
      ],
    });
    // Query 2: tariff schedules
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          org_id: "ORG_ENERGIA_001",
          peak_rate: "0.82",
          offpeak_rate: "0.25",
          intermediate_rate: "0.55",
        },
      ],
    });
    // UPSERT revenue_daily
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await runDailyBilling(pool);

    // Verify query 1 references asset_hourly_metrics
    const selectSql = mockQuery.mock.calls[0][0] as string;
    expect(selectSql).toContain("asset_hourly_metrics");
    expect(selectSql).toContain("load_consumption_kwh");
    expect(selectSql).toContain("soc_min_pct");
    expect(selectSql).toContain("max_charge_rate_kw");
    expect(selectSql).toContain("max_discharge_rate_kw");
    expect(mockQuery.mock.calls[0][1]).toEqual([yesterdayStr]);

    // Verify UPSERT into revenue_daily with v5.14 columns
    const upsertSql = mockQuery.mock.calls[2][0] as string;
    expect(upsertSql).toContain("INSERT INTO revenue_daily");
    expect(upsertSql).toContain("ON CONFLICT");
    expect(upsertSql).toContain("baseline_cost_reais");
    expect(upsertSql).toContain("actual_cost_reais");
    expect(upsertSql).toContain("best_tou_cost_reais");
    expect(upsertSql).toContain("self_sufficiency_pct");

    const upsertValues = mockQuery.mock.calls[2][1];
    expect(upsertValues[0]).toBe("ASSET_SP_001");       // asset_id
    expect(upsertValues[1]).toBe(yesterdayStr);           // date
    expect(upsertValues[2]).toBe(0);                      // arbitrage (placeholder)

    // v5.14: client_savings = baseline - actual
    // baseline = load[3]*0.25 + load[19]*0.82 = 10*0.25 + 5*0.82 = 2.50 + 4.10 = 6.60
    // actual = gridImport[3]*0.25 + gridImport[19]*0.82 = 10*0.25 + 0*0.82 = 2.50
    // savings = 6.60 - 2.50 = 4.10
    expect(upsertValues[3]).toBe(4.10);                   // client_savings_reais

    // v5.14: verify new columns are populated
    const baselineCost = upsertValues[9];
    const actualCost = upsertValues[10];
    const bestTouCost = upsertValues[11];
    const selfSufficiency = upsertValues[12];

    expect(baselineCost).toBe(6.60);                     // baseline_cost_reais
    expect(actualCost).toBe(2.50);                       // actual_cost_reais
    expect(bestTouCost).toBeGreaterThanOrEqual(0);       // best_tou_cost_reais
    expect(bestTouCost).toBeLessThanOrEqual(baselineCost); // DP optimal <= baseline
    // self_sufficiency = (15 - 10) / 15 * 100 = 33.3
    expect(selfSufficiency).toBeCloseTo(33.3, 0);
  });

  it("uses default tariff schedule and DP fallbacks when org has no tariff and asset has no DP params", async () => {
    // Query 1: hourly metrics with NULL DP params
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          asset_id: "ASSET_SP_001",
          org_id: "ORG_NO_TARIFF",
          capacity_kwh: "10",
          soc_min_pct: null,
          max_charge_rate_kw: null,
          max_discharge_rate_kw: null,
          hour: 19,
          total_charge_kwh: "0",
          total_discharge_kwh: "5",
          pv_generation_kwh: "3",
          grid_import_kwh: "2",
          grid_export_kwh: "1",
          load_consumption_kwh: "5",
          avg_battery_soc: null,
        },
      ],
    });
    // Query 2: no tariff schedules
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // UPSERT
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await runDailyBilling(pool);

    const upsertValues = mockQuery.mock.calls[2][1];
    // baseline = 5 * 0.82 = 4.10
    // actual = 2 * 0.82 = 1.64
    // savings = 4.10 - 1.64 = 2.46
    expect(upsertValues[3]).toBe(2.46);                   // client_savings

    const baselineCost = upsertValues[9];
    const actualCost = upsertValues[10];
    expect(baselineCost).toBe(4.10);
    expect(actualCost).toBe(1.64);
  });

  it("handles no data gracefully (empty asset_hourly_metrics for yesterday)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await runDailyBilling(pool);

    // SELECT hourly + SELECT tariff, no UPSERT
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("logs error and does not throw when query fails", async () => {
    mockQuery.mockRejectedValueOnce(new Error("connection refused"));

    await expect(runDailyBilling(pool)).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith(
      "[BillingJob] Error:",
      expect.any(Error),
    );
  });
});
