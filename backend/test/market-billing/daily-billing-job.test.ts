import { Pool } from "pg";
import { runDailyBilling } from "../../src/market-billing/services/daily-billing-job";

jest.mock("node-cron", () => ({
  schedule: jest.fn(),
}));

describe("daily-billing-job (M4 — v5.15 SC/TOU Attribution)", () => {
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
    // Query 1: hourly metrics
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
    // Query 3: UPSERT revenue_daily
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    // Query 4: SC/TOU attribution SELECT
    mockQuery.mockResolvedValueOnce({ rows: [] });

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
    expect(upsertValues[0]).toBe("ASSET_SP_001");
    expect(upsertValues[1]).toBe(yesterdayStr);
    expect(upsertValues[2]).toBe(0);  // arbitrage (placeholder)
    expect(upsertValues[3]).toBe(4.10);  // client_savings

    const baselineCost = upsertValues[9];
    const actualCost = upsertValues[10];
    const bestTouCost = upsertValues[11];
    const selfSufficiency = upsertValues[12];

    expect(baselineCost).toBe(6.60);
    expect(actualCost).toBe(2.50);
    expect(bestTouCost).toBeGreaterThanOrEqual(0);
    expect(bestTouCost).toBeLessThanOrEqual(baselineCost);
    expect(selfSufficiency).toBeCloseTo(33.3, 0);
  });

  it("uses default tariff schedule and DP fallbacks when org has no tariff and asset has no DP params", async () => {
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
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no tariff
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPSERT
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SC/TOU attribution

    await runDailyBilling(pool);

    const upsertValues = mockQuery.mock.calls[2][1];
    expect(upsertValues[3]).toBe(2.46);  // client_savings

    const baselineCost = upsertValues[9];
    const actualCost = upsertValues[10];
    expect(baselineCost).toBe(4.10);
    expect(actualCost).toBe(1.64);
  });

  it("handles no data gracefully (empty asset_hourly_metrics for yesterday)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // hourly
    mockQuery.mockResolvedValueOnce({ rows: [] }); // tariff
    // v5.15: attribution query still runs
    mockQuery.mockResolvedValueOnce({ rows: [] }); // attribution

    await runDailyBilling(pool);

    // SELECT hourly + SELECT tariff + SELECT attribution
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it("logs error and does not throw when query fails", async () => {
    mockQuery.mockRejectedValueOnce(new Error("connection refused"));

    await expect(runDailyBilling(pool)).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith(
      "[BillingJob] Error:",
      expect.any(Error),
    );
  });

  // -- v5.15 SC/TOU Attribution Tests --

  it("SC attribution: self_consumption dispatch populates sc_savings_reais", async () => {
    // Hourly metrics (1 asset, 1 hour)
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          asset_id: "SP-BAT-001",
          org_id: "ORG_001",
          capacity_kwh: "10",
          soc_min_pct: "10",
          max_charge_rate_kw: "5",
          max_discharge_rate_kw: "5",
          hour: 10,
          total_charge_kwh: "0",
          total_discharge_kwh: "0",
          pv_generation_kwh: "2",
          grid_import_kwh: "0",
          grid_export_kwh: "0.5",
          load_consumption_kwh: "1.5",
          avg_battery_soc: "80",
        },
      ],
    });
    // Tariff
    mockQuery.mockResolvedValueOnce({
      rows: [{ org_id: "ORG_001", peak_rate: "0.82", offpeak_rate: "0.25", intermediate_rate: "0.55" }],
    });
    // UPSERT revenue_daily
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    // SC/TOU attribution: asset in self_consumption mode
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          asset_id: "SP-BAT-001",
          sc_energy_kwh: "3.5000",      // total SC energy for the day
          tou_discharge_kwh: "0.0000",
          tou_charge_kwh: "0.0000",
        },
      ],
    });
    // UPDATE revenue_daily with SC/TOU
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await runDailyBilling(pool);

    // Verify attribution query uses BRT-aligned window
    const attrSql = mockQuery.mock.calls[3][0] as string;
    expect(attrSql).toContain("asset_5min_metrics");
    expect(attrSql).toContain("dispatch_records");
    expect(attrSql).toContain("self_consumption");
    expect(attrSql).toContain("peak_valley_arbitrage");

    // Verify UPDATE with sc_savings
    const updateSql = mockQuery.mock.calls[4][0] as string;
    expect(updateSql).toContain("UPDATE revenue_daily");
    expect(updateSql).toContain("sc_savings_reais");
    expect(updateSql).toContain("tou_savings_reais");

    const updateParams = mockQuery.mock.calls[4][1];
    // sc_savings = 3.5 * 0.55 (intermediate rate) = 1.93
    expect(updateParams[0]).toBe(1.93);  // sc_savings_reais
    expect(updateParams[1]).toBe(0);     // tou_savings_reais (no TOU activity)
    expect(updateParams[2]).toBe("SP-BAT-001");
  });

  it("TOU attribution: peak_valley_arbitrage dispatch populates tou_savings_reais", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          asset_id: "SP-BAT-001",
          org_id: "ORG_001",
          capacity_kwh: "10",
          soc_min_pct: "10",
          max_charge_rate_kw: "5",
          max_discharge_rate_kw: "5",
          hour: 19,
          total_charge_kwh: "0",
          total_discharge_kwh: "5",
          pv_generation_kwh: "0",
          grid_import_kwh: "0",
          grid_export_kwh: "0",
          load_consumption_kwh: "5",
          avg_battery_soc: null,
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ org_id: "ORG_001", peak_rate: "0.82", offpeak_rate: "0.25", intermediate_rate: "0.55" }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPSERT
    // Attribution: TOU mode
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          asset_id: "SP-BAT-001",
          sc_energy_kwh: "0.0000",
          tou_discharge_kwh: "5.0000",
          tou_charge_kwh: "2.0000",
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE

    await runDailyBilling(pool);

    const updateParams = mockQuery.mock.calls[4][1];
    // tou_savings = (5.0 * 0.82) - (2.0 * 0.25) = 4.10 - 0.50 = 3.60
    expect(updateParams[0]).toBe(0);      // sc_savings = 0
    expect(updateParams[1]).toBe(3.6);    // tou_savings
  });

  it("UNASSIGNED mode: sc/tou remain at 0 (no TypeError)", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          asset_id: "SP-BAT-001",
          org_id: "ORG_001",
          capacity_kwh: "10",
          soc_min_pct: "10",
          max_charge_rate_kw: "5",
          max_discharge_rate_kw: "5",
          hour: 10,
          total_charge_kwh: "0",
          total_discharge_kwh: "0",
          pv_generation_kwh: "1",
          grid_import_kwh: "1",
          grid_export_kwh: "0",
          load_consumption_kwh: "2",
          avg_battery_soc: null,
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ org_id: "ORG_001", peak_rate: "0.82", offpeak_rate: "0.25", intermediate_rate: "0.55" }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPSERT
    // Attribution: all UNASSIGNED → sums to 0
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          asset_id: "SP-BAT-001",
          sc_energy_kwh: "0.0000",
          tou_discharge_kwh: "0.0000",
          tou_charge_kwh: "0.0000",
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE

    await runDailyBilling(pool);

    const updateParams = mockQuery.mock.calls[4][1];
    expect(updateParams[0]).toBe(0);  // sc_savings = 0
    expect(updateParams[1]).toBe(0);  // tou_savings = 0
  });

  it("BRT billing window: attribution query uses 03:00 UTC boundaries", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // hourly
    mockQuery.mockResolvedValueOnce({ rows: [] }); // tariff
    // Attribution query
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await runDailyBilling(pool);

    // The attribution query is the 3rd call (index 2)
    const attrParams = mockQuery.mock.calls[2][1];
    const windowStart = new Date(attrParams[0]);
    const windowEnd = new Date(attrParams[1]);

    // Window start should be at 03:00 UTC (BRT midnight)
    expect(windowStart.getUTCHours()).toBe(3);
    expect(windowStart.getUTCMinutes()).toBe(0);
    expect(windowStart.getUTCSeconds()).toBe(0);

    // Window end should also be at 03:00 UTC (next day)
    expect(windowEnd.getUTCHours()).toBe(3);
    expect(windowEnd.getUTCMinutes()).toBe(0);

    // Duration = 24 hours
    const durationMs = windowEnd.getTime() - windowStart.getTime();
    expect(durationMs).toBe(24 * 60 * 60 * 1000);
  });
});
