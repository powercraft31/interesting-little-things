import {
  handleTelemetry,
  _destroyAssembler,
  safeFloat,
} from "../../src/iot-hub/handlers/telemetry-handler";
import type { SolfacilMessage } from "../../src/shared/types/solfacil-protocol";

// ─── Mock DeviceAssetCache ──────────────────────────────────────────────────
jest.mock("../../src/iot-hub/services/device-asset-cache", () => ({
  DeviceAssetCache: jest.fn().mockImplementation(() => ({
    resolve: jest.fn().mockResolvedValue("asset-bat-001"),
  })),
}));

// ─── Mock MessageBuffer ─────────────────────────────────────────────────────
const mockEnqueue = jest.fn();
jest.mock("../../src/iot-hub/services/message-buffer", () => ({
  MessageBuffer: jest.fn().mockImplementation(() => ({
    enqueue: mockEnqueue,
  })),
}));

// ─── Mock Pool ──────────────────────────────────────────────────────────────
function createMockPool() {
  return {
    query: jest.fn().mockResolvedValue({ rows: [] }),
  } as unknown as import("pg").Pool;
}

// ─── Fixtures ───────────────────────────────────────────────────────────────
// All raw values use Protocol v1.8 integer format.
// Scaling: voltage ×0.1, current ×0.1, temp ×0.1, freq ×0.01, energy ×0.1, power W→kW (/1000)
const FULL_TELEMETRY_PAYLOAD: SolfacilMessage = {
  DS: 0,
  ackFlag: 0,
  clientId: "WKRD24070202100144F",
  deviceName: "EMS_N2",
  productKey: "ems",
  messageId: "21032243540",
  timeStamp: "1772681002103",
  data: {
    batList: [
      {
        deviceSn: "battery_inv1_WKRD24070202100144F",
        fatherSn: "WKRD24070202100144F",
        name: "battery",
        properties: {
          total_bat_soc: "75.5",
          total_bat_power: "-3200",
          total_bat_dailyChargedEnergy: "125",
          total_bat_dailyDischargedEnergy: "83",
          total_bat_soh: "98.2",
          total_bat_vlotage: "516", // typo in protocol
          total_bat_current: "-62",
          total_bat_temperature: "285",
          total_bat_maxChargeVoltage: "576",
          total_bat_maxChargeCurrent: "250",
          total_bat_maxDischargeCurrent: "250",
          total_bat_totalChargedEnergy: "12508",
          total_bat_totalDischargedEnergy: "11803",
        },
        subDevId: "battery",
      },
    ],
    gridList: [
      {
        deviceSn: "grid_inv1_WKRD24070202100144F",
        fatherSn: "WKRD24070202100144F",
        name: "grid",
        properties: {
          grid_voltA: "2300",
          grid_voltB: "2310",
          grid_voltC: "2290",
          grid_currentA: "51",
          grid_currentB: "52",
          grid_currentC: "49",
          grid_activePowerA: "1150",
          grid_activePowerB: "1200",
          grid_activePowerC: "1100",
          grid_totalActivePower: "3450",
          grid_reactivePowerA: "50",
          grid_reactivePowerB: "55",
          grid_reactivePowerC: "45",
          grid_totalReactivePower: "150",
          grid_apparentPowerA: "1155",
          grid_apparentPowerB: "1205",
          grid_apparentPowerC: "1105",
          grid_totalApparentPower: "3465",
          grid_factorA: "990",
          grid_factorB: "980",
          grid_factorC: "990",
          grid_frequency: "6000",
          grid_dailyBuyEnergy: "153",
          grid_dailySellEnergy: "21",
          grid_totalBuyEnergy: "50000",
          grid_totalSellEnergy: "2000",
          grid_temp: "425",
        },
        subDevId: "grid",
      },
    ],
    pvList: [
      {
        deviceSn: "pv_inv1",
        fatherSn: "WKRD24070202100144F",
        name: "pv",
        properties: {
          pv_totalPower: "6342",
          pv_totalEnergy: "123450",
          pv_dailyEnergy: "185",
        },
        subDevId: "pv",
      },
      {
        deviceSn: "pv1_inv1",
        fatherSn: "WKRD24070202100144F",
        name: "pv1",
        properties: {
          pv1_voltage: "3800",
          pv1_current: "85",
          pv1_power: "3230",
        },
        subDevId: "pv1",
      },
      {
        deviceSn: "pv2_inv1",
        fatherSn: "WKRD24070202100144F",
        name: "pv2",
        properties: {
          pv2_voltage: "3750",
          pv2_current: "83",
          pv2_power: "3112",
        },
        subDevId: "pv2",
      },
    ],
    loadList: [
      {
        deviceSn: "load1_inv1",
        fatherSn: "WKRD24070202100144F",
        name: "load1",
        properties: {
          load1_voltA: "2300",
          load1_voltB: "2310",
          load1_voltC: "2290",
          load1_currentA: "30",
          load1_currentB: "31",
          load1_currentC: "29",
          load1_activePowerA: "690",
          load1_activePowerB: "710",
          load1_activePowerC: "670",
          load1_frequencyA: "6000",
          load1_frequencyB: "6000",
          load1_frequencyC: "6000",
          load1_totalPower: "2070",
        },
        subDevId: "load1",
      },
    ],
    flloadList: [
      {
        deviceSn: "flload_inv1",
        fatherSn: "WKRD24070202100144F",
        name: "flload",
        properties: {
          flload_totalPower: "5200",
          flload_dailyEnergy: "185",
          flload_activePowerA: "1800",
          flload_activePowerB: "1700",
          flload_activePowerC: "1700",
        },
        subDevId: "flload",
      },
    ],
    meterList: [
      {
        deviceSn: "meter_1",
        fatherSn: "WKRD24070202100144F",
        name: "Chint-three-1",
        deviceBrand: "Meter-Chint-DTSU666Three",
        properties: {
          grid_voltA: "2300",
          grid_voltB: "2300",
          grid_voltC: "2300",
          grid_currentA: "100",
          grid_currentB: "100",
          grid_currentC: "100",
          grid_totalActivePower: "6900",
          grid_activePowerA: "2300",
          grid_activePowerB: "2300",
          grid_activePowerC: "2300",
          grid_frequency: "5000",
          grid_factor: "990",
          grid_factorA: "990",
          grid_factorB: "990",
          grid_factorC: "990",
        },
      },
    ],
  },
};

