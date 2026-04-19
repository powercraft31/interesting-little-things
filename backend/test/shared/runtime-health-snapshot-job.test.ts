import { defaultRuntimeFlags, type RuntimeFlags } from "../../src/shared/runtime/flags";
import type { RuntimeIssue, RuntimeSelfCheckRow } from "../../src/shared/types/runtime";
import {
  captureRuntimeHealthSnapshot,
  type RuntimeHealthSnapshotCaptureResult,
} from "../../src/shared/runtime/health-snapshot-job";
import type { RuntimeQueryable } from "../../src/shared/runtime/persistence";

type QueryCall = { sql: string; params: readonly unknown[] };

function createFlags(enabled: boolean): RuntimeFlags {
  return enabled
    ? Object.freeze({
        governanceEnabled: true,
        slices: Object.freeze({
          bff_db: true,
          m1_ingest: true,
          m2_scheduler: true,
          m3_dispatch: true,
          m4_billing: true,
          frontend_runtime: false,
        }),
      })
    : defaultRuntimeFlags();
}

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
      const response = responses[i] ?? { rows: [] };
      i += 1;
      return { rows: response.rows as unknown as readonly R[] };
    },
  };
  return Object.assign(client, { calls });
}

function issue(over: Partial<RuntimeIssue> = {}): RuntimeIssue {
  return {
    fingerprint: over.fingerprint ?? "fp1",
    event_code: over.event_code ?? "db.critical_query.failed",
    source: over.source ?? "db",
    tenant_scope: over.tenant_scope ?? null,
    cycle_count: 1,
    current_cycle_started_at: "2026-04-18T09:00:00.000Z",
    first_detected_at: "2026-04-18T09:00:00.000Z",
    last_observed_at: "2026-04-18T09:01:00.000Z",
    recovered_at: null,
    closed_at: null,
    suppressed_until: null,
    state: over.state ?? "ongoing",
    current_severity: over.current_severity ?? "critical",
    observation_count: 1,
    summary: null,
    latest_detail: null,
    operator_note: null,
    operator_actor: null,
    updated_at: "2026-04-18T09:01:00.000Z",
    ...over,
  };
}

function check(over: Partial<RuntimeSelfCheckRow> = {}): RuntimeSelfCheckRow {
  return {
    check_id: over.check_id ?? "db.app_pool.reachable",
    source: over.source ?? "db",
    run_host: null,
    cadence_seconds: 30,
    last_status: over.last_status ?? "pass",
    last_run_at: "2026-04-18T09:00:00.000Z",
    last_pass_at: "2026-04-18T09:00:00.000Z",
    last_duration_ms: 10,
    consecutive_failures: over.consecutive_failures ?? 0,
    latest_detail: null,
    updated_at: "2026-04-18T09:00:00.000Z",
    ...over,
  };
}

describe("captureRuntimeHealthSnapshot", () => {
  it("is a no-op when runtime governance is disabled", async () => {
    const client = createFakeClient();

    const result = await captureRuntimeHealthSnapshot({
      flags: createFlags(false),
      client,
      now: new Date("2026-04-18T09:05:00.000Z"),
    });

    expect(result).toEqual<RuntimeHealthSnapshotCaptureResult>({ status: "disabled" });
    expect(client.calls).toHaveLength(0);
  });

  it("fetches current issues/self-checks and persists a derived snapshot", async () => {
    const client = createFakeClient([
      { rows: [issue() as unknown as Record<string, unknown>] },
      { rows: [check() as unknown as Record<string, unknown>] },
      { rows: [{ id: 7 }] },
    ]);

    const result = await captureRuntimeHealthSnapshot({
      flags: createFlags(true),
      client,
      now: new Date("2026-04-18T09:05:00.000Z"),
      snapshotSource: "boot",
    });

    expect(result).toEqual<RuntimeHealthSnapshotCaptureResult>({
      status: "captured",
      snapshotId: 7,
      capturedAt: "2026-04-18T09:05:00.000Z",
    });
    expect(client.calls).toHaveLength(3);
    expect(client.calls[0].sql).toMatch(/FROM runtime_issues/i);
    expect(client.calls[1].sql).toMatch(/FROM runtime_self_checks/i);
    expect(client.calls[2].sql).toMatch(/INSERT INTO runtime_health_snapshots/i);
    expect(client.calls[2].params).toEqual([
      "2026-04-18T09:05:00.000Z",
      "critical",
      JSON.stringify({ db: "critical" }),
      1,
      true,
      "boot",
    ]);
  });
});
