/**
 * M2 scheduler runtime emitters (v6.10 WS6).
 *
 * Thin, best-effort wrappers around the shared M9 emit() surface for the M2
 * optimization scheduler lifecycle boundaries:
 *   - scheduler.schedule_generator.heartbeat — observed at the schedule-generator
 *     run boundary (informational; each successful pass emits one fact)
 *   - scheduler.schedule_generator.failed    — schedule-generator run error
 *     boundary (the try/catch around runScheduleGenerator)
 *   - scheduler.schedule_generator.missed_run — optimization-owned lag fact
 *     emitted when the wall-clock gap between successive heartbeats exceeds
 *     the configured cadence by a strict margin
 *   - scheduler.jobs.alive (self-check) — latest-state contribution from the
 *     optimization schedule-generator heartbeat path ONLY. M2 does not claim
 *     ownership of every cron in the system; it contributes one source of
 *     evidence to the shared self-check.
 *
 * Design invariants (mirror WS4 bff-emitters + WS5 ingest-emitters):
 *  - every helper is best-effort: awaiting is allowed but ignoring is fine.
 *    None throw to the caller. The optimization scheduler hot path
 *    (runScheduleGenerator) must never be coupled to runtime emission.
 *  - when the governance flag is off OR the m2_scheduler slice is off, every
 *    helper is a no-op and returns status='disabled'. No DB writes occur.
 *  - fingerprint / severity / lifecycle / aggregation semantics are owned by
 *    M9 normalization + projection. M2 only declares facts at the boundary.
 *  - scheduler.jobs.alive self-check uses the M9 registry + pass helpers;
 *    M2 is forbidden from inventing a parallel latest-state model.
 *  - M2 does NOT define new runtime lifecycle rules, severity overrides, or
 *    aggregation behavior — it only names the optimization-owned boundary.
 */
import { computeFingerprint } from "./contract";
import { emitRuntimeEvent, type EmitRuntimeEventResult } from "./emit";
import type { RuntimeFlags } from "./flags";
import { isSliceEnabled } from "./flags";
import {
  fetchRuntimeIssueByFingerprint,
  runWithServicePool,
  upsertRuntimeSelfCheck,
  type RuntimeQueryable,
} from "./persistence";
import {
  applySelfCheckPass,
  buildInitialSelfCheckRow,
} from "./self-check";
import type { RuntimeDetailPayload, RuntimeIssue } from "../types/runtime";

export interface SchedulerEmitterOptions {
  readonly flags: RuntimeFlags;
  readonly client?: RuntimeQueryable;
  readonly logger?: (line: string) => void;
  readonly now?: Date;
  readonly runHost?: string | null;
}

function coerceError(err: unknown): Error {
  if (err instanceof Error) {
    return err;
  }
  return new Error(typeof err === "string" ? err : "scheduler-emitter: unknown");
}

async function safeEmit(
  options: SchedulerEmitterOptions,
  params: Parameters<typeof emitRuntimeEvent>[0],
): Promise<EmitRuntimeEventResult> {
  try {
    return await emitRuntimeEvent(params, {
      flags: options.flags,
      slice: "m2_scheduler",
      client: options.client,
      logger: options.logger,
      now: options.now,
    });
  } catch (err) {
    return { status: "degraded_fallback", error: coerceError(err) };
  }
}

function safeLog(
  logger: ((line: string) => void) | undefined,
  payload: Record<string, unknown>,
): void {
  const line = `[runtime-scheduler:fallback] ${JSON.stringify(payload)}`;
  if (logger) {
    try {
      logger(line);
    } catch {
      /* never let the logger break us */
    }
    return;
  }
  // eslint-disable-next-line no-console
  console.error(line);
}

// ─────────────────────────────────────────────────────────────────────────────
// scheduler.schedule_generator.heartbeat — one informational fact per observed
// optimization schedule-generator run boundary. Explicitly NOT per asset / per
// inserted slot — that would be an aggregation design, which belongs in M9.
// ─────────────────────────────────────────────────────────────────────────────

export interface SchedulerHeartbeatInput {
  readonly assetsProcessed: number;
  readonly slotsGenerated: number;
  readonly runStartedAt: Date;
  readonly durationMs: number;
}

