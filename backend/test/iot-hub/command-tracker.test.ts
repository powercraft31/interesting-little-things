import {
  handleGetReply,
  handleSetReply,
} from "../../src/iot-hub/handlers/command-tracker";
import type { SolfacilMessage } from "../../src/shared/types/solfacil-protocol";

// ─── Mock Pool ──────────────────────────────────────────────────────────────
function createMockPool() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const queryResults = new Map<string, { rows: unknown[]; rowCount: number }>();

  const queryFn = jest.fn(async (sql: string, params?: unknown[]) => {
    queries.push({ sql, params: params ?? [] });

    // set_reply UPDATE matching (v5.22: two-phase — dispatched/accepted, not pending)
    if (
      sql.includes("UPDATE device_command_logs") &&
      sql.includes("command_type = 'set'")
    ) {
      return queryResults.get("update_pending") ?? { rows: [], rowCount: 1 };
    }

    return { rows: [], rowCount: 1 };
  });

  return {
    query: queryFn,
    queries,
    setResult: (key: string, result: { rows: unknown[]; rowCount: number }) => {
      queryResults.set(key, result);
    },
  };
}

// ─── Fixtures ───────────────────────────────────────────────────────────────
const GET_REPLY_PAYLOAD: SolfacilMessage = {
  DS: 0,
  ackFlag: 0,
  clientId: "WKRD24070202100144F",
  deviceName: "EMS_N2",
  productKey: "ems",
  messageId: "376915278899",
  timeStamp: "1773023237691",
  data: {
    configname: "battery_schedule",
    battery_schedule: {
      soc_min_limit: "10",
      soc_max_limit: "95",
      max_charge_current: "100",
      max_discharge_current: "100",
      grid_import_limit: "3000",
      slots: [
        { purpose: "tariff", direction: "charge", start: "0", end: "300" },
        { purpose: "self_consumption", start: "300", end: "1440" },
      ],
    },
  },
};

const SET_REPLY_SUCCESS: SolfacilMessage = {
  DS: 0,
  ackFlag: 1,
  clientId: "WKRD24070202100144F",
  deviceName: "EMS_N2",
  productKey: "ems",
  messageId: "556230388593",
  timeStamp: "1773024455623",
  data: {
    configname: "battery_schedule",
    result: "success",
    message: "",
  },
};

const SET_REPLY_FAIL: SolfacilMessage = {
  ...SET_REPLY_SUCCESS,
  data: {
    configname: "battery_schedule",
    result: "fail",
    message: "Invalid slot coverage",
  },
};

const SET_REPLY_ACCEPTED: SolfacilMessage = {
  ...SET_REPLY_SUCCESS,
  data: {
    configname: "battery_schedule",
    result: "accepted",
    message: "",
  },
};

