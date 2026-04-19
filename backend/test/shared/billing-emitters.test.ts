/**
 * WS8 — M4 billing runtime emitters.
 *
 * Contract under test:
 *  - scheduler.billing_job.heartbeat / .failed / .missed_run are emitted via
 *    the existing M9 shared emit surface, under slice "m4_billing" and
 *    source "m4.billing".
 *  - scheduler.jobs.alive self-check is upserted through upsertRuntimeSelfCheck
 *    with check_id "scheduler.jobs.alive" and source "m2.scheduler" (the
 *    registry-owned source for that check_id), using the M9 pass helper
 *    exclusively. Detail carries contributor='m4.billing' so M4 evidence
 *    stays distinguishable from M2 evidence on the same latest-state row.
 *  - Every helper is strictly best-effort: returns 'disabled' when the global
 *    gate or slice is off, and 'degraded_fallback' (never throws) when the
 *    underlying DB path fails.
 *  - Failed fingerprints dedup by phase so distinct billing failure modes
 *    stay distinct without collapsing legitimate failure populations.
 */

import { parseRuntimeFlags } from "../../src/shared/runtime/flags";
import type { RuntimeQueryable } from "../../src/shared/runtime/persistence";
import {
  emitBillingJobFailed,
  emitBillingJobHeartbeat,
  emitBillingJobMissedRun,
  recordBillingJobsAlive,
} from "../../src/shared/runtime/billing-emitters";

type QueryCall = { sql: string; params: readonly unknown[] };

function makeRecordingClient(): RuntimeQueryable & { calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  const client: RuntimeQueryable = {
    async query<R extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      params: readonly unknown[] = [],
    ) {
      calls.push({ sql, params });
      return { rows: [] as unknown as readonly R[] };
    },
  };
  return Object.assign(client, { calls });
}

const FLAGS_ON = parseRuntimeFlags({
  RUNTIME_GOVERNANCE_ENABLED: "true",
  RUNTIME_EMIT_M4_BILLING: "true",
});

const FLAGS_OFF = parseRuntimeFlags({});

const FLAGS_GATE_ONLY = parseRuntimeFlags({
  RUNTIME_GOVERNANCE_ENABLED: "true",
});

function findInsertEvent(calls: QueryCall[]): QueryCall | undefined {
  return calls.find((c) => /INSERT INTO runtime_events/.test(c.sql));
}

function findUpsertSelfCheck(calls: QueryCall[]): QueryCall | undefined {
  return calls.find((c) => /INSERT INTO runtime_self_checks/.test(c.sql));
}

