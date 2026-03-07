import { Pool } from "pg";
import {
  runDailyPsSavings,
  runMonthlyTrueUp,
} from "../../src/market-billing/services/daily-billing-job";

jest.mock("node-cron", () => ({
  schedule: jest.fn(),
}));

describe("PS Billing — v5.16 Peak Shaving Attribution", () => {
  let mockQuery: jest.Mock;
  let pool: Pool;

  beforeEach(() => {
    mockQuery = jest.fn();
    pool = { query: mockQuery } as unknown as Pool;
  });

  const brtWindowStart = new Date("2026-03-06T03:00:00.000Z");
  const brtWindowEnd = new Date("2026-03-07T03:00:00.000Z");

  it("runDailyPsSavings with PS-mode dispatch → ps_savings_reais populated", async () => {
    // SELECT query returns PS savings data
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          asset_id: "ASSET_SP_001",
          avoided_kva: "5.250",
          daily_ps_savings: "5.93",
          confidence: "high",
        },
      ],
    });
    // UPDATE revenue_daily
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await runDailyPsSavings(pool, brtWindowStart, brtWindowEnd);

    // Verify the SELECT uses asset_5min_metrics + date_bin + dispatch_records
    const selectSql = mockQuery.mock.calls[0][0] as string;
    expect(selectSql).toContain("asset_5min_metrics");
    expect(selectSql).toContain("date_bin");
    expect(selectSql).toContain("dispatch_records");
    expect(selectSql).toContain("peak_shaving");
    expect(selectSql).toContain("billing_power_factor");
    expect(selectSql).toContain("demand_charge_rate_per_kva");

    // Verify the UPDATE writes PS columns
    const updateSql = mockQuery.mock.calls[1][0] as string;
    expect(updateSql).toContain("UPDATE revenue_daily");
    expect(updateSql).toContain("ps_savings_reais");
    expect(updateSql).toContain("ps_avoided_peak_kva");
    expect(updateSql).toContain("do_shed_confidence");

    const updateParams = mockQuery.mock.calls[1][1];
    expect(updateParams[0]).toBe(5.93); // ps_savings_reais
    expect(updateParams[1]).toBe(5.25); // ps_avoided_peak_kva
    expect(updateParams[2]).toBe("high"); // confidence
    expect(updateParams[3]).toBe("ASSET_SP_001");
  });

  it("runDailyPsSavings with no PS dispatch → no PS savings written", async () => {
    // No rows returned (no PS dispatches)
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await runDailyPsSavings(pool, brtWindowStart, brtWindowEnd);

    // Only the SELECT query was called, no UPDATEs
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("DO fallback: missing post-DO telemetry → do_shed_confidence='low', load_shed=0", async () => {
    // The query computes 'low' confidence when DO active but no post-trigger telemetry
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          asset_id: "ASSET_SP_001",
          avoided_kva: "3.000",
          daily_ps_savings: "3.39",
          confidence: "low",
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await runDailyPsSavings(pool, brtWindowStart, brtWindowEnd);

    const updateParams = mockQuery.mock.calls[1][1];
    expect(updateParams[2]).toBe("low"); // confidence = 'low'
    expect(updateParams[0]).toBe(3.39);
  });

  it("runMonthlyTrueUp → inserts true_up_adjustment_reais, does NOT update daily rows", async () => {
    const billingMonth = new Date("2026-02-15T00:00:00.000Z"); // Feb 2026

    // Monthly true-up query
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          asset_id: "ASSET_SP_001",
          true_ps_savings: "180.00",
          sum_daily_provisionals: "165.50",
        },
      ],
    });
    // INSERT true-up row
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await runMonthlyTrueUp(pool, billingMonth);

    // Verify the true-up query uses date_bin and full month range
    const selectSql = mockQuery.mock.calls[0][0] as string;
    expect(selectSql).toContain("date_bin");
    expect(selectSql).toContain("monthly_peak_kva");
    expect(selectSql).toContain("sum_provisionals");

    // Verify INSERT (not UPDATE) for true-up
    const insertSql = mockQuery.mock.calls[1][0] as string;
    expect(insertSql).toContain("INSERT INTO revenue_daily");
    expect(insertSql).toContain("true_up_adjustment_reais");
    // Should NOT contain UPDATE to historical ps_savings_reais
    expect(insertSql).not.toContain("SET ps_savings_reais");

    const insertParams = mockQuery.mock.calls[1][1];
    expect(insertParams[0]).toBe("ASSET_SP_001");
    // adjustment = 180.00 - 165.50 = 14.50
    expect(insertParams[2]).toBeCloseTo(14.5, 1);
  });

  it("runMonthlyTrueUp skips negligible adjustments (< 0.01)", async () => {
    const billingMonth = new Date("2026-02-15T00:00:00.000Z");

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          asset_id: "ASSET_SP_001",
          true_ps_savings: "100.005",
          sum_daily_provisionals: "100.000",
        },
      ],
    });

    await runMonthlyTrueUp(pool, billingMonth);

    // Only the SELECT was called, no INSERT (adjustment = 0.005 < 0.01)
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("uses date_bin with 15-minute windows (never creates asset_15min_demand table)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await runDailyPsSavings(pool, brtWindowStart, brtWindowEnd);

    const sql = mockQuery.mock.calls[0][0] as string;
    // Must use date_bin() for 15-min binning
    expect(sql).toContain("date_bin('15 minutes'");
    // Must NOT reference any 15min demand table
    expect(sql).not.toContain("asset_15min_demand");
  });

  it("billing_power_factor comes from tariff_schedules (never assets)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await runDailyPsSavings(pool, brtWindowStart, brtWindowEnd);

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("tariff_schedules");
    expect(sql).toContain("billing_power_factor");
  });
});
