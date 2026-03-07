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
            // v5.14 new fields
            total_bat_soh: "98.2",
            total_bat_vlotage: "51.6",
            total_bat_current: "-6.2",
            total_bat_temperature: "28.5",
            total_bat_maxChargeVoltage: "57.6",
            total_bat_maxChargeCurrent: "25.0",
            total_bat_maxDischargeCurrent: "25.0",
            total_bat_totalChargedEnergy: "1250.8",
            total_bat_totalDischargedEnergy: "1180.3",
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

  it("parses v5.14 battery deep telemetry fields", () => {
    const result = adapter.parse(MSG4_FIXTURE);
    expect(result).not.toBeNull();
    expect(result!.batterySoh).toBe(98.2);
    expect(result!.batteryVoltage).toBe(51.6);
    expect(result!.batteryCurrent).toBe(-6.2);
    expect(result!.batteryTemperature).toBe(28.5);
    expect(result!.maxChargeVoltage).toBe(57.6);
    expect(result!.maxChargeCurrent).toBe(25.0);
    expect(result!.maxDischargeCurrent).toBe(25.0);
    expect(result!.totalChargeKwh).toBe(1250.8);
    expect(result!.totalDischargeKwh).toBe(1180.3);
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
    // v5.14: missing bat fields default to 0
    expect(result!.batterySoh).toBe(0);
    expect(result!.batteryVoltage).toBe(0);
    expect(result!.batteryCurrent).toBe(0);
    expect(result!.batteryTemperature).toBe(0);
    expect(result!.maxChargeVoltage).toBe(0);
    expect(result!.maxChargeCurrent).toBe(0);
    expect(result!.maxDischargeCurrent).toBe(0);
    expect(result!.totalChargeKwh).toBe(0);
    expect(result!.totalDischargeKwh).toBe(0);
  });

  // -- v5.16 DO parsing tests --

  it("v5.16: dido present with DO0='1' → do0Active: true", () => {
    const withDO: XuhengRawMessage = {
      ...MSG4_FIXTURE,
      data: {
        ...MSG4_FIXTURE.data,
        dido: {
          do: [
            { id: "DO0", type: "DO", value: "1", gpionum: "0" },
            { id: "DO1", type: "DO", value: "0", gpionum: "1" },
          ],
        },
      },
    };
    const result = adapter.parse(withDO);
    expect(result).not.toBeNull();
    expect(result!.do0Active).toBe(true);
    expect(result!.do1Active).toBe(false);
  });

  it("v5.16: dido present with DO0='0' → do0Active: false", () => {
    const withDO: XuhengRawMessage = {
      ...MSG4_FIXTURE,
      data: {
        ...MSG4_FIXTURE.data,
        dido: {
          do: [
            { id: "DO0", type: "DO", value: "0" },
            { id: "DO1", type: "DO", value: "0" },
          ],
        },
      },
    };
    const result = adapter.parse(withDO);
    expect(result).not.toBeNull();
    expect(result!.do0Active).toBe(false);
    expect(result!.do1Active).toBe(false);
  });

  it("v5.16: dido absent → do0Active: false, do1Active: false", () => {
    const result = adapter.parse(MSG4_FIXTURE);
    expect(result).not.toBeNull();
    expect(result!.do0Active).toBe(false);
    expect(result!.do1Active).toBe(false);
  });

  it("v5.16: dido.do array empty → both false", () => {
    const emptyDO: XuhengRawMessage = {
      ...MSG4_FIXTURE,
      data: {
        ...MSG4_FIXTURE.data,
        dido: { do: [] },
      },
    };
    const result = adapter.parse(emptyDO);
    expect(result).not.toBeNull();
    expect(result!.do0Active).toBe(false);
    expect(result!.do1Active).toBe(false);
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
