// ─── Mock mqtt module (virtual — not installed as dependency) ────────────────
const mockSubscribe = jest.fn(
  (_topics: string[], _opts: unknown, cb: (err: Error | null) => void) =>
    cb(null),
);
const mockEnd = jest.fn();
const mockOn = jest.fn();
const mockPublish = jest.fn();
const mockConnect = jest.fn(() => {
  const client = {
    on: (event: string, handler: Function) => {
      mockOn(event, handler);
      // Auto-fire "connect" event
      if (event === "connect") {
        setTimeout(() => handler(), 0);
      }
    },
    subscribe: mockSubscribe,
    publish: mockPublish,
    end: mockEnd,
  };
  return client;
});

jest.mock(
  "mqtt",
  () => ({
    connect: mockConnect,
  }),
  { virtual: true },
);

// ─── Mock publish-config (intercept subDevicesGet + configGet) ───────────────
const mockSubDevicesGet = jest.fn();
const mockConfigGet = jest.fn().mockResolvedValue("msg-001");

jest.mock("../../src/iot-hub/handlers/publish-config", () => ({
  publishSubDevicesGet: (...args: unknown[]) => mockSubDevicesGet(...args),
  publishConfigGet: (...args: unknown[]) => mockConfigGet(...args),
}));

import {
  GatewayConnectionManager,
  type TopicHandlers,
} from "../../src/iot-hub/services/gateway-connection-manager";

