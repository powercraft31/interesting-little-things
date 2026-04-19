import {
  DEFAULT_RETENTION,
  computeRetentionCutoffs,
  runRuntimeRetention,
  selectRecoveredForAutoClose,
  selectStaleForAutoClose,
} from "../../src/shared/runtime/retention-job";
import { parseRuntimeFlags } from "../../src/shared/runtime/flags";
import type { RuntimeQueryable } from "../../src/shared/runtime/persistence";
import type { RuntimeIssue } from "../../src/shared/types/runtime";

type QueryCall = { sql: string; params: readonly unknown[] };
type QueryRow = Record<string, unknown>;
type QueryStep = {
  readonly match?: RegExp;
  readonly rows?: readonly QueryRow[];
  readonly error?: Error;
};

function createScriptedClient(
  steps: readonly QueryStep[],
): RuntimeQueryable & { calls: QueryCall[]; remaining(): number } {
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
      if (step.error) {
        throw step.error;
      }
      return { rows: (step.rows ?? []) as unknown as readonly R[] };
    },
  };
  return Object.assign(client, {
    calls,
    remaining: () => steps.length - index,
  });
}

function issue(over: Partial<RuntimeIssue> = {}): RuntimeIssue {
  return {
    fingerprint: over.fingerprint ?? "fp",
    event_code: over.event_code ?? "db.critical_query.failed",
    source: over.source ?? "db",
    tenant_scope: null,
    cycle_count: 1,
    current_cycle_started_at: "2026-04-18T09:00:00.000Z",
    first_detected_at: "2026-04-18T09:00:00.000Z",
    last_observed_at: "2026-04-18T09:01:00.000Z",
    recovered_at: null,
    closed_at: null,
    suppressed_until: null,
    state: over.state ?? "detected",
    current_severity: "warning",
    observation_count: 1,
    summary: null,
    latest_detail: null,
    operator_note: null,
    operator_actor: null,
    updated_at: "2026-04-18T09:01:00.000Z",
    ...over,
  };
}

describe("runtime retention helpers", () => {
  it("derives the committed cutoffs from the registry-backed defaults", () => {
    const now = new Date("2026-04-18T12:00:00.000Z");
    const cutoffs = computeRetentionCutoffs(now);

    expect(cutoffs.eventCutoffAt.toISOString()).toBe(
      new Date(now.getTime() - DEFAULT_RETENTION.eventRetentionMs).toISOString(),
    );
    expect(cutoffs.snapshotCutoffAt.toISOString()).toBe(
      new Date(now.getTime() - DEFAULT_RETENTION.snapshotRetentionMs).toISOString(),
    );
    expect(cutoffs.closedIssueCutoffAt.toISOString()).toBe(
      new Date(now.getTime() - DEFAULT_RETENTION.closedIssueRetentionMs).toISOString(),
    );
    expect(cutoffs.deviceCommandCutoffAt.toISOString()).toBe(
      new Date(now.getTime() - DEFAULT_RETENTION.deviceCommandHotRetentionMs).toISOString(),
    );
    expect(cutoffs.gatewayAlarmCutoffAt.toISOString()).toBe(
      new Date(now.getTime() - DEFAULT_RETENTION.gatewayAlarmHotRetentionMs).toISOString(),
    );
    expect(cutoffs.backfillCutoffAt.toISOString()).toBe(
      new Date(now.getTime() - DEFAULT_RETENTION.backfillTerminalRetentionMs).toISOString(),
    );
  });

  it("selects only recovered rows before the recovered cutoff", () => {
    const cutoff = new Date("2026-04-18T12:00:00.000Z");
    const selected = selectRecoveredForAutoClose(
      [
        issue({ fingerprint: "old", state: "recovered", recovered_at: "2026-04-17T00:00:00.000Z" }),
        issue({ fingerprint: "fresh", state: "recovered", recovered_at: cutoff.toISOString() }),
        issue({ fingerprint: "active", state: "ongoing", recovered_at: "2026-04-17T00:00:00.000Z" }),
      ],
      cutoff,
    );

    expect(selected.map((row) => row.fingerprint)).toEqual(["old"]);
  });

  it("selects only detected/ongoing rows before the stale cutoff", () => {
    const cutoff = new Date("2026-04-18T12:00:00.000Z");
    const selected = selectStaleForAutoClose(
      [
        issue({ fingerprint: "detected", state: "detected", last_observed_at: "2026-04-15T00:00:00.000Z" }),
        issue({ fingerprint: "ongoing", state: "ongoing", last_observed_at: "2026-04-15T00:00:00.000Z" }),
        issue({ fingerprint: "boundary", state: "ongoing", last_observed_at: cutoff.toISOString() }),
        issue({ fingerprint: "recovered", state: "recovered", last_observed_at: "2026-04-15T00:00:00.000Z" }),
      ],
      cutoff,
    );

    expect(selected.map((row) => row.fingerprint)).toEqual(["detected", "ongoing"]);
  });
});