export function emitSchedulerHeartbeat(
  options: SchedulerEmitterOptions,
  input: SchedulerHeartbeatInput,
): Promise<EmitRuntimeEventResult> {
  return safeEmit(options, {
    event_code: "scheduler.schedule_generator.heartbeat",
    source: "m2.scheduler",
    summary: `Schedule generator run: ${input.assetsProcessed} assets / ${input.slotsGenerated} slots`,
    detail: {
      assets_processed: input.assetsProcessed,
      slots_generated: input.slotsGenerated,
      run_started_at: input.runStartedAt.toISOString(),
      duration_ms: input.durationMs,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// scheduler.schedule_generator.failed — structured error fact for the M2-owned
// schedule-generator boundary. Scope: optimization scheduler only. Generic
// scheduler/cron errors are NOT in scope.
// ─────────────────────────────────────────────────────────────────────────────

export interface SchedulerFailedInput {
  readonly error: Error;
  readonly phase?: string;
  readonly assetId?: string;
}

export function emitSchedulerFailed(
  options: SchedulerEmitterOptions,
  input: SchedulerFailedInput,
): Promise<EmitRuntimeEventResult> {
  return safeEmit(options, {
    event_code: "scheduler.schedule_generator.failed",
    source: "m2.scheduler",
    summary: `Schedule generator failed: ${input.error.message}`,
    detail: {
      error: input.error.message,
      stack: input.error.stack ?? null,
      phase: input.phase ?? null,
      asset_id: input.assetId ?? null,
    },
    dedup_keys: { phase: input.phase ?? "run" },
  });
}

// Canonical recovery for a previously-detected schedule-generator failure.
// Reuses the SAME event_code + source so the fingerprint matches the detected
// issue; M9 projection applies lifecycle_hint='recover' to the existing
// runtime_issues row. No new event code is introduced.
export interface SchedulerRecoveredInput {
  readonly observedAt: Date;
  readonly phase?: string;
}

export function emitSchedulerRecovered(
  options: SchedulerEmitterOptions,
  input: SchedulerRecoveredInput,
): Promise<EmitRuntimeEventResult> {
  return safeEmit(options, {
    event_code: "scheduler.schedule_generator.failed",
    source: "m2.scheduler",
    lifecycle_hint: "recover",
    severity: "info",
    summary: "Schedule generator run recovered",
    detail: {
      observed_at: input.observedAt.toISOString(),
      phase: input.phase ?? null,
      recovered: true,
    },
    dedup_keys: { phase: input.phase ?? "run" },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical recovery authority
//
// Mirrors the WS5 I3 / WS7 I4a pattern: process-local bookkeeping is
// insufficient because a restart between detect and recovery would lose
// authority. The canonical source of truth is the runtime_issues row itself
// (same fingerprint as the failed event). Only when an active
// detected/ongoing cycle exists do we emit the recover event; otherwise this
// helper is a no-op so ordinary healthy schedule-generator runs (no prior
// failure) do not synthesize recovered rows on the issues surface.
// ─────────────────────────────────────────────────────────────────────────────

export type MaybeEmitSchedulerRecoveredStatus =
  | "disabled"
  | "no_active_issue"
  | "persisted"
  | "degraded_fallback";

export interface MaybeEmitSchedulerRecoveredResult {
  readonly status: MaybeEmitSchedulerRecoveredStatus;
  readonly fingerprint?: string;
  readonly existing?: RuntimeIssue | null;
  readonly error?: Error;
}

function isActiveSchedulerIssue(issue: RuntimeIssue): boolean {
  return issue.state === "detected" || issue.state === "ongoing";
}

export function schedulerFailedFingerprintFor(phase?: string | null): string {
  return computeFingerprint({
    event_code: "scheduler.schedule_generator.failed",
    source: "m2.scheduler",
    tenant_scope: null,
    dedup_keys: { phase: phase ?? "run" },
  });
}

export async function maybeEmitSchedulerRecovered(
  options: SchedulerEmitterOptions,
  input: SchedulerRecoveredInput,
): Promise<MaybeEmitSchedulerRecoveredResult> {
  if (!isSliceEnabled(options.flags, "m2_scheduler")) {
    return { status: "disabled" };
  }
  const fingerprint = schedulerFailedFingerprintFor(input.phase);

  let existing: RuntimeIssue | null = null;
  try {
    if (options.client) {
      existing = await fetchRuntimeIssueByFingerprint(options.client, fingerprint);
    } else {
      existing = await runWithServicePool((c) =>
        fetchRuntimeIssueByFingerprint(c, fingerprint),
      );
    }
  } catch (err) {
    const error = coerceError(err);
    safeLog(options.logger, {
      phase: "scheduler_recover_authority_lookup",
      fingerprint,
      error: error.message,
    });
    return { status: "degraded_fallback", fingerprint, error };
  }

  if (!existing || !isActiveSchedulerIssue(existing)) {
    return { status: "no_active_issue", fingerprint, existing };
  }

  const emitResult = await emitSchedulerRecovered(options, input);
  if (emitResult.status === "persisted") {
    return { status: "persisted", fingerprint, existing };
  }
  if (emitResult.status === "degraded_fallback") {
    return {
      status: "degraded_fallback",
      fingerprint,
      existing,
      error: emitResult.error,
    };
  }
  // Slice flipped off between the check and emit — treat as disabled.
  return { status: "disabled", fingerprint, existing };
}

// ─────────────────────────────────────────────────────────────────────────────
// scheduler.schedule_generator.missed_run — M2-owned missed-run / lag fact.
// Scope: optimization scheduler only. Bounded by the caller: emitted when the
// optimization module itself detects that a heartbeat is overdue at its own
// cadence. Generic missed-run semantics for every cron stay out of M2 scope.
// ─────────────────────────────────────────────────────────────────────────────

export interface SchedulerMissedRunInput {
  readonly lastObservedAt: Date;
  readonly observedAt: Date;
  readonly gapMs: number;
  readonly expectedIntervalMs: number;
}

export function emitSchedulerMissedRun(
  options: SchedulerEmitterOptions,
  input: SchedulerMissedRunInput,
): Promise<EmitRuntimeEventResult> {
  return safeEmit(options, {
    event_code: "scheduler.schedule_generator.missed_run",
    source: "m2.scheduler",
    summary: `Schedule generator missed run: ${input.gapMs}ms gap vs expected ${input.expectedIntervalMs}ms`,
    detail: {
      last_observed_at: input.lastObservedAt.toISOString(),
      observed_at: input.observedAt.toISOString(),
      gap_ms: input.gapMs,
      expected_interval_ms: input.expectedIntervalMs,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// scheduler.jobs.alive — shared phase-1 self-check. M2 contributes latest-state
// evidence when its schedule-generator heartbeat path succeeds. It does NOT
// overwrite evidence from other contributors (M4 billing, etc.); it only writes
// a single latest-state row using the shared registry and pass helper.
//
// The 'stale' posture for this self-check is owned by the cadence watchdog,
// not by M2. M2 is forbidden from flipping status to 'fail'/'stale' from
// business logic — that belongs to the M9 latest-state surface.
// ─────────────────────────────────────────────────────────────────────────────

export type RecordSchedulerJobsAliveResult =
  | { readonly status: "disabled" }
  | { readonly status: "persisted" }
  | { readonly status: "degraded_fallback"; readonly error: Error };

export interface RecordSchedulerJobsAliveInput {
  readonly observedAt: Date;
  readonly durationMs: number;
  readonly detail?: RuntimeDetailPayload | null;
  readonly runHost?: string | null;
}

export async function recordSchedulerJobsAlive(
  options: SchedulerEmitterOptions,
  input: RecordSchedulerJobsAliveInput,
): Promise<RecordSchedulerJobsAliveResult> {
  if (!isSliceEnabled(options.flags, "m2_scheduler")) {
    return { status: "disabled" };
  }
  const now = options.now ?? new Date();
  const runHost = input.runHost ?? options.runHost ?? null;

  const base = buildInitialSelfCheckRow("scheduler.jobs.alive", {
    now,
    runHost,
  });
  const row = applySelfCheckPass(base, {
    runAt: input.observedAt.toISOString(),
    durationMs: input.durationMs,
    now,
    detail: {
      contributor: "m2.scheduler",
      ...(input.detail ?? {}),
    },
  });

  try {
    if (options.client) {
      await upsertRuntimeSelfCheck(options.client, row);
    } else {
      await runWithServicePool((c) => upsertRuntimeSelfCheck(c, row));
    }
    return { status: "persisted" };
  } catch (err) {
    const error = coerceError(err);
    safeLog(options.logger, {
      phase: "scheduler_jobs_alive_write",
      error: error.message,
    });
    return { status: "degraded_fallback", error };
  }
}