// ─── Mock Pool ──────────────────────────────────────────────────────────────
function createMockPool(gateways: unknown[] = []) {
  const queryFn = jest.fn();

  // Default: first query returns gateways, subsequent queries return empty
  queryFn.mockImplementation((sql: string) => {
    if (sql.includes("FROM gateways")) {
      return { rows: gateways };
    }
    if (sql.includes("UPDATE gateways")) {
      return { rowCount: 0 };
    }
    return { rows: [] };
  });

  return { query: queryFn } as unknown as import("pg").Pool;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function createNoopHandlers(): TopicHandlers {
  return {
    onDeviceList: jest.fn().mockResolvedValue(undefined),
    onTelemetry: jest.fn().mockResolvedValue(undefined),
    onGetReply: jest.fn().mockResolvedValue(undefined),
    onSetReply: jest.fn().mockResolvedValue(undefined),
    onHeartbeat: jest.fn().mockResolvedValue(undefined),
    onMissedData: jest.fn().mockResolvedValue(undefined),
  };
}

const GATEWAY_FIXTURE = {
  gateway_id: "gw-001",
  org_id: "org-solfacil",
  name: "Gateway 1",
  mqtt_broker_host: "18.141.63.142",
  mqtt_broker_port: 1883,
  mqtt_username: "xuheng",
  mqtt_password: "xuheng8888!",
  status: "online",
  last_seen_at: null,
};

// ─── Tests ──────────────────────────────────────────────────────────────────
describe("GatewayConnectionManager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("reads gateways from DB and creates connections", async () => {
    const pool = createMockPool([GATEWAY_FIXTURE]);
    const handlers = createNoopHandlers();
    const mgr = new GatewayConnectionManager(pool, handlers);

    await mgr.start();

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("FROM gateways"),
    );
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockConnect).toHaveBeenCalledWith(
      "mqtt://18.141.63.142:1883",
      expect.objectContaining({
        username: "xuheng",
        password: "xuheng8888!",
        clean: true,
        reconnectPeriod: 5000,
      }),
    );
    expect(mgr.getConnectedCount()).toBe(1);

    mgr.stop();
  });

  it("subscribes to 6 topics per gateway (v5.22: added data/missed)", async () => {
    const pool = createMockPool([GATEWAY_FIXTURE]);
    const handlers = createNoopHandlers();
    const mgr = new GatewayConnectionManager(pool, handlers);

    await mgr.start();
    // Trigger the "connect" callback
    await jest.advanceTimersByTimeAsync(10);

    expect(mockSubscribe).toHaveBeenCalledWith(
      expect.arrayContaining([
        "device/ems/gw-001/deviceList",
        "device/ems/gw-001/data",
        "device/ems/gw-001/config/get_reply",
        "device/ems/gw-001/config/set_reply",
        "device/ems/gw-001/status",
        "device/ems/gw-001/data/missed",
      ]),
      { qos: 1 },
      expect.any(Function),
    );

    // Verify exactly 6 topics
    const subscribedTopics = mockSubscribe.mock.calls[0][0];
    expect(subscribedTopics).toHaveLength(6);

    mgr.stop();
  });

  it("handles empty gateways table gracefully", async () => {
    const pool = createMockPool([]);
    const handlers = createNoopHandlers();
    const mgr = new GatewayConnectionManager(pool, handlers);

    await mgr.start();

    expect(mockConnect).not.toHaveBeenCalled();
    expect(mgr.getConnectedCount()).toBe(0);

    mgr.stop();
  });

  it("detects new gateway on poll cycle", async () => {
    const pool = createMockPool([]);
    const handlers = createNoopHandlers();
    const mgr = new GatewayConnectionManager(pool, handlers);

    await mgr.start();
    expect(mgr.getConnectedCount()).toBe(0);

    // Simulate new gateway appearing in DB after poll
    (pool.query as jest.Mock).mockImplementation((sql: string) => {
      if (sql.includes("FROM gateways")) {
        return { rows: [GATEWAY_FIXTURE] };
      }
      return { rows: [] };
    });

    // Advance past poll interval (60s)
    await jest.advanceTimersByTimeAsync(60_000);

    expect(mgr.getConnectedCount()).toBe(1);

    mgr.stop();
  });

  it("marks gateway offline after heartbeat timeout", async () => {
    const pool = createMockPool([GATEWAY_FIXTURE]);
    const handlers = createNoopHandlers();
    const mgr = new GatewayConnectionManager(pool, handlers);

    await mgr.start();

    // Advance past watchdog interval (60s)
    await jest.advanceTimersByTimeAsync(60_000);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'offline'"),
    );

    mgr.stop();
  });

  it("graceful shutdown disconnects all clients", async () => {
    const pool = createMockPool([GATEWAY_FIXTURE]);
    const handlers = createNoopHandlers();
    const mgr = new GatewayConnectionManager(pool, handlers);

    await mgr.start();
    expect(mgr.getConnectedCount()).toBe(1);

    mgr.stop();
    expect(mockEnd).toHaveBeenCalled();
    expect(mgr.getConnectedCount()).toBe(0);
  });

  it("skips decommissioned gateways (excluded by SQL WHERE)", async () => {
    const pool = createMockPool([]); // Empty because SQL filters out decommissioned
    const handlers = createNoopHandlers();
    const mgr = new GatewayConnectionManager(pool, handlers);

    await mgr.start();

    // Verify the query includes the decommissioned filter
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("status != 'decommissioned'"),
    );
    expect(mgr.getConnectedCount()).toBe(0);

    mgr.stop();
  });

  it("handles multiple gateways", async () => {
    const gw2 = {
      ...GATEWAY_FIXTURE,
      gateway_id: "gw-002",
      name: "Gateway 2",
    };
    const gw3 = {
      ...GATEWAY_FIXTURE,
      gateway_id: "gw-003",
      name: "Gateway 3",
    };
    const pool = createMockPool([GATEWAY_FIXTURE, gw2, gw3]);
    const handlers = createNoopHandlers();
    const mgr = new GatewayConnectionManager(pool, handlers);

    await mgr.start();

    expect(mockConnect).toHaveBeenCalledTimes(3);
    expect(mgr.getConnectedCount()).toBe(3);

    mgr.stop();
  });

  // ─── PR5: subDevices/get + hourly polling ─────────────────────────────────

  it("publishes subDevices/get on connect (startup)", async () => {
    const pool = createMockPool([GATEWAY_FIXTURE]);
    const handlers = createNoopHandlers();
    const mgr = new GatewayConnectionManager(pool, handlers);

    await mgr.start();
    // Trigger the "connect" callback which fires subscribe → then subDevices/get
    await jest.advanceTimersByTimeAsync(10);

    expect(mockSubDevicesGet).toHaveBeenCalledWith(
      "gw-001",
      expect.any(Function),
    );

    mgr.stop();
  });

  it("hourly timer fires subDevices/get + config/get for all gateways", async () => {
    const gw2 = {
      ...GATEWAY_FIXTURE,
      gateway_id: "gw-002",
      name: "Gateway 2",
    };
    const pool = createMockPool([GATEWAY_FIXTURE, gw2]);
    const handlers = createNoopHandlers();
    const mgr = new GatewayConnectionManager(pool, handlers);

    await mgr.start();
    await jest.advanceTimersByTimeAsync(10); // fire connect

    // Clear startup calls
    mockSubDevicesGet.mockClear();
    mockConfigGet.mockClear();

    // Advance to 1 hour
    await jest.advanceTimersByTimeAsync(3_600_000);

    // subDevices/get for each gateway
    expect(mockSubDevicesGet).toHaveBeenCalledTimes(2);
    // config/get for each gateway
    expect(mockConfigGet).toHaveBeenCalledTimes(2);

    mgr.stop();
  });

  it("stop() clears hourly timer", async () => {
    const pool = createMockPool([GATEWAY_FIXTURE]);
    const handlers = createNoopHandlers();
    const mgr = new GatewayConnectionManager(pool, handlers);

    await mgr.start();
    await jest.advanceTimersByTimeAsync(10);

    mockSubDevicesGet.mockClear();
    mockConfigGet.mockClear();

    mgr.stop();

    // Advance past hourly interval — timer should not fire
    await jest.advanceTimersByTimeAsync(3_600_000);

    expect(mockSubDevicesGet).not.toHaveBeenCalled();
    expect(mockConfigGet).not.toHaveBeenCalled();
  });
});
