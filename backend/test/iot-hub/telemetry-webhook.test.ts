import type { Request, Response } from "express";
import { Pool } from "pg";
import {
  createTelemetryWebhookHandler,
  TelemetryPayload,
} from "../../src/iot-hub/handlers/telemetry-webhook";

// ── Mock Pool ────────────────────────────────────────────────────────────
function makeMockPool(): { pool: Pool; queryCalls: { text: string; values: unknown[] }[] } {
  const queryCalls: { text: string; values: unknown[] }[] = [];
  const pool = {
    query: jest.fn(async (text: string, values?: unknown[]) => {
      queryCalls.push({ text, values: values ?? [] });
      return { rows: [], rowCount: 1 };
    }),
  } as unknown as Pool;
  return { pool, queryCalls };
}

// ── Mock Req / Res ───────────────────────────────────────────────────────
function makeReq(body: unknown): Partial<Request> {
  return { body };
}

function makeRes(): {
  status: jest.Mock;
  json: jest.Mock;
  _status?: number;
  _body?: unknown;
} {
  const res: Record<string, unknown> = {};
  res.status = jest.fn((code: number) => {
    res._status = code;
    return res;
  });
  res.json = jest.fn((data: unknown) => {
    res._body = data;
    return res;
  });
  return res as ReturnType<typeof makeRes>;
}

// ── Valid Payload ─────────────────────────────────────────────────────────
const VALID_PAYLOAD: TelemetryPayload = {
  asset_id: "ASSET_SP_001",
  timestamp: "2026-03-01T14:00:00.000Z",
  battery_soc: 65,
  battery_power: 3.5,
  energy_kwh: 0.0097,
  pv_power: 4.2,
  grid_power_kw: -1.1,
  load_power: 2.8,
};

// ── Tests ────────────────────────────────────────────────────────────────
describe("telemetry-webhook handler", () => {
  it("returns 201 and inserts into telemetry_history + upserts device_state on valid payload", async () => {
    const { pool, queryCalls } = makeMockPool();
    const handler = createTelemetryWebhookHandler(pool);
    const req = makeReq(VALID_PAYLOAD);
    const res = makeRes();

    await handler(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ ok: true, asset_id: "ASSET_SP_001" });

    // Should have 2 queries: INSERT + UPSERT
    expect(queryCalls).toHaveLength(2);

    // First query: INSERT into telemetry_history
    expect(queryCalls[0].text).toContain("INSERT INTO telemetry_history");
    expect(queryCalls[0].values).toEqual([
      "ASSET_SP_001",
      "2026-03-01T14:00:00.000Z",
      65,
      3.5,
      0.0097,
      4.2,
      -1.1,
      2.8,
    ]);

    // Second query: UPSERT device_state
    expect(queryCalls[1].text).toContain("INSERT INTO device_state");
    expect(queryCalls[1].text).toContain("ON CONFLICT");
    expect(queryCalls[1].values).toEqual(["ASSET_SP_001", 65, 3.5]);
  });

  it("returns 400 when asset_id is missing", async () => {
    const { pool } = makeMockPool();
    const handler = createTelemetryWebhookHandler(pool);
    const req = makeReq({ timestamp: "2026-03-01T14:00:00Z", battery_soc: 50, energy_kwh: 0.01 });
    const res = makeRes();

    await handler(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: "Missing required field: asset_id" }),
    );
  });

  it("returns 400 when timestamp is missing", async () => {
    const { pool } = makeMockPool();
    const handler = createTelemetryWebhookHandler(pool);
    const req = makeReq({ asset_id: "A1", battery_soc: 50, energy_kwh: 0.01 });
    const res = makeRes();

    await handler(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Missing required field: timestamp" }),
    );
  });

  it("returns 400 when battery_soc is missing", async () => {
    const { pool } = makeMockPool();
    const handler = createTelemetryWebhookHandler(pool);
    const req = makeReq({ asset_id: "A1", timestamp: "2026-03-01T14:00:00Z", energy_kwh: 0.01 });
    const res = makeRes();

    await handler(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Missing required field: battery_soc" }),
    );
  });

  it("returns 400 when energy_kwh is missing", async () => {
    const { pool } = makeMockPool();
    const handler = createTelemetryWebhookHandler(pool);
    const req = makeReq({ asset_id: "A1", timestamp: "2026-03-01T14:00:00Z", battery_soc: 50 });
    const res = makeRes();

    await handler(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Missing required field: energy_kwh" }),
    );
  });

  it("returns 500 when pool.query throws", async () => {
    const pool = {
      query: jest.fn().mockRejectedValue(new Error("connection refused")),
    } as unknown as Pool;
    const handler = createTelemetryWebhookHandler(pool);
    const req = makeReq(VALID_PAYLOAD);
    const res = makeRes();

    jest.spyOn(console, "error").mockImplementation(() => {});

    await handler(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: "Internal server error" }),
    );

    jest.restoreAllMocks();
  });

  it("handles optional fields as null when not provided", async () => {
    const { pool, queryCalls } = makeMockPool();
    const handler = createTelemetryWebhookHandler(pool);
    const minimalPayload = {
      asset_id: "ASSET_RJ_002",
      timestamp: "2026-03-01T15:00:00.000Z",
      battery_soc: 40,
      battery_power: -2.0,
      energy_kwh: -0.005,
    };
    const req = makeReq(minimalPayload);
    const res = makeRes();

    await handler(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(201);

    // INSERT values should have null for optional fields
    expect(queryCalls[0].values).toEqual([
      "ASSET_RJ_002",
      "2026-03-01T15:00:00.000Z",
      40,
      -2.0,
      -0.005,
      null,
      null,
      null,
    ]);
  });
});
