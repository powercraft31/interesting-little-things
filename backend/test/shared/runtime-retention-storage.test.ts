import { runRuntimeRetention } from "../../src/shared/runtime/retention-job";
import { parseRuntimeFlags } from "../../src/shared/runtime/flags";
import type { RuntimeQueryable } from "../../src/shared/runtime/persistence";

type QueryCall = { sql: string; params: readonly unknown[] };
type QueryRow = Record<string, unknown>;
type QueryStep = {
  readonly match?: RegExp;
  readonly rows?: readonly QueryRow[];
};

function createScriptedClient(
  steps: readonly QueryStep[],
): RuntimeQueryable & { calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  let index = 0;
  const client: RuntimeQueryable = {
    async query<R extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      params: readonly unknown[] = [],
    ) {
      calls.push({ sql, params });
      const step = steps[index];
      index += 1;
      if (!step) {
        throw new Error(`Unexpected query #${index}: ${sql}`);
      }
      if (step.match && !step.match.test(sql)) {
        throw new Error(`Query #${index} did not match ${step.match}: ${sql}`);
      }
      return { rows: (step.rows ?? []) as unknown as readonly R[] };
    },
  };
  return Object.assign(client, { calls });
}

describe("runtime retention storage archive phases", () => {
  const flagsOn = parseRuntimeFlags({ RUNTIME_GOVERNANCE_ENABLED: "true" });
  const now = new Date("2026-04-18T12:00:00.000Z");

  it("treats device_command_logs reruns as duplicate-safe by deleting already-archived hot rows", async () => {
    const client = createScriptedClient([
      { match: /FROM runtime_issues[\s\S]*state IN \('detected','ongoing','recovered'\)/i, rows: [] },
      { match: /DELETE FROM runtime_events/i, rows: [] },
      { match: /DELETE FROM runtime_health_snapshots/i, rows: [] },
      { match: /DELETE FROM runtime_issues/i, rows: [{ deleted_count: 0 }] },
      { match: /INSERT INTO device_command_logs_archive[\s\S]*ON CONFLICT \(id\) DO NOTHING[\s\S]*EXISTS/i, rows: [{ archived_count: 0, deleted_count: 3 }] },
      { match: /INSERT INTO gateway_alarm_events_archive/i, rows: [{ archived_count: 0, deleted_count: 0 }] },
      { match: /DELETE FROM backfill_requests/i, rows: [{ deleted_count: 0 }] },
    ]);

    const result = await runRuntimeRetention({ flags: flagsOn, now, client });

    expect(result.status).toBe("completed");
    expect(result.deviceCommandLogsArchived).toBe(0);
    expect(result.deviceCommandLogsDeleted).toBe(3);

    const deviceArchive = client.calls[4];
    expect(deviceArchive.sql).toMatch(/ON CONFLICT \(id\) DO NOTHING/i);
    expect(deviceArchive.sql).toMatch(/EXISTS[\s\S]*device_command_logs_archive/i);
  });

  it("treats gateway_alarm_events reruns as duplicate-safe by deleting already-archived hot rows", async () => {
    const client = createScriptedClient([
      { match: /FROM runtime_issues[\s\S]*state IN \('detected','ongoing','recovered'\)/i, rows: [] },
      { match: /DELETE FROM runtime_events/i, rows: [] },
      { match: /DELETE FROM runtime_health_snapshots/i, rows: [] },
      { match: /DELETE FROM runtime_issues/i, rows: [{ deleted_count: 0 }] },
      { match: /INSERT INTO device_command_logs_archive/i, rows: [{ archived_count: 0, deleted_count: 0 }] },
      { match: /INSERT INTO gateway_alarm_events_archive[\s\S]*ON CONFLICT \(id\) DO NOTHING[\s\S]*EXISTS/i, rows: [{ archived_count: 0, deleted_count: 2 }] },
      { match: /DELETE FROM backfill_requests/i, rows: [{ deleted_count: 0 }] },
    ]);

    const result = await runRuntimeRetention({ flags: flagsOn, now, client });

    expect(result.status).toBe("completed");
    expect(result.gatewayAlarmEventsArchived).toBe(0);
    expect(result.gatewayAlarmEventsDeleted).toBe(2);

    const gatewayArchive = client.calls[5];
    expect(gatewayArchive.sql).toMatch(/ON CONFLICT \(id\) DO NOTHING/i);
    expect(gatewayArchive.sql).toMatch(/EXISTS[\s\S]*gateway_alarm_events_archive/i);
  });
});
