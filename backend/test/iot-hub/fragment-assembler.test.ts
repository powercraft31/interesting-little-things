import { FragmentAssembler } from "../../src/iot-hub/services/fragment-assembler";
import type { SolfacilMessage } from "../../src/shared/types/solfacil-protocol";
import type { ParsedTelemetry } from "../../src/shared/types/telemetry";

// ─── Mock DeviceAssetCache ──────────────────────────────────────────────────
jest.mock("../../src/iot-hub/services/device-asset-cache", () => ({
  DeviceAssetCache: jest.fn().mockImplementation(() => ({
    resolve: jest.fn().mockResolvedValue("asset-inv-001"),
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
  } as any;
}

// ─── Test Fixtures ──────────────────────────────────────────────────────────
// All raw values use Protocol v1.8 integer format.
// Scaling: voltage ×0.1, current ×0.1, temp ×0.1, freq ×0.01, energy ×0.1, power W→kW (/1000)
const CLIENT_ID = "WKRD24070202100144F";
const TIMESTAMP = "1772681002103";

function makeEnvelope(data: Record<string, unknown>): SolfacilMessage {
  return {
    DS: 0,
    ackFlag: 0,
    clientId: CLIENT_ID,
    deviceName: "EMS_N2",
    productKey: "ems",
    messageId: "12345",
    timeStamp: TIMESTAMP,
    data,
  };
}

const MSG1_EMS = makeEnvelope({
  emsList: [
    {
      deviceSn: CLIENT_ID,
      name: "ems",
      properties: {
        firmware_version: "2.1.0",
        wifi_signal_dbm: "-45",
        uptime_seconds: "86400",
        error_codes: "",
      },
    },
  ],
});

const MSG2_DIDO = makeEnvelope({
  dido: {
    do: [
      { id: "DO0", type: "DO", value: "1" },
      { id: "DO1", type: "DO", value: "0" },
    ],
    di: [
      { id: "DI0", type: "DI", value: "0" },
      { id: "DI1", type: "DI", value: "1" },
    ],
  },
});

const MSG3_METER_SINGLE = makeEnvelope({
  meterList: [
    {
      deviceSn: "Meter-Chint-Single_" + CLIENT_ID,
      fatherSn: CLIENT_ID,
      name: "Chint-single-1",
      deviceBrand: "Meter-Chint-DTSU666Single",
      properties: {
        connectStatus: "online",
        grid_activePowerA: "500",
        grid_currentA: "22",
        grid_factorA: "0.99",
        grid_frequency: "6000",
        grid_reactivePowerA: "10",
        grid_voltA: "2280",
      },
    },
  ],
});

const MSG4_METER_THREE = makeEnvelope({
  meterList: [
    {
      deviceSn: "Meter-Chint-Three_" + CLIENT_ID,
      fatherSn: CLIENT_ID,
      name: "Chint-three-1",
      deviceBrand: "Meter-Chint-DTSU666Three",
      properties: {
        connectStatus: "online",
        grid_voltA: "2300",
        grid_voltB: "2310",
        grid_voltC: "2290",
        grid_currentA: "100",
        grid_currentB: "100",
        grid_currentC: "100",
        grid_totalActivePower: "6900",
        grid_activePowerA: "2300",
        grid_activePowerB: "2300",
        grid_activePowerC: "2300",
        grid_frequency: "5000",
        grid_factor: "0.99",
        grid_factorA: "0.99",
        grid_factorB: "0.99",
        grid_factorC: "0.99",
      },
    },
  ],
});

const MSG5_CORE = makeEnvelope({
  batList: [
    {
      deviceSn: "battery_inv1_" + CLIENT_ID,
      fatherSn: CLIENT_ID,
      name: "battery",
      properties: {
        total_bat_soc: "75.5",
        total_bat_power: "-3200",
        total_bat_dailyChargedEnergy: "125",
        total_bat_dailyDischargedEnergy: "83",
        total_bat_soh: "98.2",
        total_bat_vlotage: "516",
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
      deviceSn: "grid_inv1",
      fatherSn: CLIENT_ID,
      name: "grid",
      properties: {
        grid_voltA: "2300",
        grid_voltB: "2310",
        grid_voltC: "2290",
        grid_totalActivePower: "3450",
        grid_dailyBuyEnergy: "153",
        grid_dailySellEnergy: "21",
        grid_temp: "425",
      },
      subDevId: "grid",
    },
  ],
  pvList: [
    {
      deviceSn: "pv_inv1",
      fatherSn: CLIENT_ID,
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
      fatherSn: CLIENT_ID,
      name: "pv1",
      properties: { pv1_voltage: "3800", pv1_current: "85", pv1_power: "3230" },
      subDevId: "pv1",
    },
    {
      deviceSn: "pv2_inv1",
      fatherSn: CLIENT_ID,
      name: "pv2",
      properties: { pv2_voltage: "3750", pv2_current: "83", pv2_power: "3112" },
      subDevId: "pv2",
    },
  ],
  loadList: [
    {
      deviceSn: "load1_inv1",
      fatherSn: CLIENT_ID,
      name: "load1",
      properties: { load1_totalPower: "2070" },
      subDevId: "load1",
    },
  ],
  flloadList: [
    {
      deviceSn: "flload_inv1",
      fatherSn: CLIENT_ID,
      name: "flload",
      properties: { flload_totalPower: "5200" },
      subDevId: "flload",
    },
  ],
});

// ─── Tests ──────────────────────────────────────────────────────────────────
describe("FragmentAssembler", () => {
  let assembler: FragmentAssembler;
  let pool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    pool = createMockPool();
    assembler = new FragmentAssembler(pool, 3000);
  });

  afterEach(() => {
    assembler.destroy();
    jest.useRealTimers();
  });

  describe("5 fragments merge correctly", () => {
    it("merges all 5 messages and writes telemetry_history + ems_health", async () => {
      // Feed MSG#1 through MSG#4
      assembler.receive(CLIENT_ID, MSG1_EMS);
      assembler.receive(CLIENT_ID, MSG2_DIDO);
      assembler.receive(CLIENT_ID, MSG3_METER_SINGLE);
      assembler.receive(CLIENT_ID, MSG4_METER_THREE);
      // Feed MSG#5 (core) — should trigger immediate flush
      assembler.receive(CLIENT_ID, MSG5_CORE);

      // Allow async flush to complete
      await jest.advanceTimersByTimeAsync(100);

      // Verify ems_health was written to gateways
      const gwUpdateCall = pool.query.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === "string" && (c[0] as string).includes("gateways"),
      );
      expect(gwUpdateCall).toBeDefined();
      expect(gwUpdateCall![0]).toContain("ems_health");

      // Verify telemetry was enqueued via MessageBuffer
      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      const parsed: ParsedTelemetry = mockEnqueue.mock.calls[0][1];

      // Battery from MSG#5 (SOC ×1, power W→kW)
      expect(parsed.batterySoc).toBe(75.5);
      expect(parsed.batteryPowerKw).toBe(-3.2);

      // DO0/DO1 from MSG#2 (not hardcoded false!)
      expect(parsed.do0Active).toBe(true);
      expect(parsed.do1Active).toBe(false);

      // Grid from MSG#5 (W→kW)
      expect(parsed.gridPowerKw).toBe(3.45);

      // PV from MSG#5 (W→kW)
      expect(parsed.pvPowerKw).toBe(6.342);
    });

    it("includes meter_single and meter_three in telemetryExtra", async () => {
      assembler.receive(CLIENT_ID, MSG3_METER_SINGLE);
      assembler.receive(CLIENT_ID, MSG4_METER_THREE);
      assembler.receive(CLIENT_ID, MSG5_CORE);

      await jest.advanceTimersByTimeAsync(100);

      const parsed: ParsedTelemetry = mockEnqueue.mock.calls[0][1];
      const extra = parsed.telemetryExtra!;

      // meter_single from MSG#3 (voltage ×0.1, power W via scalePowerW)
      expect(extra.meter_single).toBeDefined();
      expect(extra.meter_single.volt_a).toBe(228);
      expect(extra.meter_single.active_power_a).toBe(500);

      // meter_three from MSG#4
      expect(extra.meter_three).toBeDefined();
      expect(extra.meter_three.volt_a).toBe(230);
      expect(extra.meter_three.total_active_power).toBe(6900);
    });

    it("includes dido DI values in telemetryExtra", async () => {
      assembler.receive(CLIENT_ID, MSG2_DIDO);
      assembler.receive(CLIENT_ID, MSG5_CORE);

      await jest.advanceTimersByTimeAsync(100);

      const parsed: ParsedTelemetry = mockEnqueue.mock.calls[0][1];
      const extra = parsed.telemetryExtra!;
      expect(extra.dido).toBeDefined();
      expect(extra.dido.di0).toBe(0);
      expect(extra.dido.di1).toBe(1);
    });
  });

  describe("out-of-order arrival (MSG#5 arrives first)", () => {
    it("flushes core immediately; late fragments go to next cycle", async () => {
      // MSG#5 arrives first → triggers immediate flush
      assembler.receive(CLIENT_ID, MSG5_CORE);
      await jest.advanceTimersByTimeAsync(100);

      // Core flushed with default DO values (no dido in this cycle)
      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      const parsed: ParsedTelemetry = mockEnqueue.mock.calls[0][1];
      expect(parsed.batterySoc).toBe(75.5);
      expect(parsed.do0Active).toBe(false); // no dido fragment arrived before flush
      expect(parsed.do1Active).toBe(false);

      // Late fragments start a NEW accumulator cycle
      assembler.receive(CLIENT_ID, MSG1_EMS);
      assembler.receive(CLIENT_ID, MSG2_DIDO);

      // Wait for 3s debounce — no core in second cycle
      await jest.advanceTimersByTimeAsync(3100);

      // Only ems_health written in second cycle, no telemetry
      expect(mockEnqueue).toHaveBeenCalledTimes(1); // still 1

      // ems_health was written
      const gwCall = pool.query.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === "string" && (c[0] as string).includes("ems_health"),
      );
      expect(gwCall).toBeDefined();
    });

    it("merges fragments arriving before core flush completes", async () => {
      // Fragments arrive in rapid succession, then core
      assembler.receive(CLIENT_ID, MSG2_DIDO);
      assembler.receive(CLIENT_ID, MSG1_EMS);
      assembler.receive(CLIENT_ID, MSG5_CORE);

      await jest.advanceTimersByTimeAsync(100);

      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      const parsed: ParsedTelemetry = mockEnqueue.mock.calls[0][1];
      expect(parsed.batterySoc).toBe(75.5);
      expect(parsed.do0Active).toBe(true); // dido arrived before core
      expect(parsed.do1Active).toBe(false);
    });
  });

  describe("timeout debounce — MSG#5 missing", () => {
    it("writes only ems_health when core is missing after 3s", async () => {
      assembler.receive(CLIENT_ID, MSG1_EMS);
      assembler.receive(CLIENT_ID, MSG2_DIDO);
      assembler.receive(CLIENT_ID, MSG3_METER_SINGLE);

      // Wait for 3s debounce — no MSG#5
      await jest.advanceTimersByTimeAsync(3100);

      // ems_health should be written
      const gwCall = pool.query.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === "string" && (c[0] as string).includes("ems_health"),
      );
      expect(gwCall).toBeDefined();

      // telemetry_history should NOT be written (no core data)
      expect(mockEnqueue).not.toHaveBeenCalled();
    });
  });

  describe("ems_health persistence", () => {
    it("writes ems_health to gateways with device timestamp", async () => {
      assembler.receive(CLIENT_ID, MSG1_EMS);

      await jest.advanceTimersByTimeAsync(3100);

      const gwCall = pool.query.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === "string" && (c[0] as string).includes("ems_health"),
      );
      expect(gwCall).toBeDefined();
      const sql = gwCall![0] as string;
      expect(sql).toContain("UPDATE gateways");
      expect(sql).toContain("ems_health_at");

      // Params should include clientId
      const params = gwCall![1] as unknown[];
      expect(params).toContain(CLIENT_ID);
    });
  });

  describe("dido DO0/DO1 boolean conversion", () => {
    it("converts DO value '1' → true, '0' → false", async () => {
      assembler.receive(CLIENT_ID, MSG2_DIDO);
      assembler.receive(CLIENT_ID, MSG5_CORE);

      await jest.advanceTimersByTimeAsync(100);

      const parsed: ParsedTelemetry = mockEnqueue.mock.calls[0][1];
      expect(parsed.do0Active).toBe(true); // value: "1"
      expect(parsed.do1Active).toBe(false); // value: "0"
    });
  });

  describe("idempotency — duplicate fragments", () => {
    it("last-write-wins for duplicate ems messages", async () => {
      const ems2 = makeEnvelope({
        emsList: [
          {
            deviceSn: CLIENT_ID,
            name: "ems",
            properties: {
              firmware_version: "2.2.0",
              wifi_signal_dbm: "-50",
              uptime_seconds: "90000",
              error_codes: "E001",
            },
          },
        ],
      });

      assembler.receive(CLIENT_ID, MSG1_EMS);
      assembler.receive(CLIENT_ID, ems2); // duplicate/update
      assembler.receive(CLIENT_ID, MSG5_CORE);

      await jest.advanceTimersByTimeAsync(100);

      // ems_health should contain the LATEST values
      const gwCall = pool.query.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === "string" && (c[0] as string).includes("ems_health"),
      );
      expect(gwCall).toBeDefined();
      const emsPayload = JSON.parse(gwCall![1][0] as string);
      expect(emsPayload.firmware_version).toBe("2.2.0");
    });
  });

  describe("multi-gateway isolation", () => {
    it("handles fragments from different gateways independently", async () => {
      const otherClientId = "WKRD24070202100228G";
      const otherMsg5 = {
        ...MSG5_CORE,
        clientId: otherClientId,
      };

      assembler.receive(CLIENT_ID, MSG1_EMS);
      assembler.receive(otherClientId, otherMsg5);

      await jest.advanceTimersByTimeAsync(100);

      // Other gateway's core should trigger telemetry write
      expect(mockEnqueue).toHaveBeenCalledTimes(1);

      // Wait for first gateway's timeout
      await jest.advanceTimersByTimeAsync(3100);

      // First gateway had no core, so still only 1 enqueue
      expect(mockEnqueue).toHaveBeenCalledTimes(1);
    });
  });

  describe("accumulator cleanup", () => {
    it("clears accumulator after flush", async () => {
      assembler.receive(CLIENT_ID, MSG5_CORE);
      await jest.advanceTimersByTimeAsync(100);

      expect(mockEnqueue).toHaveBeenCalledTimes(1);

      // New cycle — should create fresh accumulator
      assembler.receive(CLIENT_ID, MSG5_CORE);
      await jest.advanceTimersByTimeAsync(100);

      expect(mockEnqueue).toHaveBeenCalledTimes(2);
    });
  });

  describe("ems_health written to telemetry_extra as history", () => {
    it("includes ems_health in telemetry_extra when core is present", async () => {
      assembler.receive(CLIENT_ID, MSG1_EMS);
      assembler.receive(CLIENT_ID, MSG5_CORE);

      await jest.advanceTimersByTimeAsync(100);

      const parsed: ParsedTelemetry = mockEnqueue.mock.calls[0][1];
      const extra = parsed.telemetryExtra!;
      expect(extra.ems_health).toBeDefined();
      expect(extra.ems_health.wifi_signal_dbm).toBe(-45);
    });
  });
});
