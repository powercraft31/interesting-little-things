// Mock AppConfig fetch BEFORE module imports
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Set env vars BEFORE importing handler (module-level constants captured at import time)
process.env.EVENT_BUS_NAME = "solfacil-vpp-bus";
process.env.TS_DATABASE_NAME = "solfacil_telemetry";
process.env.TS_TABLE_NAME = "device_metrics";

import { mockClient } from "aws-sdk-client-mock";
import {
  TimestreamWriteClient,
  WriteRecordsCommand,
} from "@aws-sdk/client-timestream-write";
import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";
import {
  handler,
  type TelemetryEvent,
} from "../../src/iot-hub/handlers/ingest-telemetry";
import { resolveAdapter } from "../../src/iot-hub/parsers/AdapterRegistry";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
const VALID_EVENT: TelemetryEvent = {
  orgId: "ORG_ENERGIA_001",
  deviceId: "ASSET_SP_001",
  timestamp: "2026-02-20T14:30:00.000Z",
  metrics: {
    power: 4.8,
    voltage: 220.5,
    current: 21.8,
  },
};

const VALID_EVENT_WITH_SOC: TelemetryEvent = {
  ...VALID_EVENT,
  metrics: { ...VALID_EVENT.metrics, soc: 72.5 },
};

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------
const tsMock = mockClient(TimestreamWriteClient);
const ebMock = mockClient(EventBridgeClient);