describe("emitBillingJobHeartbeat", () => {
  it("emits scheduler.billing_job.heartbeat with run-scoped detail", async () => {
    const client = makeRecordingClient();
    const runStartedAt = new Date("2026-04-18T03:05:00.000Z");
    const result = await emitBillingJobHeartbeat(
      { flags: FLAGS_ON, client },
      {
        assetsSettled: 42,
        billingDate: "2026-04-17",
        runStartedAt,
        durationMs: 1432,
      },
    );
    expect(result.status).toBe("persisted");
    const insert = findInsertEvent(client.calls);
    expect(insert).toBeDefined();
    expect(insert?.params[1]).toBe("scheduler.billing_job.heartbeat");
    expect(insert?.params[2]).toBe("m4.billing");

    const detailJson = String(insert?.params[11]);
    expect(detailJson).toMatch(/"assets_settled":42/);
    expect(detailJson).toMatch(/"billing_date":"2026-04-17"/);
    expect(detailJson).toMatch(/"duration_ms":1432/);
    expect(detailJson).toMatch(/"run_started_at":"2026-04-18T03:05:00\.000Z"/);
  });

  it("is a no-op when governance gate is off", async () => {
    const client = makeRecordingClient();
    const result = await emitBillingJobHeartbeat(
      { flags: FLAGS_OFF, client },
      {
        assetsSettled: 1,
        billingDate: "2026-04-17",
        runStartedAt: new Date(),
        durationMs: 10,
      },
    );
    expect(result.status).toBe("disabled");
    expect(client.calls).toHaveLength(0);
  });

  it("is a no-op when m4_billing slice is off even with governance on", async () => {
    const client = makeRecordingClient();
    const result = await emitBillingJobHeartbeat(
      { flags: FLAGS_GATE_ONLY, client },
      {
        assetsSettled: 1,
        billingDate: "2026-04-17",
        runStartedAt: new Date(),
        durationMs: 10,
      },
    );
    expect(result.status).toBe("disabled");
    expect(client.calls).toHaveLength(0);
  });

  it("swallows underlying persistence failure and returns degraded_fallback", async () => {
    const failing: RuntimeQueryable = {
      async query() {
        throw new Error("db-down");
      },
    };
    let threw = false;
    let result: Awaited<ReturnType<typeof emitBillingJobHeartbeat>> | null =
      null;
    try {
      result = await emitBillingJobHeartbeat(
        { flags: FLAGS_ON, client: failing, logger: () => {} },
        {
          assetsSettled: 0,
          billingDate: "2026-04-17",
          runStartedAt: new Date(),
          durationMs: 0,
        },
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(result?.status).toBe("degraded_fallback");
  });
});

describe("emitBillingJobFailed", () => {
  it("emits scheduler.billing_job.failed with phase folded into dedup", async () => {
    const client = makeRecordingClient();
    const result = await emitBillingJobFailed(
      { flags: FLAGS_ON, client },
      {
        error: new Error("asset_hourly_metrics unreachable"),
        phase: "hourly_fetch",
        billingDate: "2026-04-17",
      },
    );
    expect(result.status).toBe("persisted");
    const insert = findInsertEvent(client.calls);
    expect(insert?.params[1]).toBe("scheduler.billing_job.failed");
    expect(insert?.params[2]).toBe("m4.billing");
    const detailJson = String(insert?.params[11]);
    expect(detailJson).toMatch(/"error":"asset_hourly_metrics unreachable"/);
    expect(detailJson).toMatch(/"phase":"hourly_fetch"/);
    expect(detailJson).toMatch(/"billing_date":"2026-04-17"/);
  });

  it("produces distinct fingerprints per phase so distinct failure modes stay distinct", async () => {
    const clientA = makeRecordingClient();
    const clientB = makeRecordingClient();
    const a = await emitBillingJobFailed(
      { flags: FLAGS_ON, client: clientA },
      { error: new Error("x"), phase: "hourly_fetch" },
    );
    const b = await emitBillingJobFailed(
      { flags: FLAGS_ON, client: clientB },
      { error: new Error("x"), phase: "upsert_revenue" },
    );
    expect(a.event?.fingerprint).not.toBe(b.event?.fingerprint);
  });

  it("is a no-op when m4_billing slice is off", async () => {
    const client = makeRecordingClient();
    const result = await emitBillingJobFailed(
      { flags: FLAGS_OFF, client },
      { error: new Error("x") },
    );
    expect(result.status).toBe("disabled");
    expect(client.calls).toHaveLength(0);
  });

  it("never throws even if persistence blows up", async () => {
    const failing: RuntimeQueryable = {
      async query() {
        throw new Error("ded");
      },
    };
    let threw = false;
    try {
      await emitBillingJobFailed(
        { flags: FLAGS_ON, client: failing, logger: () => {} },
        { error: new Error("y") },
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});

describe("emitBillingJobMissedRun", () => {
  it("emits scheduler.billing_job.missed_run with gap and expected interval", async () => {
    const client = makeRecordingClient();
    const result = await emitBillingJobMissedRun(
      { flags: FLAGS_ON, client },
      {
        lastObservedAt: new Date("2026-04-17T03:05:00.000Z"),
        observedAt: new Date("2026-04-18T06:00:00.000Z"),
        gapMs: 97_500_000,
        expectedIntervalMs: 86_400_000,
      },
    );
    expect(result.status).toBe("persisted");
    const insert = findInsertEvent(client.calls);
    expect(insert?.params[1]).toBe("scheduler.billing_job.missed_run");
    expect(insert?.params[2]).toBe("m4.billing");
    const detailJson = String(insert?.params[11]);
    expect(detailJson).toMatch(/"gap_ms":97500000/);
    expect(detailJson).toMatch(/"expected_interval_ms":86400000/);
  });

  it("is a no-op when governance gate is off", async () => {
    const client = makeRecordingClient();
    const result = await emitBillingJobMissedRun(
      { flags: FLAGS_OFF, client },
      {
        lastObservedAt: new Date(),
        observedAt: new Date(),
        gapMs: 1,
        expectedIntervalMs: 86_400_000,
      },
    );
    expect(result.status).toBe("disabled");
    expect(client.calls).toHaveLength(0);
  });
});

describe("recordBillingJobsAlive", () => {
  it("upserts scheduler.jobs.alive with last_status='pass' and m4 contributor marker", async () => {
    const client = makeRecordingClient();
    const observedAt = new Date("2026-04-18T03:05:30.000Z");
    const result = await recordBillingJobsAlive(
      { flags: FLAGS_ON, client, now: observedAt },
      {
        observedAt,
        durationMs: 1432,
        detail: { assets_settled: 42, billing_date: "2026-04-17" },
      },
    );
    expect(result.status).toBe("persisted");

    const upsert = findUpsertSelfCheck(client.calls);
    expect(upsert).toBeDefined();
    // upsertRuntimeSelfCheck binds: check_id, source, run_host, cadence_seconds,
    //   last_status, last_run_at, last_pass_at, last_duration_ms,
    //   consecutive_failures, latest_detail, updated_at
    expect(upsert?.params[0]).toBe("scheduler.jobs.alive");
    // source comes from the shared phase-1 registry (m2.scheduler owns the
    // check_id row); M4 is a contributor, not the check owner.
    expect(upsert?.params[1]).toBe("m2.scheduler");
    expect(upsert?.params[4]).toBe("pass");
    expect(upsert?.params[5]).toBe(observedAt.toISOString()); // last_run_at
    expect(upsert?.params[6]).toBe(observedAt.toISOString()); // last_pass_at
    expect(upsert?.params[7]).toBe(1432);
    const detailJson = String(upsert?.params[9]);
    expect(detailJson).toMatch(/"contributor":"m4\.billing"/);
    expect(detailJson).toMatch(/"assets_settled":42/);
    expect(detailJson).toMatch(/"billing_date":"2026-04-17"/);
  });

  it("is a no-op with status='disabled' when the governance gate is off", async () => {
    const client = makeRecordingClient();
    const result = await recordBillingJobsAlive(
      { flags: FLAGS_OFF, client },
      { observedAt: new Date(), durationMs: 1 },
    );
    expect(result.status).toBe("disabled");
    expect(client.calls).toHaveLength(0);
  });

  it("is a no-op when m4_billing slice is off even with governance on", async () => {
    const client = makeRecordingClient();
    const result = await recordBillingJobsAlive(
      { flags: FLAGS_GATE_ONLY, client },
      { observedAt: new Date(), durationMs: 1 },
    );
    expect(result.status).toBe("disabled");
    expect(client.calls).toHaveLength(0);
  });

  it("never throws and returns degraded_fallback on persistence failure", async () => {
    const failing: RuntimeQueryable = {
      async query() {
        throw new Error("pg-gone");
      },
    };
    let threw = false;
    let result: Awaited<ReturnType<typeof recordBillingJobsAlive>> | null =
      null;
    try {
      result = await recordBillingJobsAlive(
        { flags: FLAGS_ON, client: failing, logger: () => {} },
        { observedAt: new Date(), durationMs: 1 },
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(result?.status).toBe("degraded_fallback");
  });
});
