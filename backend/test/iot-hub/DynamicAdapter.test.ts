/**
 * DynamicAdapter — Phase 6.4 Step 2
 * 測試動態解析引擎：getNestedValue + DynamicAdapter 核心解析邏輯
 */
import { getNestedValue, DynamicAdapter } from "../../src/iot-hub/parsers/DynamicAdapter";
import { type ParserRule } from "../../src/shared/types/api";

// ---------------------------------------------------------------------------
// getNestedValue
// ---------------------------------------------------------------------------

describe("getNestedValue", () => {
  const obj = {
    a: { b: { c: 42 } },
    data: {
      batList: [
        { bat_soc: 80, id: "BAT_001" },
        { bat_soc: 65, id: "BAT_002" },
      ],
      power: 5.5,
    },
    zero: 0,
    empty: "",
    flag: false,
  };

  it("resolves dot-notation path (a.b.c)", () => {
    expect(getNestedValue(obj as Record<string, unknown>, "a.b.c")).toBe(42);
  });

  it("resolves single-level key (data.power)", () => {
    expect(getNestedValue(obj as Record<string, unknown>, "data.power")).toBe(5.5);
  });

  it("resolves bracket notation [0] (data.batList[0].bat_soc)", () => {
    expect(getNestedValue(obj as Record<string, unknown>, "data.batList[0].bat_soc")).toBe(80);
  });

  it("resolves bracket notation [1] (data.batList[1].id)", () => {
    expect(getNestedValue(obj as Record<string, unknown>, "data.batList[1].id")).toBe("BAT_002");
  });

  it("returns undefined when intermediate key is missing", () => {
    expect(getNestedValue(obj as Record<string, unknown>, "a.x.c")).toBeUndefined();
  });

  it("returns undefined for entirely wrong path", () => {
    expect(getNestedValue(obj as Record<string, unknown>, "nonexistent.path")).toBeUndefined();
  });

  it("returns undefined when traversing a non-object (a.b.c.d)", () => {
    expect(getNestedValue(obj as Record<string, unknown>, "a.b.c.d")).toBeUndefined();
  });

  it("returns 0 for zero-value number", () => {
    expect(getNestedValue(obj as Record<string, unknown>, "zero")).toBe(0);
  });

  it("returns false for boolean false", () => {
    expect(getNestedValue(obj as Record<string, unknown>, "flag")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DynamicAdapter — Non-iterator mode
// ---------------------------------------------------------------------------

describe("DynamicAdapter — non-iterator mode", () => {
  const adapter = new DynamicAdapter();

  const GATEWAY_PAYLOAD: Record<string, unknown> = {
    deviceId: "INVERTER_001",
    orgId: "ORG_ENERGIA_001",
    properties: {
      active_power: 4800,
      battery_soc: 85.5,
      firmware_version: "3.1.4",
    },
  };

  const RULE: ParserRule = {
    parserType: "dynamic",
    mappings: {
      "metering.grid_power_kw": {
        domain: "metering",
        sourcePath: "properties.active_power",
        valueType: "number",
      },
      "status.battery_soc": {
        domain: "status",
        sourcePath: "properties.battery_soc",
        valueType: "number",
      },
      "config.firmware_version": {
        domain: "config",
        sourcePath: "properties.firmware_version",
        valueType: "string",
      },
    },
  };

  it("returns exactly 1 StandardTelemetry", () => {
    const result = adapter.parse(GATEWAY_PAYLOAD, RULE, "ORG_ENERGIA_001");
    expect(result).toHaveLength(1);
  });

  it("deviceId taken from root-level deviceId", () => {
    const result = adapter.parse(GATEWAY_PAYLOAD, RULE, "ORG_ENERGIA_001");
    expect(result[0].deviceId).toBe("INVERTER_001");
  });

  it("orgId correctly propagated", () => {
    const result = adapter.parse(GATEWAY_PAYLOAD, RULE, "ORG_ENERGIA_001");
    expect(result[0].orgId).toBe("ORG_ENERGIA_001");
  });

  it("metering container has correct numeric value", () => {
    const result = adapter.parse(GATEWAY_PAYLOAD, RULE, "ORG_ENERGIA_001");
    expect(result[0].metering?.["metering.grid_power_kw"]).toBe(4800);
  });

  it("status container has correct numeric value", () => {
    const result = adapter.parse(GATEWAY_PAYLOAD, RULE, "ORG_ENERGIA_001");
    expect(result[0].status?.["status.battery_soc"]).toBe(85.5);
  });

  it("config container has correct string value", () => {
    const result = adapter.parse(GATEWAY_PAYLOAD, RULE, "ORG_ENERGIA_001");
    expect(result[0].config?.["config.firmware_version"]).toBe("3.1.4");
  });

  it("timestamp is a valid ISO string", () => {
    const result = adapter.parse(GATEWAY_PAYLOAD, RULE, "ORG_ENERGIA_001");
    expect(() => new Date(result[0].timestamp).toISOString()).not.toThrow();
  });

  it("throws TypeError when iterator path resolves to non-array", () => {
    const badRule: ParserRule = {
      parserType: "dynamic",
      iterator: "properties.active_power",
      mappings: {},
    };
    expect(() =>
      adapter.parse(GATEWAY_PAYLOAD, badRule, "ORG_ENERGIA_001"),
    ).toThrow(TypeError);
    expect(() =>
      adapter.parse(GATEWAY_PAYLOAD, badRule, "ORG_ENERGIA_001"),
    ).toThrow(/did not resolve to an array/);
  });
});

// ---------------------------------------------------------------------------
// DynamicAdapter — Iterator mode (normal)
// ---------------------------------------------------------------------------

describe("DynamicAdapter — iterator mode (normal)", () => {
  const adapter = new DynamicAdapter();

  const GATEWAY_PAYLOAD: Record<string, unknown> = {
    orgId: "ORG_ENERGIA_001",
    gatewayId: "GW_CHINT_001",
    data: {
      batList: [
        { bat_id: "BAT_001", bat_soc: 80, bat_voltage: 52.3 },
        { bat_id: "BAT_002", bat_soc: 65, bat_voltage: 51.1 },
        { bat_id: "BAT_003", bat_soc: 90, bat_voltage: 53.0 },
      ],
    },
  };

  const RULE: ParserRule = {
    parserType: "dynamic",
    iterator: "data.batList",
    deviceIdPath: "bat_id",
    mappings: {
      "status.battery_soc": {
        domain: "status",
        sourcePath: "bat_soc",
        valueType: "number",
      },
      "metering.battery_voltage": {
        domain: "metering",
        sourcePath: "bat_voltage",
        valueType: "number",
      },
    },
  };

  it("returns N StandardTelemetry for N items in iterator array", () => {
    const result = adapter.parse(GATEWAY_PAYLOAD, RULE, "ORG_ENERGIA_001");
    expect(result).toHaveLength(3);
  });

  it("each record has correct deviceId from deviceIdPath", () => {
    const result = adapter.parse(GATEWAY_PAYLOAD, RULE, "ORG_ENERGIA_001");
    expect(result[0].deviceId).toBe("BAT_001");
    expect(result[1].deviceId).toBe("BAT_002");
    expect(result[2].deviceId).toBe("BAT_003");
  });

  it("each record has correct orgId", () => {
    const result = adapter.parse(GATEWAY_PAYLOAD, RULE, "ORG_ENERGIA_001");
    result.forEach((t) => expect(t.orgId).toBe("ORG_ENERGIA_001"));
  });

  it("each record has correct status.battery_soc", () => {
    const result = adapter.parse(GATEWAY_PAYLOAD, RULE, "ORG_ENERGIA_001");
    expect(result[0].status?.["status.battery_soc"]).toBe(80);
    expect(result[1].status?.["status.battery_soc"]).toBe(65);
    expect(result[2].status?.["status.battery_soc"]).toBe(90);
  });

  it("each record has correct metering.battery_voltage", () => {
    const result = adapter.parse(GATEWAY_PAYLOAD, RULE, "ORG_ENERGIA_001");
    expect(result[0].metering?.["metering.battery_voltage"]).toBe(52.3);
    expect(result[1].metering?.["metering.battery_voltage"]).toBe(51.1);
    expect(result[2].metering?.["metering.battery_voltage"]).toBe(53.0);
  });

  it("uses array index as deviceId when deviceIdPath is NOT specified", () => {
    const ruleNoIdPath: ParserRule = {
      parserType: "dynamic",
      iterator: "data.batList",
      mappings: {
        "status.battery_soc": {
          domain: "status",
          sourcePath: "bat_soc",
          valueType: "number",
        },
      },
    };
    const result = adapter.parse(GATEWAY_PAYLOAD, ruleNoIdPath, "ORG_ENERGIA_001");
    expect(result).toHaveLength(3);
    expect(result[0].deviceId).toBe("0");
    expect(result[1].deviceId).toBe("1");
    expect(result[2].deviceId).toBe("2");
  });
});

// ---------------------------------------------------------------------------
// DynamicAdapter — Iterator mode (防線: missing device ID)
// ---------------------------------------------------------------------------

describe("DynamicAdapter — iterator mode (missing device ID guard)", () => {
  const adapter = new DynamicAdapter();

  it("SKIPS records where deviceIdPath resolves to undefined — no phantom IDs", () => {
    const payload: Record<string, unknown> = {
      data: {
        batList: [
          { bat_id: "BAT_001", bat_soc: 80 },
          { bat_soc: 65 }, // missing bat_id → SKIPPED
          { bat_id: "BAT_003", bat_soc: 90 },
        ],
      },
    };
    const rule: ParserRule = {
      parserType: "dynamic",
      iterator: "data.batList",
      deviceIdPath: "bat_id",
      mappings: {
        "status.battery_soc": { domain: "status", sourcePath: "bat_soc", valueType: "number" },
      },
    };

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const result = adapter.parse(payload, rule, "ORG_ENERGIA_001");
    warnSpy.mockRestore();

    expect(result).toHaveLength(2);
    expect(result[0].deviceId).toBe("BAT_001");
    expect(result[1].deviceId).toBe("BAT_003");
    result.forEach((t) => {
      expect(t.deviceId).not.toMatch(/^\d+$/); // 絕不是純數字假 ID
    });
  });

  it("SKIPS records where deviceIdPath resolves to null", () => {
    const payload: Record<string, unknown> = {
      data: {
        batList: [
          { bat_id: null, bat_soc: 72 },
          { bat_id: "BAT_VALID", bat_soc: 88 },
        ],
      },
    };
    const rule: ParserRule = {
      parserType: "dynamic",
      iterator: "data.batList",
      deviceIdPath: "bat_id",
      mappings: {
        "status.battery_soc": { domain: "status", sourcePath: "bat_soc", valueType: "number" },
      },
    };

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const result = adapter.parse(payload, rule, "ORG_ENERGIA_001");
    warnSpy.mockRestore();

    expect(result).toHaveLength(1);
    expect(result[0].deviceId).toBe("BAT_VALID");
  });

  it("SKIPS records where deviceIdPath resolves to empty string", () => {
    const payload: Record<string, unknown> = {
      data: {
        batList: [
          { bat_id: "", bat_soc: 55 },
          { bat_id: "BAT_REAL", bat_soc: 77 },
        ],
      },
    };
    const rule: ParserRule = {
      parserType: "dynamic",
      iterator: "data.batList",
      deviceIdPath: "bat_id",
      mappings: {
        "status.battery_soc": { domain: "status", sourcePath: "bat_soc", valueType: "number" },
      },
    };

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const result = adapter.parse(payload, rule, "ORG_ENERGIA_001");
    warnSpy.mockRestore();

    expect(result).toHaveLength(1);
    expect(result[0].deviceId).toBe("BAT_REAL");
  });

  it("prints console.warn for each skipped record", () => {
    const payload: Record<string, unknown> = {
      data: {
        batList: [{ bat_soc: 55 }, { bat_soc: 77 }],
      },
    };
    const rule: ParserRule = {
      parserType: "dynamic",
      iterator: "data.batList",
      deviceIdPath: "bat_id",
      mappings: {},
    };

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const result = adapter.parse(payload, rule, "ORG_ENERGIA_001");

    expect(result).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
  });

  it("returns empty array (not crash) when ALL records are skipped", () => {
    const payload: Record<string, unknown> = {
      data: { batList: [{ bat_soc: 55 }, { bat_soc: 77 }] },
    };
    const rule: ParserRule = {
      parserType: "dynamic",
      iterator: "data.batList",
      deviceIdPath: "bat_id",
      mappings: {},
    };

    jest.spyOn(console, "warn").mockImplementation(() => {});
    const result = adapter.parse(payload, rule, "ORG_ENERGIA_001");
    expect(result).toHaveLength(0);
    jest.restoreAllMocks();
  });
});
