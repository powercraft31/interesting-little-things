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
          total_bat_dailyChargedEnergy: "12.5",
          total_bat_dailyDischargedEnergy: "8.3",
          total_bat_soh: "98.2",
          total_bat_vlotage: "51.6", // typo in protocol
          total_bat_current: "-6.2",
          total_bat_temperature: "28.5",
          total_bat_maxChargeVoltage: "57.6",
          total_bat_maxChargeCurrent: "25.0",
          total_bat_maxDischargeCurrent: "25.0",
          total_bat_totalChargedEnergy: "1250.8",
          total_bat_totalDischargedEnergy: "1180.3",
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
          grid_voltA: "230",
          grid_voltB: "231",
          grid_voltC: "229",
          grid_currentA: "5.1",
          grid_currentB: "5.2",
          grid_currentC: "4.9",
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
          grid_factorA: "0.99",
          grid_factorB: "0.98",
          grid_factorC: "0.99",
          grid_frequency: "60",
          grid_dailyBuyEnergy: "15.3",
          grid_dailySellEnergy: "2.1",
          grid_totalBuyEnergy: "5000",
          grid_totalSellEnergy: "200",
          grid_temp: "42.5",
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
          pv_totalEnergy: "12345",
          pv_dailyEnergy: "18.5",
        },
        subDevId: "pv",
      },
      {
        deviceSn: "pv1_inv1",
        fatherSn: "WKRD24070202100144F",
        name: "pv1",
        properties: {
          pv1_voltage: "380",
          pv1_current: "8.5",
          pv1_power: "3230",
        },
        subDevId: "pv1",
      },
      {
        deviceSn: "pv2_inv1",
        fatherSn: "WKRD24070202100144F",
        name: "pv2",
        properties: {
          pv2_voltage: "375",
          pv2_current: "8.3",
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
          load1_voltA: "230",
          load1_voltB: "231",
          load1_voltC: "229",
          load1_currentA: "3.0",
          load1_currentB: "3.1",
          load1_currentC: "2.9",
          load1_activePowerA: "690",
          load1_activePowerB: "710",
          load1_activePowerC: "670",
          load1_frequencyA: "60",
          load1_frequencyB: "60",
          load1_frequencyC: "60",
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
          flload_dailyEnergy: "18.5",
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
          grid_voltA: "230",
          grid_voltB: "230",
          grid_voltC: "230",
          grid_currentA: "10",
          grid_currentB: "10",
          grid_currentC: "10",
          grid_totalActivePower: "6900",
          grid_activePowerA: "2300",
          grid_activePowerB: "2300",
          grid_activePowerC: "2300",
          grid_frequency: "50",
          grid_factor: "0.99",
          grid_factorA: "0.99",
          grid_factorB: "0.99",
          grid_factorC: "0.99",
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
    expect(parsed.batteryPowerKw).toBe(-3200);
    expect(typeof parsed.gridPowerKw).toBe("number");
    expect(parsed.gridPowerKw).toBe(3450);
    expect(typeof parsed.pvPowerKw).toBe("number");
    expect(parsed.pvPowerKw).toBe(6342);
    expect(typeof parsed.loadPowerKw).toBe("number");
    expect(parsed.loadPowerKw).toBe(2070);
    expect(typeof parsed.flloadPowerKw).toBe("number");
    expect(parsed.flloadPowerKw).toBe(5200);
  });

  it("handles total_bat_vlotage typo -> batteryVoltage", async () => {
    await handleTelemetry(pool, "gw-001", "CID", FULL_TELEMETRY_PAYLOAD);
    await jest.advanceTimersByTimeAsync(100);

    const parsed = mockEnqueue.mock.calls[0][1];
    expect(parsed.batteryVoltage).toBe(51.6);
  });

  it("builds telemetry_extra JSONB with per-phase fields", async () => {
    await handleTelemetry(pool, "gw-001", "CID", FULL_TELEMETRY_PAYLOAD);
    await jest.advanceTimersByTimeAsync(100);

    const parsed = mockEnqueue.mock.calls[0][1];
    const extra = parsed.telemetryExtra;

    expect(extra).not.toBeNull();

    // Grid per-phase
    expect(extra.grid.volt_a).toBe(230);
    expect(extra.grid.volt_b).toBe(231);
    expect(extra.grid.current_a).toBe(5.1);
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
    expect(extra.flload.daily_energy_kwh).toBe(18.5);

    // PV MPPT
    expect(extra.pv.pv1_voltage).toBe(380);
    expect(extra.pv.pv1_current).toBe(8.5);
    expect(extra.pv.pv2_power).toBe(3112);
  });

  it("parses PV MPPT fields into hot-path columns", async () => {
    await handleTelemetry(pool, "gw-001", "CID", FULL_TELEMETRY_PAYLOAD);
    await jest.advanceTimersByTimeAsync(100);

    const parsed = mockEnqueue.mock.calls[0][1];
    expect(parsed.pv1Voltage).toBe(380);
    expect(parsed.pv1Current).toBe(8.5);
    expect(parsed.pv1Power).toBe(3230);
    expect(parsed.pv2Voltage).toBe(375);
    expect(parsed.pv2Current).toBe(8.3);
    expect(parsed.pv2Power).toBe(3112);
    expect(parsed.inverterTemp).toBe(42.5);
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
              total_bat_dailyChargedEnergy: "5",
              total_bat_dailyDischargedEnergy: "3",
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
    expect(parsed.maxChargeVoltage).toBe(57.6);
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
            properties: { grid_voltA: "228", grid_activePowerA: "500" },
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
    expect(parsed.gridPowerKw).toBe(3450);
    expect(parsed.pvPowerKw).toBe(6342);
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