// ─── Tests ──────────────────────────────────────────────────────────────────
describe("TelemetryHandler", () => {
  let pool: import("pg").Pool;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    pool = createMockPool();
  });

  afterEach(() => {
    _destroyAssembler(pool);
    jest.useRealTimers();
  });

  it("parses timestamp from payload.timeStamp (never NOW())", async () => {
    await handleTelemetry(pool, "gw-001", "CID", FULL_TELEMETRY_PAYLOAD);
    await jest.advanceTimersByTimeAsync(100);

    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    const parsed = mockEnqueue.mock.calls[0][1];

    expect(parsed.recordedAt).toBeInstanceOf(Date);
    expect(parsed.recordedAt.getTime()).toBe(1772681002103);
  });

  it("converts all string values to numbers", async () => {
    await handleTelemetry(pool, "gw-001", "CID", FULL_TELEMETRY_PAYLOAD);
    await jest.advanceTimersByTimeAsync(100);

    const parsed = mockEnqueue.mock.calls[0][1];

    expect(typeof parsed.batterySoc).toBe("number");
    expect(parsed.batterySoc).toBe(75.5);
    expect(typeof parsed.batteryPowerKw).toBe("number");
    expect(parsed.batteryPowerKw).toBe(-3.2);
    expect(typeof parsed.gridPowerKw).toBe("number");
    expect(parsed.gridPowerKw).toBe(3.45);
    expect(typeof parsed.pvPowerKw).toBe("number");
    expect(parsed.pvPowerKw).toBe(6.342);
    expect(typeof parsed.loadPowerKw).toBe("number");
    expect(parsed.loadPowerKw).toBe(2.07);
    expect(typeof parsed.flloadPowerKw).toBe("number");
    expect(parsed.flloadPowerKw).toBe(5.2);
  });

  it("handles total_bat_vlotage typo -> batteryVoltage", async () => {
    await handleTelemetry(pool, "gw-001", "CID", FULL_TELEMETRY_PAYLOAD);
    await jest.advanceTimersByTimeAsync(100);

    const parsed = mockEnqueue.mock.calls[0][1];
    expect(parsed.batteryVoltage).toBeCloseTo(51.6, 5);
  });

  it("builds telemetry_extra JSONB with per-phase fields", async () => {
    await handleTelemetry(pool, "gw-001", "CID", FULL_TELEMETRY_PAYLOAD);
    await jest.advanceTimersByTimeAsync(100);

    const parsed = mockEnqueue.mock.calls[0][1];
    const extra = parsed.telemetryExtra;

    expect(extra).not.toBeNull();

    // Grid per-phase (voltages/currents scaled ×0.1, power W stays W via scalePowerW)
    expect(extra.grid.volt_a).toBe(230);
    expect(extra.grid.volt_b).toBe(231);
    expect(extra.grid.current_a).toBeCloseTo(5.1, 5);
    expect(extra.grid.total_reactive_power).toBe(150);
    expect(extra.grid.total_apparent_power).toBe(3465);
    expect(extra.grid.frequency).toBe(60);
    expect(extra.grid.total_buy_kwh).toBe(5000);

    // Meter per-phase (classified as meter_three via deviceBrand)
    expect(extra.meter_three.volt_a).toBe(230);
    expect(extra.meter_three.total_active_power).toBe(6900);
    expect(extra.meter_three.factor).toBe(0.99);

    // Load per-phase
    expect(extra.load.volt_a).toBe(230);
    expect(extra.load.active_power_a).toBe(690);
    expect(extra.load.frequency_a).toBe(60);

    // Flload per-phase
    expect(extra.flload.active_power_a).toBe(1800);
    expect(extra.flload.daily_energy_kwh).toBeCloseTo(18.5, 5);

    // PV MPPT (voltages/currents scaled ×0.1, power W via scalePowerW)
    expect(extra.pv.pv1_voltage).toBe(380);
    expect(extra.pv.pv1_current).toBeCloseTo(8.5, 5);
    expect(extra.pv.pv2_power).toBe(3112);
  });

  it("parses PV MPPT fields into hot-path columns", async () => {
    await handleTelemetry(pool, "gw-001", "CID", FULL_TELEMETRY_PAYLOAD);
    await jest.advanceTimersByTimeAsync(100);

    const parsed = mockEnqueue.mock.calls[0][1];
    expect(parsed.pv1Voltage).toBe(380);
    expect(parsed.pv1Current).toBeCloseTo(8.5, 5);
    expect(parsed.pv1Power).toBe(3.23);
    expect(parsed.pv2Voltage).toBe(375);
    expect(parsed.pv2Current).toBeCloseTo(8.3, 5);
    expect(parsed.pv2Power).toBe(3.112);
    expect(parsed.inverterTemp).toBeCloseTo(42.5, 5);
  });

  it("handles missing Lists gracefully (null -> 0)", async () => {
    const minimalPayload: SolfacilMessage = {
      ...FULL_TELEMETRY_PAYLOAD,
      data: {
        batList: [
          {
            deviceSn: "bat_minimal",
            name: "battery",
            properties: {
              total_bat_soc: "50",
              total_bat_power: "1000",
              total_bat_dailyChargedEnergy: "50",
              total_bat_dailyDischargedEnergy: "30",
            },
            subDevId: "battery",
          },
        ],
      },
    };

    await handleTelemetry(pool, "gw-001", "CID", minimalPayload);
    await jest.advanceTimersByTimeAsync(100);

    const parsed = mockEnqueue.mock.calls[0][1];
    expect(parsed.gridPowerKw).toBe(0);
    expect(parsed.pvPowerKw).toBe(0);
    expect(parsed.loadPowerKw).toBe(0);
    expect(parsed.flloadPowerKw).toBe(0);
    expect(parsed.inverterTemp).toBe(0);
    expect(parsed.telemetryExtra).toBeNull();
  });

  it("does not write telemetry when batList is absent (routes to assembler, no core)", async () => {
    const noBat: SolfacilMessage = {
      ...FULL_TELEMETRY_PAYLOAD,
      data: {
        gridList: FULL_TELEMETRY_PAYLOAD.data.gridList,
      },
    };

    await handleTelemetry(pool, "gw-001", "CID", noBat);
    // Wait past debounce — no core message means no telemetry write
    await jest.advanceTimersByTimeAsync(3100);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("updates device_state for real-time dashboard", async () => {
    await handleTelemetry(pool, "gw-001", "CID", FULL_TELEMETRY_PAYLOAD);
    await jest.advanceTimersByTimeAsync(100);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO device_state"),
      expect.arrayContaining(["asset-bat-001"]),
    );
  });

  it("parses BMS limits for ScheduleTranslator validation", async () => {
    await handleTelemetry(pool, "gw-001", "CID", FULL_TELEMETRY_PAYLOAD);
    await jest.advanceTimersByTimeAsync(100);

    const parsed = mockEnqueue.mock.calls[0][1];
    expect(parsed.maxChargeCurrent).toBe(25.0);
    expect(parsed.maxDischargeCurrent).toBe(25.0);
    expect(parsed.maxChargeVoltage).toBeCloseTo(57.6, 5);
  });

  // ─── PR3 new tests: classification paths ──────────────────────────────────

  it("does not discard MSG#1 (emsList) — routes to assembler", async () => {
    const emsOnly: SolfacilMessage = {
      ...FULL_TELEMETRY_PAYLOAD,
      data: {
        emsList: [
          {
            deviceSn: "WKRD24070202100144F",
            name: "ems",
            properties: { wifi_signal_dbm: "-45", uptime_seconds: "86400" },
          },
        ],
      },
    };

    await handleTelemetry(pool, "gw-001", "CID", emsOnly);
    // Wait past debounce — no core, so only ems_health written
    await jest.advanceTimersByTimeAsync(3100);

    // ems_health should be written to gateways
    const gwCall = (pool.query as jest.Mock).mock.calls.find(
      (c: unknown[]) =>
        typeof c[0] === "string" && (c[0] as string).includes("ems_health"),
    );
    expect(gwCall).toBeDefined();
    // No telemetry enqueued (no core)
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("does not discard MSG#2 (dido) — DO values reach parsed telemetry", async () => {
    const didoThenCore: SolfacilMessage = {
      ...FULL_TELEMETRY_PAYLOAD,
      data: {
        dido: {
          do: [
            { id: "DO0", type: "DO", value: "1" },
            { id: "DO1", type: "DO", value: "0" },
          ],
        },
      },
    };

    // First send dido fragment
    await handleTelemetry(pool, "gw-001", "CID", didoThenCore);

    // Then send core (batList)
    const corePayload: SolfacilMessage = {
      ...FULL_TELEMETRY_PAYLOAD,
      data: {
        batList: FULL_TELEMETRY_PAYLOAD.data.batList,
        gridList: FULL_TELEMETRY_PAYLOAD.data.gridList,
        pvList: FULL_TELEMETRY_PAYLOAD.data.pvList,
      },
    };
    await handleTelemetry(pool, "gw-001", "CID", corePayload);
    await jest.advanceTimersByTimeAsync(100);

    const parsed = mockEnqueue.mock.calls[0][1];
    expect(parsed.do0Active).toBe(true);
    expect(parsed.do1Active).toBe(false);
  });

  it("does not discard MSG#3/4 (meterList) — meters reach telemetryExtra", async () => {
    const meterSingle: SolfacilMessage = {
      ...FULL_TELEMETRY_PAYLOAD,
      data: {
        meterList: [
          {
            deviceSn: "Meter-Single",
            name: "Chint-single-1",
            deviceBrand: "Meter-Chint-DTSU666Single",
            properties: { grid_voltA: "2280", grid_activePowerA: "500" },
          },
        ],
      },
    };

    await handleTelemetry(pool, "gw-001", "CID", meterSingle);

    // Then send core
    const corePayload: SolfacilMessage = {
      ...FULL_TELEMETRY_PAYLOAD,
      data: {
        batList: FULL_TELEMETRY_PAYLOAD.data.batList,
      },
    };
    await handleTelemetry(pool, "gw-001", "CID", corePayload);
    await jest.advanceTimersByTimeAsync(100);

    const parsed = mockEnqueue.mock.calls[0][1];
    expect(parsed.telemetryExtra!.meter_single).toBeDefined();
    expect(parsed.telemetryExtra!.meter_single.volt_a).toBe(228);
  });

  it("MSG#5 alone behaves identically to pre-refactor", async () => {
    // Core-only message (same as pre-refactor "full" message minus meter)
    const coreOnly: SolfacilMessage = {
      ...FULL_TELEMETRY_PAYLOAD,
      data: {
        batList: FULL_TELEMETRY_PAYLOAD.data.batList,
        gridList: FULL_TELEMETRY_PAYLOAD.data.gridList,
        pvList: FULL_TELEMETRY_PAYLOAD.data.pvList,
        loadList: FULL_TELEMETRY_PAYLOAD.data.loadList,
        flloadList: FULL_TELEMETRY_PAYLOAD.data.flloadList,
      },
    };

    await handleTelemetry(pool, "gw-001", "CID", coreOnly);
    await jest.advanceTimersByTimeAsync(100);

    const parsed = mockEnqueue.mock.calls[0][1];
    expect(parsed.batterySoc).toBe(75.5);
    expect(parsed.gridPowerKw).toBe(3.45);
    expect(parsed.pvPowerKw).toBe(6.342);
    // DO defaults to false when no dido fragment present
    expect(parsed.do0Active).toBe(false);
    expect(parsed.do1Active).toBe(false);
  });
});

describe("safeFloat", () => {
  it("returns 0 for undefined", () => {
    expect(safeFloat(undefined)).toBe(0);
  });

  it("returns 0 for empty string", () => {
    expect(safeFloat("")).toBe(0);
  });

  it("returns 0 for NaN string", () => {
    expect(safeFloat("not_a_number")).toBe(0);
  });

  it("returns 0 for Infinity", () => {
    expect(safeFloat("Infinity")).toBe(0);
  });

  it("parses valid number string", () => {
    expect(safeFloat("42.5")).toBe(42.5);
  });

  it("parses negative number", () => {
    expect(safeFloat("-3.2")).toBe(-3.2);
  });
});
