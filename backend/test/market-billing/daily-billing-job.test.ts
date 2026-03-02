import { Pool } from "pg";
import { runDailyBilling } from "../../src/market-billing/services/daily-billing-job";

jest.mock("node-cron", () => ({
  schedule: jest.fn(),
}));

describe("daily-billing-job (M4 — v5.8 asset_hourly_metrics)", () => {
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

  it("reads from asset_hourly_metrics (NOT trade_schedules) and UPSERTs revenue_daily", async () => {
    // SELECT from asset_hourly_metrics
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          asset_id: "ASSET_SP_001",
          org_id: "ORG_ENERGIA_001",
          total_discharge_kwh: 10,
          total_charge_kwh: 15,
          arbitrage_profit_reais: 2.8,
          retail_buy_rate_kwh: 0.75,
        },
      ],
    });
    // UPSERT revenue_daily
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await runDailyBilling(pool);

    // Verify SELECT query references asset_hourly_metrics
    const selectSql = mockQuery.mock.calls[0][0] as string;
    expect(selectSql).toContain("asset_hourly_metrics");
    expect(selectSql).not.toContain("trade_schedules");
    expect(mockQuery.mock.calls[0][1]).toEqual([yesterdayStr]);

    // Verify UPSERT into revenue_daily
    const upsertSql = mockQuery.mock.calls[1][0] as string;
    expect(upsertSql).toContain("INSERT INTO revenue_daily");
    expect(upsertSql).toContain("ON CONFLICT");

    const upsertValues = mockQuery.mock.calls[1][1];
    expect(upsertValues[0]).toBe("ASSET_SP_001");      // asset_id
    expect(upsertValues[1]).toBe(yesterdayStr);          // date
    expect(upsertValues[2]).toBe(2.8);                   // arbitrage (rounded)
    expect(upsertValues[3]).toBe(7.5);                   // savings = 10 * 0.75
  });

  it("handles multiple assets correctly", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          asset_id: "ASSET_SP_001",
          org_id: "ORG_ENERGIA_001",
          total_discharge_kwh: 10,
          total_charge_kwh: 12,
          arbitrage_profit_reais: 2.8,
          retail_buy_rate_kwh: 0.75,
        },
        {
          asset_id: "ASSET_RJ_002",
          org_id: "ORG_ENERGIA_001",
          total_discharge_kwh: 5,
          total_charge_kwh: 3,
          arbitrage_profit_reais: 1.4,
          retail_buy_rate_kwh: 0.80,
        },
      ],
    });
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    await runDailyBilling(pool);

    // 1 SELECT + 2 UPSERTs
    expect(mockQuery).toHaveBeenCalledTimes(3);

    // Second UPSERT: ASSET_RJ_002
    const upsertValues = mockQuery.mock.calls[2][1];
    expect(upsertValues[0]).toBe("ASSET_RJ_002");
    expect(upsertValues[2]).toBe(1.4);                   // arbitrage
    expect(upsertValues[3]).toBe(4);                     // savings = 5 * 0.80
  });

  it("handles no data gracefully (empty asset_hourly_metrics for yesterday)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await runDailyBilling(pool);

    // Only the SELECT, no UPSERT
    expect(mockQuery).toHaveBeenCalledTimes(1);
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