describe("runRuntimeRetention", () => {
  const flagsOn = parseRuntimeFlags({ RUNTIME_GOVERNANCE_ENABLED: "true" });
  const flagsOff = parseRuntimeFlags({});
  const now = new Date("2026-04-18T12:00:00.000Z");

  it("is a safe no-op when governance is disabled", async () => {
    const client = createScriptedClient([]);
    const result = await runRuntimeRetention({ flags: flagsOff, now, client });

    expect(result.status).toBe("disabled");
    expect(result.deviceCommandLogsArchived).toBe(0);
    expect(result.gatewayAlarmEventsArchived).toBe(0);
    expect(client.calls).toHaveLength(0);
  });

  it("runs all committed phases in order and reports per-phase counters", async () => {
    const recovered = issue({
      fingerprint: "recovered-old",
      state: "recovered",
      recovered_at: "2026-04-17T00:00:00.000Z",
    });
    const stale = issue({
      fingerprint: "ongoing-old",
      state: "ongoing",
      last_observed_at: "2026-04-14T00:00:00.000Z",
    });

    const client = createScriptedClient([
      { match: /FROM runtime_issues[\s\S]*state IN \('detected','ongoing','recovered'\)/i, rows: [recovered as unknown as QueryRow, stale as unknown as QueryRow] },
      { match: /INSERT INTO runtime_issues/i, rows: [] },
      { match: /INSERT INTO runtime_issues/i, rows: [] },
      { match: /DELETE FROM runtime_events/i, rows: [{ _: 1 }, { _: 1 }, { _: 1 }] },
      { match: /DELETE FROM runtime_health_snapshots/i, rows: [{ _: 1 }] },
      { match: /DELETE FROM runtime_issues/i, rows: [{ deleted_count: 2 }] },
      { match: /INSERT INTO device_command_logs_archive[\s\S]*ON CONFLICT \(id\) DO NOTHING/i, rows: [{ archived_count: 4, deleted_count: 4 }] },
      { match: /INSERT INTO gateway_alarm_events_archive[\s\S]*ON CONFLICT \(id\) DO NOTHING/i, rows: [{ archived_count: 5, deleted_count: 5 }] },
      { match: /DELETE FROM backfill_requests/i, rows: [{ deleted_count: 6 }] },
    ]);

    const result = await runRuntimeRetention({ flags: flagsOn, now, client });

    expect(result.status).toBe("completed");
    expect(result.recoveredAutoClosed).toBe(1);
    expect(result.staleAutoClosed).toBe(1);
    expect(result.eventsDeleted).toBe(3);
    expect(result.snapshotsDeleted).toBe(1);
    expect(result.closedIssuesDeleted).toBe(2);
    expect(result.deviceCommandLogsArchived).toBe(4);
    expect(result.deviceCommandLogsDeleted).toBe(4);
    expect(result.gatewayAlarmEventsArchived).toBe(5);
    expect(result.gatewayAlarmEventsDeleted).toBe(5);
    expect(result.backfillRequestsDeleted).toBe(6);
    expect(client.remaining()).toBe(0);

    const closedIssueDelete = client.calls[5];
    expect(closedIssueDelete.sql).toMatch(/state = 'closed'/i);
    expect(closedIssueDelete.params[1]).toBe(5_000);

    const deviceArchive = client.calls[6];
    expect(deviceArchive.sql).toMatch(/result IN \('success', 'fail', 'timeout'\)/i);
    expect(deviceArchive.sql).toMatch(/resolved_at IS NOT NULL/i);
    expect(deviceArchive.sql).not.toMatch(/result\s*!=\s*'pending'/i);
    expect(deviceArchive.params[1]).toBe(5_000);

    const gatewayArchive = client.calls[7];
    expect(gatewayArchive.sql).toMatch(/WHERE event_create_time < \$1/i);
    expect(gatewayArchive.params[1]).toBe(5_000);

    const backfillDelete = client.calls[8];
    expect(backfillDelete.sql).toMatch(/status IN \('completed', 'failed'\)/i);
    expect(backfillDelete.sql).toMatch(/COALESCE\(completed_at, created_at\) < \$1/i);
    expect(backfillDelete.params[1]).toBe(5_000);
  });

  it("captures a phase failure, emits storage.retention.executor.failed, and still runs later phases", async () => {
    const client = createScriptedClient([
      { match: /FROM runtime_issues[\s\S]*state IN \('detected','ongoing','recovered'\)/i, rows: [] },
      { match: /DELETE FROM runtime_events/i, rows: [] },
      { match: /DELETE FROM runtime_health_snapshots/i, rows: [] },
      { match: /DELETE FROM runtime_issues/i, rows: [{ deleted_count: 0 }] },
      { match: /INSERT INTO device_command_logs_archive/i, error: new Error("device archive boom") },
      { match: /INSERT INTO runtime_events/i, rows: [] },
      { match: /SELECT[\s\S]*FROM runtime_issues WHERE fingerprint = \$1 LIMIT 1/i, rows: [] },
      { match: /INSERT INTO runtime_issues/i, rows: [] },
      { match: /INSERT INTO gateway_alarm_events_archive/i, rows: [{ archived_count: 2, deleted_count: 2 }] },
      { match: /DELETE FROM backfill_requests/i, rows: [{ deleted_count: 3 }] },
    ]);
    const logs: string[] = [];

    const result = await runRuntimeRetention({
      flags: flagsOn,
      now,
      client,
      logger: (line) => logs.push(line),
    });

    expect(result.status).toBe("degraded_fallback");
    expect(result.errors).toContainEqual({
      phase: "archive_device_command_logs",
      error: "device archive boom",
    });
    expect(result.gatewayAlarmEventsArchived).toBe(2);
    expect(result.backfillRequestsDeleted).toBe(3);

    const failureEventInsert = client.calls.find((call) => /INSERT INTO runtime_events/i.test(call.sql));
    expect(failureEventInsert).toBeDefined();
    expect(failureEventInsert?.params[1]).toBe("storage.retention.executor.failed");
    expect(failureEventInsert?.params[2]).toBe("shared.runtime");
    expect(String(failureEventInsert?.params[10] ?? "")).toMatch(/archive_device_command_logs/i);
    expect(logs.some((line) => line.includes("runtime-retention:fallback"))).toBe(true);
  });

  it("reports repeated per-phase failures without throwing", async () => {
    const client: RuntimeQueryable = {
      async query() {
        throw new Error("boom");
      },
    };
    const logs: string[] = [];

    const result = await runRuntimeRetention({
      flags: flagsOn,
      now,
      client,
      logger: (line) => logs.push(line),
    });

    expect(result.status).toBe("degraded_fallback");
    expect(result.errors).toEqual([
      { phase: "fetch_active", error: "boom" },
      { phase: "delete_events", error: "boom" },
      { phase: "delete_snapshots", error: "boom" },
      { phase: "delete_closed_runtime_issues", error: "boom" },
      { phase: "archive_device_command_logs", error: "boom" },
      { phase: "archive_gateway_alarm_events", error: "boom" },
      { phase: "delete_terminal_backfill_requests", error: "boom" },
    ]);
    expect(logs.some((line) => line.includes("runtime-retention:fallback"))).toBe(true);
  });
});
