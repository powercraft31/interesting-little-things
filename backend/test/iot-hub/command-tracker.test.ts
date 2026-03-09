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

    // set_reply UPDATE matching
    if (sql.includes("UPDATE device_command_logs") && sql.includes("result = 'pending'")) {
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
      expect(q.params[0]).toBe("gw-001"); // gateway_id
      expect(q.params[1]).toBe("WKRD24070202100144F"); // client_id
      expect(q.params[2]).toBe("battery_schedule"); // config_name
      expect(q.params[3]).toBe("376915278899"); // message_id
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
      // payload_json should be stringified battery_schedule
      const payloadJson = insertQ!.params[4] as string;
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
      const deviceTs = insertQ!.params[5] as Date;
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
    it("resolves pending set command on success", async () => {
      const pool = createMockPool();

      await handleSetReply(
        pool as unknown as import("pg").Pool,
        "gw-001",
        "WKRD24070202100144F",
        SET_REPLY_SUCCESS,
      );

      const updateQ = pool.queries.find((q) =>
        q.sql.includes("UPDATE device_command_logs"),
      );
      expect(updateQ).toBeDefined();
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
        q.sql.includes("UPDATE device_command_logs"),
      );
      expect(updateQ).toBeDefined();
      expect(updateQ!.params[0]).toBe("fail"); // result
      expect(updateQ!.params[1]).toBe("Invalid slot coverage"); // error_message
    });

    it("sets resolved_at = NOW() on reply", async () => {
      const pool = createMockPool();

      await handleSetReply(
        pool as unknown as import("pg").Pool,
        "gw-001",
        "CID",
        SET_REPLY_SUCCESS,
      );

      const updateQ = pool.queries.find((q) =>
        q.sql.includes("UPDATE device_command_logs"),
      );
      expect(updateQ!.sql).toContain("resolved_at = NOW()");
    });

    it("finds latest pending command by gateway_id + config_name", async () => {
      const pool = createMockPool();

      await handleSetReply(
        pool as unknown as import("pg").Pool,
        "gw-001",
        "CID",
        SET_REPLY_SUCCESS,
      );

      const updateQ = pool.queries.find((q) =>
        q.sql.includes("UPDATE device_command_logs"),
      );
      expect(updateQ!.sql).toContain("command_type = 'set'");
      expect(updateQ!.sql).toContain("result = 'pending'");
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
        q.sql.includes("UPDATE device_command_logs"),
      );
      const deviceTs = updateQ!.params[2] as Date;
      expect(deviceTs).toBeInstanceOf(Date);
      expect(deviceTs.getTime()).toBe(1773024455623);
    });
  });
});
