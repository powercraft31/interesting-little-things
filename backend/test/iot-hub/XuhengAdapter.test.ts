import { XuhengAdapter } from "../../src/iot-hub/parsers/XuhengAdapter";
import type { XuhengRawMessage } from "../../src/shared/types/telemetry";

describe("XuhengAdapter — MSG#4 parser", () => {
  const adapter = new XuhengAdapter();

  const MSG4_FIXTURE: XuhengRawMessage = {
    clientId: "TEST_CLIENT_001",
    productKey: "ems",
    timeStamp: "1772620029130",
    data: {
      batList: [
        {
          deviceSn: "BAT_SN_001",
          properties: {
            total_bat_soc: "75.5",
            total_bat_power: "-3.2",
            total_bat_dailyChargedEnergy: "12.5",
            total_bat_dailyDischargedEnergy: "8.3",
          },
        },
      ],
      pvList: [
        {
          deviceSn: "PV_SN_001",
          properties: {
            pv_totalPower: "4.1",
            pv_dailyEnergy: "18.5",
          },
        },
      ],
      gridList: [
        {
          deviceSn: "GRID_SN_001",
          properties: {
            grid_totalActivePower: "-1.8",
            grid_dailyBuyEnergy: "5.2",
            grid_dailySellEnergy: "3.1",
          },
        },
      ],
      loadList: [
        {
          deviceSn: "LOAD_SN_001",
          properties: { load1_totalPower: "2.3" },
        },
      ],
      flloadList: [
        {
          deviceSn: "FL_SN_001",
          properties: { flload_totalPower: "0.5" },
        },
      ],
    },
  };

  it("parses MSG#4 with all lists into ParsedTelemetry", () => {
    const result = adapter.parse(MSG4_FIXTURE);
    expect(result).not.toBeNull();
    expect(result!.clientId).toBe("TEST_CLIENT_001");
    expect(result!.deviceSn).toBe("BAT_SN_001");
    expect(result!.batterySoc).toBe(75.5);
    expect(result!.batteryPowerKw).toBe(-3.2);
    expect(result!.dailyChargeKwh).toBe(12.5);
    expect(result!.dailyDischargeKwh).toBe(8.3);
    expect(result!.pvPowerKw).toBe(4.1);
    expect(result!.pvDailyEnergyKwh).toBe(18.5);
    expect(result!.gridPowerKw).toBe(-1.8);
    expect(result!.gridDailyBuyKwh).toBe(5.2);
    expect(result!.gridDailySellKwh).toBe(3.1);
    expect(result!.loadPowerKw).toBe(2.3);
    expect(result!.flloadPowerKw).toBe(0.5);
  });

  it("parses timestamp correctly", () => {
    const result = adapter.parse(MSG4_FIXTURE);
    expect(result!.recordedAt).toBeInstanceOf(Date);
    expect(result!.recordedAt.getTime()).toBe(1772620029130);
  });

  it("returns null when batList is empty", () => {
    const noData: XuhengRawMessage = {
      ...MSG4_FIXTURE,
      data: { ...MSG4_FIXTURE.data, batList: [] },
    };
    expect(adapter.parse(noData)).toBeNull();
  });

  it("returns null when batList is undefined", () => {
    const noData: XuhengRawMessage = {
      ...MSG4_FIXTURE,
      data: { batList: undefined } as unknown as XuhengRawMessage["data"],
    };
    expect(adapter.parse(noData)).toBeNull();
  });

  it("handles missing optional lists (pvList, gridList, etc.)", () => {
    const minimalData: XuhengRawMessage = {
      clientId: "MINIMAL_001",
      productKey: "ems",
      timeStamp: "1772620029130",
      data: {
        batList: [
          {
            deviceSn: "BAT_001",
            properties: {
              total_bat_soc: "50",
              total_bat_power: "2.0",
              total_bat_dailyChargedEnergy: "5",
              total_bat_dailyDischargedEnergy: "3",
            },
          },
        ],
      },
    };
    const result = adapter.parse(minimalData);
    expect(result).not.toBeNull();
    expect(result!.pvPowerKw).toBe(0);
    expect(result!.gridPowerKw).toBe(0);
    expect(result!.loadPowerKw).toBe(0);
    expect(result!.flloadPowerKw).toBe(0);
  });

  it("handles non-numeric string values safely", () => {
    const badData: XuhengRawMessage = {
      ...MSG4_FIXTURE,
      data: {
        ...MSG4_FIXTURE.data,
        batList: [
          {
            deviceSn: "BAT_BAD",
            properties: {
              total_bat_soc: "not_a_number",
              total_bat_power: "",
              total_bat_dailyChargedEnergy: "NaN",
              total_bat_dailyDischargedEnergy: "Infinity",
            },
          },
        ],
      },
    };
    const result = adapter.parse(badData);
    expect(result).not.toBeNull();
    expect(result!.batterySoc).toBe(0);
    expect(result!.batteryPowerKw).toBe(0);
    expect(result!.dailyChargeKwh).toBe(0);
    // Infinity is not finite, so safeFloat returns 0
    expect(result!.dailyDischargeKwh).toBe(0);
  });
});