// ─── Tests ──────────────────────────────────────────────────────────────────
describe("CommandTracker", () => {
  describe("handleGetReply", () => {
    it("inserts get_reply record with correct fields", async () => {
      const pool = createMockPool();

      await handleGetReply(
        pool as unknown as import("pg").Pool,
        "gw-001",
        "WKRD24070202100144F",
        GET_REPLY_PAYLOAD,
      );

      const insertQueries = pool.queries.filter((q) =>
        q.sql.includes("INSERT INTO device_command_logs"),
      );
      expect(insertQueries).toHaveLength(1);

      const q = insertQueries[0];
      expect(q.sql).toContain("'get_reply'");
      // v5.22: no client_id column — params are (gateway_id, config_name, message_id, payload_json, device_timestamp)
      expect(q.params[0]).toBe("gw-001"); // gateway_id
      expect(q.params[1]).toBe("battery_schedule"); // config_name
      expect(q.params[2]).toBe("376915278899"); // message_id
    });

    it("stores battery_schedule as payload_json", async () => {
      const pool = createMockPool();

      await handleGetReply(
        pool as unknown as import("pg").Pool,
        "gw-001",
        "CID",
        GET_REPLY_PAYLOAD,
      );

      const insertQ = pool.queries.find((q) =>
        q.sql.includes("INSERT INTO device_command_logs"),
      );
      expect(insertQ).toBeDefined();
      // payload_json is $4 → params[3]
      const payloadJson = insertQ!.params[3] as string;
      expect(payloadJson).toBeTruthy();
      const parsed = JSON.parse(payloadJson);
      expect(parsed.soc_min_limit).toBe("10");
      expect(parsed.slots).toHaveLength(2);
    });

    it("parses device_timestamp from payload.timeStamp", async () => {
      const pool = createMockPool();

      await handleGetReply(
        pool as unknown as import("pg").Pool,
        "gw-001",
        "CID",
        GET_REPLY_PAYLOAD,
      );

      const insertQ = pool.queries.find((q) =>
        q.sql.includes("INSERT INTO device_command_logs"),
      );
      // device_timestamp is $5 → params[4]
      const deviceTs = insertQ!.params[4] as Date;
      expect(deviceTs).toBeInstanceOf(Date);
      expect(deviceTs.getTime()).toBe(1773023237691);
    });

    it("sets result to 'success' for get_reply", async () => {
      const pool = createMockPool();

      await handleGetReply(
        pool as unknown as import("pg").Pool,
        "gw-001",
        "CID",
        GET_REPLY_PAYLOAD,
      );

      const insertQ = pool.queries.find((q) =>
        q.sql.includes("INSERT INTO device_command_logs"),
      );
      expect(insertQ!.sql).toContain("'success'");
    });
  });

  describe("handleSetReply", () => {
    it("resolves pending set command on success (terminal phase)", async () => {
      const pool = createMockPool();

      await handleSetReply(
        pool as unknown as import("pg").Pool,
        "gw-001",
        "WKRD24070202100144F",
        SET_REPLY_SUCCESS,
      );

      const updateQ = pool.queries.find((q) =>
        q.sql.includes("UPDATE device_command_logs") &&
        q.sql.includes("resolved_at = NOW()"),
      );
      expect(updateQ).toBeDefined();
      // Terminal phase params: (result, error_message, device_timestamp, gateway_id, config_name)
      expect(updateQ!.params[0]).toBe("success"); // result
      expect(updateQ!.params[3]).toBe("gw-001"); // gateway_id
      expect(updateQ!.params[4]).toBe("battery_schedule"); // config_name
    });

    it("records fail result with error_message", async () => {
      const pool = createMockPool();

      await handleSetReply(
        pool as unknown as import("pg").Pool,
        "gw-001",
        "CID",
        SET_REPLY_FAIL,
      );

      const updateQ = pool.queries.find((q) =>
        q.sql.includes("UPDATE device_command_logs") &&
        q.sql.includes("resolved_at = NOW()"),
      );
      expect(updateQ).toBeDefined();
      expect(updateQ!.params[0]).toBe("fail"); // result
      expect(updateQ!.params[1]).toBe("Invalid slot coverage"); // error_message
    });

    it("sets resolved_at = NOW() on terminal reply", async () => {
      const pool = createMockPool();

      await handleSetReply(
        pool as unknown as import("pg").Pool,
        "gw-001",
        "CID",
        SET_REPLY_SUCCESS,
      );

      const updateQ = pool.queries.find((q) =>
        q.sql.includes("UPDATE device_command_logs") &&
        q.sql.includes("command_type = 'set'"),
      );
      expect(updateQ!.sql).toContain("resolved_at = NOW()");
    });

    it("finds latest dispatched/accepted command by gateway_id + config_name", async () => {
      const pool = createMockPool();

      await handleSetReply(
        pool as unknown as import("pg").Pool,
        "gw-001",
        "CID",
        SET_REPLY_SUCCESS,
      );

      const updateQ = pool.queries.find((q) =>
        q.sql.includes("UPDATE device_command_logs") &&
        q.sql.includes("command_type = 'set'"),
      );
      expect(updateQ!.sql).toContain("command_type = 'set'");
      // v5.22: two-phase — matches dispatched OR accepted
      expect(updateQ!.sql).toContain("result IN ('dispatched', 'accepted')");
      expect(updateQ!.sql).toContain("ORDER BY created_at DESC");
      expect(updateQ!.sql).toContain("LIMIT 1");
    });

    it("inserts standalone set_reply when no pending command found", async () => {
      const pool = createMockPool();
      // Simulate no pending command found
      pool.setResult("update_pending", { rows: [], rowCount: 0 });

      await handleSetReply(
        pool as unknown as import("pg").Pool,
        "gw-001",
        "CID",
        SET_REPLY_SUCCESS,
      );

      // Should have UPDATE (rowCount=0) then INSERT
      const insertQ = pool.queries.find((q) =>
        q.sql.includes("INSERT INTO device_command_logs") &&
        q.sql.includes("'set_reply'"),
      );
      expect(insertQ).toBeDefined();
    });

    it("parses device_timestamp from payload.timeStamp", async () => {
      const pool = createMockPool();

      await handleSetReply(
        pool as unknown as import("pg").Pool,
        "gw-001",
        "CID",
        SET_REPLY_SUCCESS,
      );

      const updateQ = pool.queries.find((q) =>
        q.sql.includes("UPDATE device_command_logs") &&
        q.sql.includes("command_type = 'set'"),
      );
      // Terminal phase: device_timestamp is $3 → params[2]
      const deviceTs = updateQ!.params[2] as Date;
      expect(deviceTs).toBeInstanceOf(Date);
      expect(deviceTs.getTime()).toBe(1773024455623);
    });

    // v5.22: two-phase set_reply
    it("handles accepted (phase 1) — updates dispatched → accepted", async () => {
      const pool = createMockPool();

      await handleSetReply(
        pool as unknown as import("pg").Pool,
        "gw-001",
        "CID",
        SET_REPLY_ACCEPTED,
      );

      const updateQ = pool.queries.find((q) =>
        q.sql.includes("UPDATE device_command_logs") &&
        q.sql.includes("result = 'accepted'"),
      );
      expect(updateQ).toBeDefined();
      // Phase 1 WHERE: result = 'dispatched' (not 'accepted' or 'pending')
      expect(updateQ!.sql).toContain("result = 'dispatched'");
      expect(updateQ!.sql).not.toContain("resolved_at");
    });

    it("emits pg_notify on successful command resolution", async () => {
      const pool = createMockPool();

      await handleSetReply(
        pool as unknown as import("pg").Pool,
        "gw-001",
        "CID",
        SET_REPLY_SUCCESS,
      );

      const notifyQ = pool.queries.find((q) =>
        q.sql.includes("pg_notify('command_status'"),
      );
      expect(notifyQ).toBeDefined();
      const payload = JSON.parse(notifyQ!.params[0] as string);
      expect(payload.gatewayId).toBe("gw-001");
      expect(payload.result).toBe("success");
    });
  });
});
