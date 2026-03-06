import { Pool } from "pg";
import { runDailyBilling } from "../../src/market-billing/services/daily-billing-job";

jest.mock("node-cron", () => ({
  schedule: jest.fn(),
}));

describe("daily-billing-job (M4 — v5.13 Tarifa Branca)", () => {
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

  it("reads hour-level metrics + tariff schedules and UPSERTs revenue_daily with Tarifa Branca savings", async () => {
    // Query 1: hourly metrics
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          asset_id: "ASSET_SP_001",
          org_id: "ORG_ENERGIA_001",
          capacity_kwh: "10",
          hour: 3,
          total_charge_kwh: "10",
          total_discharge_kwh: "0",
          pv_generation_kwh: "0",
          grid_import_kwh: "10",
          grid_export_kwh: "0",
        },
        {
          asset_id: "ASSET_SP_001",
          org_id: "ORG_ENERGIA_001",
          capacity_kwh: "10",
          hour: 19,
          total_charge_kwh: "0",
          total_discharge_kwh: "9",
          pv_generation_kwh: "0",
          grid_import_kwh: "0",
          grid_export_kwh: "0",
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
    expect(selectSql).not.toContain("trade_schedules");
    expect(mockQuery.mock.calls[0][1]).toEqual([yesterdayStr]);

    // Verify query 2 references tariff_schedules
    const tariffSql = mockQuery.mock.calls[1][0] as string;
    expect(tariffSql).toContain("tariff_schedules");

    // Verify UPSERT into revenue_daily
    const upsertSql = mockQuery.mock.calls[2][0] as string;
    expect(upsertSql).toContain("INSERT INTO revenue_daily");
    expect(upsertSql).toContain("ON CONFLICT");
    expect(upsertSql).toContain("actual_self_consumption_pct");
    expect(upsertSql).toContain("pv_energy_kwh");

    const upsertValues = mockQuery.mock.calls[2][1];
    expect(upsertValues[0]).toBe("ASSET_SP_001");       // asset_id
    expect(upsertValues[1]).toBe(yesterdayStr);           // date
    expect(upsertValues[2]).toBe(0);                      // arbitrage (placeholder)
    // savings = 9 * 0.82 - 10 * 0.25 = 7.38 - 2.50 = 4.88
    expect(upsertValues[3]).toBe(4.88);                   // client_savings_reais
  });

  it("uses default tariff schedule when org has no tariff", async () => {
    // Query 1: hourly metrics
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          asset_id: "ASSET_SP_001",
          org_id: "ORG_NO_TARIFF",
          capacity_kwh: "10",
          hour: 19,
          total_charge_kwh: "0",
          total_discharge_kwh: "5",
          pv_generation_kwh: "3",
          grid_import_kwh: "0",
          grid_export_kwh: "1",
        },
      ],
    });
    // Query 2: no tariff schedules
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // UPSERT
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await runDailyBilling(pool);

    const upsertValues = mockQuery.mock.calls[2][1];
    // savings = 5 * 0.82 = 4.10 (default peak rate)
    expect(upsertValues[3]).toBe(4.10);
    // self-consumption = (3 - 1) / 3 * 100 = 66.7%
    expect(upsertValues[4]).toBe(66.7);
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
