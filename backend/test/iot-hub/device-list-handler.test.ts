import { handleDeviceList } from "../../src/iot-hub/handlers/device-list-handler";
import type { SolfacilMessage } from "../../src/shared/types/solfacil-protocol";

// ─── Mock Pool ──────────────────────────────────────────────────────────────
function createMockPool() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const queryResults = new Map<string, { rows: unknown[] }>();

  const queryFn = jest.fn(async (sql: string, params?: unknown[]) => {
    queries.push({ sql, params: params ?? [] });
    // Gateway lookup
    if (sql.includes("FROM gateways WHERE")) {
      return queryResults.get("gateways") ?? {
        rows: [{ org_id: "org-solfacil", home_id: "home-1" }],
      };
    }
    // Active assets lookup for soft-delete reconciliation
    if (sql.includes("FROM assets") && sql.includes("is_active = true")) {
      return queryResults.get("active_assets") ?? { rows: [] };
    }
    // Default: INSERT/UPDATE returns empty
    return { rows: [], rowCount: 1 };
  });

  return {
    query: queryFn,
    queries,
    setResult: (key: string, result: { rows: unknown[] }) => {
      queryResults.set(key, result);
    },
  };
}

// ─── Fixtures ───────────────────────────────────────────────────────────────
const DEVICE_LIST_PAYLOAD: SolfacilMessage = {
  DS: 0,
  ackFlag: 0,
  clientId: "WKRD24070202100144F",
  deviceName: "EMS_N2",
  productKey: "ems",
  messageId: "74881979540",
  timeStamp: "1773021874882",
  data: {
    deviceList: [
      {
        bindStatus: true,
        connectStatus: "online",
        deviceBrand: "Meter-Chint-DTSU666Three",
        deviceSn: "Meter-Chint-DTSU666Three1772421079_WKRD24070202100144F",
        fatherSn: "WKRD24070202100144F",
        name: "Chint-three-1",
        nodeType: "major",
        productType: "meter",
        vendor: "Chint",
        modelId: "Meter-Chint-DTSU666Three",
        portName: "RS485-1",
        protocolAddr: "01",
        subDevId: "Meter-Chint-DTSU666Three1772421079",
        subDevIntId: 1,
      },
      {
        bindStatus: true,
        connectStatus: "online",
        deviceBrand: "inverter-goodwe-Energystore",
        deviceSn: "inverter-goodwe-Energystore1772433273_WKRD24070202100144F",
        fatherSn: "WKRD24070202100144F",
        name: "GoodWe-1",
        nodeType: "major",
        productType: "inverter",
        vendor: "GoodWe",
      },
    ],
  },
};

