import { normalizeEventInput } from "../../src/shared/runtime/contract";
import {
  fetchActiveRuntimeIssues,
  fetchLatestSelfChecks,
  fetchRuntimeIssueByFingerprint,
  insertRuntimeEvent,
  insertRuntimeHealthSnapshot,
  upsertRuntimeIssue,
  upsertRuntimeSelfCheck,
  type RuntimeQueryable,
} from "../../src/shared/runtime/persistence";
import { projectEventToIssue } from "../../src/shared/runtime/projection";
import type {
  RuntimeHealthSnapshot,
  RuntimeSelfCheckRow,
} from "../../src/shared/types/runtime";

type QueryCall = { sql: string; params: readonly unknown[] };

function createFakeClient(
  responses: readonly { rows: readonly Record<string, unknown>[] }[] = [],
): RuntimeQueryable & { calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  let i = 0;
  const client: RuntimeQueryable = {
    async query<R extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      params: readonly unknown[] = [],
    ) {
      calls.push({ sql, params });
      const r = responses[i] ?? { rows: [] };
      i += 1;
      return { rows: r.rows as unknown as readonly R[] };
    },
  };
  return Object.assign(client, { calls });
}

describe("runtime persistence — insertRuntimeEvent", () => {
  it("inserts into runtime_events with all canonical columns", async () => {
    const client = createFakeClient();
    const event = normalizeEventInput({
      event_code: "db.critical_query.failed",
      source: "db",
      tenant_scope: "ORG_A",
      summary: "probe failed",
      detail: { attempt: 3 },
      occurred_at: "2026-04-18T09:00:00.000Z",
      observed_at: "2026-04-18T09:00:01.000Z",
    });

    await insertRuntimeEvent(client, event);

    expect(client.calls).toHaveLength(1);
    const { sql, params } = client.calls[0];
    expect(sql).toMatch(/INSERT INTO runtime_events/);
    expect(sql).toMatch(/event_id/);
    expect(sql).toMatch(/event_code/);
    expect(sql).toMatch(/fingerprint/);
    expect(params).toEqual([
      event.event_id,
      event.event_code,
      event.source,
      event.severity,
      event.lifecycle_hint,
      event.occurred_at,
      event.observed_at,
      event.fingerprint,
      event.correlation_id,
      event.tenant_scope,
      event.summary,
      event.detail === null ? null : JSON.stringify(event.detail),
    ]);
  });
});

describe("runtime persistence — upsertRuntimeIssue", () => {
  it("upserts by fingerprint (one mutable row per fingerprint)", async () => {
    const client = createFakeClient();
    const event = normalizeEventInput({
      event_code: "db.critical_query.failed",
      source: "db",
    });
    const issue = projectEventToIssue({ event }).row;

    await upsertRuntimeIssue(client, issue);

    expect(client.calls).toHaveLength(1);
    const { sql } = client.calls[0];
    expect(sql).toMatch(/INSERT INTO runtime_issues/);
    expect(sql).toMatch(/ON CONFLICT\s*\(\s*fingerprint\s*\)/);
    expect(sql).toMatch(/DO UPDATE SET/);
  });
});

describe("runtime persistence — fetchRuntimeIssueByFingerprint", () => {
  it("returns null when no row matches", async () => {
    const client = createFakeClient([{ rows: [] }]);
    const row = await fetchRuntimeIssueByFingerprint(client, "deadbeef");
    expect(row).toBeNull();
    expect(client.calls[0].params).toEqual(["deadbeef"]);
  });

  it("maps database row to RuntimeIssue", async () => {
    const client = createFakeClient([
      {
        rows: [
          {
            fingerprint: "deadbeef",
            event_code: "db.critical_query.failed",
            source: "db",
            tenant_scope: null,
            cycle_count: 2,
            current_cycle_started_at: new Date("2026-04-18T09:00:00.000Z"),
            first_detected_at: new Date("2026-04-18T08:00:00.000Z"),
            last_observed_at: new Date("2026-04-18T09:05:00.000Z"),
            recovered_at: null,
            closed_at: null,
            suppressed_until: null,
            state: "detected",
            current_severity: "critical",
            observation_count: 4,
            summary: "boom",
            latest_detail: { attempt: 1 },
            operator_note: null,
            operator_actor: null,
            updated_at: new Date("2026-04-18T09:05:00.000Z"),
          },
        ],
      },
    ]);

    const row = await fetchRuntimeIssueByFingerprint(client, "deadbeef");
    expect(row).not.toBeNull();
    expect(row?.cycle_count).toBe(2);
    expect(row?.state).toBe("detected");
    expect(row?.first_detected_at).toBe("2026-04-18T08:00:00.000Z");
  });
});