beforeEach(() => {
  tsMock.reset();
  tsMock.on(WriteRecordsCommand).resolves({});
  ebMock.reset();
  ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0 });
  // AppConfig returns empty rules → falls back to existing logic
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  process.env.TS_DATABASE_NAME = "solfacil_telemetry";
  process.env.TS_TABLE_NAME = "device_metrics";
  process.env.EVENT_BUS_NAME = "solfacil-vpp-bus";
  jest.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.TS_DATABASE_NAME;
  delete process.env.TS_TABLE_NAME;
  delete process.env.EVENT_BUS_NAME;
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("ingest-telemetry handler", () => {
  // ---- Happy path ---------------------------------------------------------
  describe("happy path", () => {
    it("calls WriteRecordsCommand with correct Dimensions", async () => {
      await handler(VALID_EVENT);

      const calls = tsMock.commandCalls(WriteRecordsCommand);
      expect(calls).toHaveLength(1);

      const dimensions = calls[0].args[0].input.Records![0].Dimensions;
      expect(dimensions).toEqual(
        expect.arrayContaining([
          { Name: "orgId", Value: "ORG_ENERGIA_001" },
          { Name: "deviceId", Value: "ASSET_SP_001" },
        ]),
      );
    });

    it("calls WriteRecordsCommand with correct MeasureValues (power, voltage, current)", async () => {
      await handler(VALID_EVENT);

      const calls = tsMock.commandCalls(WriteRecordsCommand);
      const measureValues = calls[0].args[0].input.Records![0].MeasureValues;

      expect(measureValues).toEqual(
        expect.arrayContaining([
          { Name: "power", Value: "4.8", Type: "DOUBLE" },
          { Name: "voltage", Value: "220.5", Type: "DOUBLE" },
          { Name: "current", Value: "21.8", Type: "DOUBLE" },
        ]),
      );
    });

    it("includes soc in MeasureValues when provided", async () => {
      await handler(VALID_EVENT_WITH_SOC);

      const calls = tsMock.commandCalls(WriteRecordsCommand);
      const measureValues = calls[0].args[0].input.Records![0].MeasureValues;

      expect(measureValues).toEqual(
        expect.arrayContaining([
          { Name: "soc", Value: "72.5", Type: "DOUBLE" },
        ]),
      );
      expect(measureValues).toHaveLength(4);
    });

    it("omits soc from MeasureValues when not provided", async () => {
      await handler(VALID_EVENT);

      const calls = tsMock.commandCalls(WriteRecordsCommand);
      const measureValues = calls[0].args[0].input.Records![0].MeasureValues;

      expect(measureValues).toHaveLength(3);
      expect(measureValues!.map((m) => m.Name)).not.toContain("soc");
    });

    it("converts timestamp to milliseconds string", async () => {
      await handler(VALID_EVENT);

      const calls = tsMock.commandCalls(WriteRecordsCommand);
      const record = calls[0].args[0].input.Records![0];

      const expectedMs = String(new Date("2026-02-20T14:30:00.000Z").getTime());
      expect(record.Time).toBe(expectedMs);
      expect(record.TimeUnit).toBe("MILLISECONDS");
    });

    it("sets MeasureValueType to MULTI and MeasureName to telemetry", async () => {
      await handler(VALID_EVENT);

      const calls = tsMock.commandCalls(WriteRecordsCommand);
      const record = calls[0].args[0].input.Records![0];

      expect(record.MeasureValueType).toBe("MULTI");
      expect(record.MeasureName).toBe("telemetry");
    });

    it("sends correct DatabaseName and TableName from env", async () => {
      await handler(VALID_EVENT);

      const calls = tsMock.commandCalls(WriteRecordsCommand);
      const input = calls[0].args[0].input;

      expect(input.DatabaseName).toBe("solfacil_telemetry");
      expect(input.TableName).toBe("device_metrics");
    });

    it("returns success with recordsWritten and traceId", async () => {
      const result = await handler(VALID_EVENT);

      expect(result.success).toBe(true);
      expect(result.recordsWritten).toBe(1);
      expect(result.traceId).toMatch(/^vpp-[0-9a-f-]{36}$/);
    });
  });

  // ---- Validation ---------------------------------------------------------
  describe("validation", () => {
    it("throws when orgId is missing", async () => {
      const badEvent = { ...VALID_EVENT, orgId: "" } as TelemetryEvent;

      await expect(handler(badEvent)).rejects.toThrow(
        "Missing required field: orgId",
      );

      expect(tsMock.commandCalls(WriteRecordsCommand)).toHaveLength(0);
    });

    it("throws when deviceId is missing", async () => {
      const badEvent = { ...VALID_EVENT, deviceId: "" } as TelemetryEvent;

      await expect(handler(badEvent)).rejects.toThrow(
        "Missing required field: deviceId",
      );

      expect(tsMock.commandCalls(WriteRecordsCommand)).toHaveLength(0);
    });
  });

  // ---- Error propagation --------------------------------------------------
  describe("Timestream write failure", () => {
    it("re-throws the original Timestream error", async () => {
      const tsError = new Error("ThrottlingException: rate exceeded");
      tsMock.on(WriteRecordsCommand).rejects(tsError);

      await expect(handler(VALID_EVENT)).rejects.toThrow(
        "ThrottlingException: rate exceeded",
      );
    });
  });

  // ---- ACL: Anti-Corruption Layer -----------------------------------------
  describe("ACL normalization", () => {
    it("normalizes Huawei FusionSolar payload (W → kW)", async () => {
      const huaweiEvent = {
        orgId: "ORG_ENERGIA_001",
        devSn: "INVERTER_HW_001",
        collectTime: new Date("2026-02-20T14:30:00.000Z").getTime(),
        dataItemMap: { active_power: 100000, battery_soc: 85 },
      };

      await handler(huaweiEvent);

      const calls = tsMock.commandCalls(WriteRecordsCommand);
      expect(calls).toHaveLength(1);

      const record = calls[0].args[0].input.Records![0];

      // deviceId mapped from devSn
      expect(record.Dimensions).toEqual(
        expect.arrayContaining([
          { Name: "deviceId", Value: "INVERTER_HW_001" },
          { Name: "orgId", Value: "ORG_ENERGIA_001" },
        ]),
      );

      // power: 100000 W → 100 kW
      expect(record.MeasureValues).toEqual(
        expect.arrayContaining([
          { Name: "power", Value: "100", Type: "DOUBLE" },
          { Name: "soc", Value: "85", Type: "DOUBLE" },
        ]),
      );

      // timestamp: Unix ms → ISO → back to ms string
      const expectedMs = String(new Date("2026-02-20T14:30:00.000Z").getTime());
      expect(record.Time).toBe(expectedMs);
    });

    it("normalizes native MQTT flat payload (power passthrough)", async () => {
      const mqttEvent = {
        orgId: "ORG_ENERGIA_001",
        deviceId: "ASSET_SP_001",
        power: 5.0,
        voltage: 220,
      };

      await handler(mqttEvent);

      const calls = tsMock.commandCalls(WriteRecordsCommand);
      expect(calls).toHaveLength(1);

      const measureValues = calls[0].args[0].input.Records![0].MeasureValues;
      expect(measureValues).toEqual(
        expect.arrayContaining([
          { Name: "power", Value: "5", Type: "DOUBLE" },
          { Name: "voltage", Value: "220", Type: "DOUBLE" },
        ]),
      );
    });

    it("resolveAdapter throws for unrecognized payload format", () => {
      expect(() => resolveAdapter({ foo: "bar" })).toThrow(
        "No adapter found for telemetry payload",
      );
    });
  });

  // ---- traceId & EventBridge integration ----------------------------------
  describe("traceId & EventBridge", () => {
    it("returns traceId in result", async () => {
      const result = await handler(VALID_EVENT);
      expect(result.traceId).toMatch(/^vpp-[0-9a-f-]{36}$/);
    });

    it("publishes TelemetryIngested event with traceId to EventBridge", async () => {
      await handler(VALID_EVENT);
      const calls = ebMock.commandCalls(PutEventsCommand);
      expect(calls).toHaveLength(1);
      const detail = JSON.parse(calls[0].args[0].input.Entries![0].Detail!);
      expect(detail.traceId).toMatch(/^vpp-[0-9a-f-]{36}$/);
      expect(detail.orgId).toBe("ORG_ENERGIA_001");
      expect(detail.deviceId).toBe("ASSET_SP_001");
    });

    it("uses AppConfig dynamic mapping when parser rule is available", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ORG_ENERGIA_001: {
            huawei: {
              mappingRule: { devSn: "deviceId", p: "power", ts: "timestamp" },
              unitConversions: { power: { factor: 0.001 } }, // W → kW
            },
          },
        }),
      });

      const huaweiEvent = {
        orgId: "ORG_ENERGIA_001",
        manufacturer: "huawei",
        devSn: "HW_DEVICE_001",
        p: 5000, // W
        ts: "2026-02-21T06:00:00.000Z",
      };

      const result = await handler(huaweiEvent);
      expect(result.success).toBe(true);
      expect(result.recordsWritten).toBe(1);

      // Verify dynamic mapping was applied: power should be 5000 * 0.001 = 5 kW
      const calls = tsMock.commandCalls(WriteRecordsCommand);
      const measureValues = calls[0].args[0].input.Records![0].MeasureValues;
      const powerValue = measureValues?.find((mv) => mv.Name === "power");
      expect(Number(powerValue?.Value)).toBeCloseTo(5, 1);
    });
  });
});