// ─── Tests ──────────────────────────────────────────────────────────────────
describe("DeviceListHandler", () => {
  it("inserts new devices with correct field mapping", async () => {
    const pool = createMockPool();

    await handleDeviceList(pool as unknown as import("pg").Pool, "gw-001", "WKRD24070202100144F", DEVICE_LIST_PAYLOAD);

    // Should have UPSERT queries for 2 major devices
    const insertQueries = pool.queries.filter((q) =>
      q.sql.includes("INSERT INTO assets"),
    );
    expect(insertQueries).toHaveLength(2);

    // Check meter mapping
    const meterParams = insertQueries[0].params;
    expect(meterParams[0]).toBe("Meter-Chint-DTSU666Three1772421079_WKRD24070202100144F"); // asset_id = deviceSn
    expect(meterParams[1]).toBe("Chint-three-1"); // name
    expect(meterParams[2]).toBe("Chint"); // brand = vendor
    expect(meterParams[3]).toBe("Meter-Chint-DTSU666Three"); // model = deviceBrand
    expect(meterParams[4]).toBe("SMART_METER"); // asset_type
    expect(meterParams[5]).toBe("gw-001"); // gateway_id
    expect(meterParams[6]).toBe("home-1"); // home_id
    expect(meterParams[7]).toBe("org-solfacil"); // org_id
  });

  it("maps meter productType to SMART_METER", async () => {
    const pool = createMockPool();
    await handleDeviceList(pool as unknown as import("pg").Pool, "gw-001", "CID", DEVICE_LIST_PAYLOAD);

    const insertQueries = pool.queries.filter((q) =>
      q.sql.includes("INSERT INTO assets"),
    );
    // First device is meter
    expect(insertQueries[0].params[4]).toBe("SMART_METER");
  });

  it("maps inverter productType to INVERTER_BATTERY", async () => {
    const pool = createMockPool();
    await handleDeviceList(pool as unknown as import("pg").Pool, "gw-001", "CID", DEVICE_LIST_PAYLOAD);

    const insertQueries = pool.queries.filter((q) =>
      q.sql.includes("INSERT INTO assets"),
    );
    // Second device is inverter
    expect(insertQueries[1].params[4]).toBe("INVERTER_BATTERY");
  });

  it("soft-deletes devices missing from incoming list", async () => {
    const pool = createMockPool();
    // Simulate an existing device in DB that is NOT in the incoming list
    pool.setResult("active_assets", {
      rows: [
        { serial_number: "Meter-Chint-DTSU666Three1772421079_WKRD24070202100144F" },
        { serial_number: "inverter-goodwe-Energystore1772433273_WKRD24070202100144F" },
        { serial_number: "OLD_DEVICE_NO_LONGER_PRESENT" },
      ],
    });

    await handleDeviceList(pool as unknown as import("pg").Pool, "gw-001", "CID", DEVICE_LIST_PAYLOAD);

    // Should have an UPDATE setting is_active = false for the old device
    const softDeleteQueries = pool.queries.filter(
      (q) =>
        q.sql.includes("UPDATE assets SET is_active = false") &&
        q.params[0] === "OLD_DEVICE_NO_LONGER_PRESENT",
    );
    expect(softDeleteQueries).toHaveLength(1);
  });

  it("NEVER uses DELETE statement (soft-delete iron rule)", async () => {
    const pool = createMockPool();
    pool.setResult("active_assets", {
      rows: [{ serial_number: "REMOVED_DEVICE" }],
    });

    await handleDeviceList(pool as unknown as import("pg").Pool, "gw-001", "CID", DEVICE_LIST_PAYLOAD);

    // Verify NO DELETE queries were issued
    const deleteQueries = pool.queries.filter((q) =>
      q.sql.toUpperCase().includes("DELETE FROM"),
    );
    expect(deleteQueries).toHaveLength(0);
  });

  it("sets gateway_id, home_id, org_id from gateway record", async () => {
    const pool = createMockPool();
    pool.setResult("gateways", {
      rows: [{ org_id: "org-custom", home_id: "home-42" }],
    });

    await handleDeviceList(pool as unknown as import("pg").Pool, "gw-special", "CID", DEVICE_LIST_PAYLOAD);

    const insertQueries = pool.queries.filter((q) =>
      q.sql.includes("INSERT INTO assets"),
    );
    // All devices should reference the custom org/home
    for (const q of insertQueries) {
      expect(q.params[5]).toBe("gw-special"); // gateway_id
      expect(q.params[6]).toBe("home-42"); // home_id
      expect(q.params[7]).toBe("org-custom"); // org_id
    }
  });

  it("handles empty deviceList gracefully", async () => {
    const pool = createMockPool();
    const emptyPayload: SolfacilMessage = {
      ...DEVICE_LIST_PAYLOAD,
      data: { deviceList: [] },
    };

    await handleDeviceList(pool as unknown as import("pg").Pool, "gw-001", "CID", emptyPayload);

    // No INSERT queries
    const insertQueries = pool.queries.filter((q) =>
      q.sql.includes("INSERT INTO assets"),
    );
    expect(insertQueries).toHaveLength(0);
  });

  it("handles missing deviceList in payload", async () => {
    const pool = createMockPool();
    const noListPayload: SolfacilMessage = {
      ...DEVICE_LIST_PAYLOAD,
      data: {},
    };

    // Should not throw
    await handleDeviceList(pool as unknown as import("pg").Pool, "gw-001", "CID", noListPayload);

    // Only the gateway lookup query should have run
    const insertQueries = pool.queries.filter((q) =>
      q.sql.includes("INSERT INTO assets"),
    );
    expect(insertQueries).toHaveLength(0);
  });

  it("filters out minor (二級) devices", async () => {
    const pool = createMockPool();
    const withMinor: SolfacilMessage = {
      ...DEVICE_LIST_PAYLOAD,
      data: {
        deviceList: [
          {
            bindStatus: true,
            connectStatus: "online",
            deviceBrand: "inverter-goodwe",
            deviceSn: "MAJOR_SN",
            fatherSn: "WKRD24070202100144F",
            name: "GoodWe-1",
            nodeType: "major",
            productType: "inverter",
            vendor: "GoodWe",
          },
          {
            bindStatus: true,
            connectStatus: "online",
            deviceBrand: "battery-byd",
            deviceSn: "MINOR_SN",
            fatherSn: "MAJOR_SN",
            name: "BYD-Battery",
            nodeType: "minor",
            productType: "battery",
            vendor: "BYD",
          },
        ],
      },
    };

    await handleDeviceList(pool as unknown as import("pg").Pool, "gw-001", "CID", withMinor);

    const insertQueries = pool.queries.filter((q) =>
      q.sql.includes("INSERT INTO assets"),
    );
    // Only major device should be inserted
    expect(insertQueries).toHaveLength(1);
    expect(insertQueries[0].params[0]).toBe("MAJOR_SN");
  });

  it("idempotent: same deviceList twice produces same result", async () => {
    const pool = createMockPool();

    await handleDeviceList(pool as unknown as import("pg").Pool, "gw-001", "CID", DEVICE_LIST_PAYLOAD);
    const firstRoundInserts = pool.queries.filter((q) =>
      q.sql.includes("INSERT INTO assets"),
    ).length;

    // Reset and run again
    pool.queries.length = 0;
    await handleDeviceList(pool as unknown as import("pg").Pool, "gw-001", "CID", DEVICE_LIST_PAYLOAD);
    const secondRoundInserts = pool.queries.filter((q) =>
      q.sql.includes("INSERT INTO assets"),
    ).length;

    // Both rounds should issue the same UPSERT queries
    expect(firstRoundInserts).toBe(secondRoundInserts);
  });

  it("handles unknown gateway gracefully", async () => {
    const pool = createMockPool();
    pool.setResult("gateways", { rows: [] });

    // Should not throw
    await handleDeviceList(pool as unknown as import("pg").Pool, "gw-unknown", "CID", DEVICE_LIST_PAYLOAD);

    // No INSERT into assets should have been attempted
    const insertQueries = pool.queries.filter((q) =>
      q.sql.includes("INSERT INTO assets"),
    );
    expect(insertQueries).toHaveLength(0);
  });
});