describe("runtime persistence — fetchActiveRuntimeIssues", () => {
  it("queries detected|ongoing|recovered rows only", async () => {
    const client = createFakeClient([{ rows: [] }]);
    await fetchActiveRuntimeIssues(client);

    expect(client.calls[0].sql).toMatch(/state\s+IN/);
    expect(client.calls[0].sql).toMatch(/'detected'/);
    expect(client.calls[0].sql).toMatch(/'ongoing'/);
    expect(client.calls[0].sql).toMatch(/'recovered'/);
    expect(client.calls[0].sql).not.toMatch(/'closed'/);
    expect(client.calls[0].sql).not.toMatch(/'suppressed'/);
  });
});

describe("runtime persistence — upsertRuntimeSelfCheck", () => {
  it("upserts by check_id", async () => {
    const row: RuntimeSelfCheckRow = {
      check_id: "db.app_pool.reachable",
      source: "db",
      run_host: "host1",
      cadence_seconds: 30,
      last_status: "pass",
      last_run_at: "2026-04-18T09:00:00.000Z",
      last_pass_at: "2026-04-18T09:00:00.000Z",
      last_duration_ms: 12,
      consecutive_failures: 0,
      latest_detail: null,
      updated_at: "2026-04-18T09:00:00.000Z",
    };
    const client = createFakeClient();
    await upsertRuntimeSelfCheck(client, row);
    expect(client.calls[0].sql).toMatch(/INSERT INTO runtime_self_checks/);
    expect(client.calls[0].sql).toMatch(/ON CONFLICT\s*\(\s*check_id\s*\)/);
  });
});

describe("runtime persistence — fetchLatestSelfChecks", () => {
  it("returns all latest-state rows", async () => {
    const client = createFakeClient([
      {
        rows: [
          {
            check_id: "db.app_pool.reachable",
            source: "db",
            run_host: null,
            cadence_seconds: 30,
            last_status: "pass",
            last_run_at: new Date("2026-04-18T09:00:00.000Z"),
            last_pass_at: new Date("2026-04-18T09:00:00.000Z"),
            last_duration_ms: 12,
            consecutive_failures: 0,
            latest_detail: null,
            updated_at: new Date("2026-04-18T09:00:00.000Z"),
          },
        ],
      },
    ]);
    const rows = await fetchLatestSelfChecks(client);
    expect(rows).toHaveLength(1);
    expect(rows[0].check_id).toBe("db.app_pool.reachable");
    expect(rows[0].last_status).toBe("pass");
  });
});

describe("runtime persistence — insertRuntimeHealthSnapshot", () => {
  it("writes a snapshot with persisted overall ('disabled' is impossible via types)", async () => {
    const client = createFakeClient([{ rows: [{ id: 42 }] }]);

    const input: Omit<RuntimeHealthSnapshot, "id"> = {
      captured_at: "2026-04-18T09:00:00.000Z",
      overall: "warning",
      component_states: { db: "ok", bff: "warning" },
      critical_open_count: 0,
      self_check_all_pass: true,
      snapshot_source: "spine.periodic",
    };
    const id = await insertRuntimeHealthSnapshot(client, input);
    expect(id).toBe(42);
    const { sql, params } = client.calls[0];
    expect(sql).toMatch(/INSERT INTO runtime_health_snapshots/);
    expect(sql).toMatch(/RETURNING id/);
    expect(params[1]).toBe("warning");
    // overall persisted value must be one of the 4 persisted values
    expect(["ok", "warning", "degraded", "critical"]).toContain(params[1]);
  });
});
