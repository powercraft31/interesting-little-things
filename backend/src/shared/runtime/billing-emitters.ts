/**
 * M4 billing runtime emitters (v6.10 WS8).
 *
 * Thin, best-effort wrappers around the shared M9 emit() surface for the M4
 * daily-billing-job lifecycle boundaries:
 *   - scheduler.billing_job.heartbeat  — successful billing-job run boundary
 *     (one informational fact per runDailyBilling() pass, NOT per asset
 *     UPSERT — per-asset volume is aggregation and belongs in M9)
 *   - scheduler.billing_job.failed     — billing-job run error boundary
 *     (the try/catch around runDailyBilling())
 *   - scheduler.billing_job.missed_run — M4-owned lag fact emitted when an
 *     M4 caller itself detects that a scheduled billing pass is overdue.
 *     M4 does NOT claim ownership of generic cron missed-run semantics;
 *     the helper is only invoked from a real M4-owned missed-run boundary
 *     (currently none — helper surface is provided for future onboarding
 *     without reopening M9 semantics)
 *   - scheduler.jobs.alive (self-check) — M4 latest-state contribution from
 *     a successful billing-job run. Uses the shared M9 registry + pass
 *     helper exclusively. Carries a contributor='m4.billing' marker so its
 *     evidence stays distinguishable from M2 (m2.scheduler) evidence on the
 *     same check_id row.
 *
 * Design invariants (mirror WS4 bff-emitters + WS5 ingest-emitters + WS6
 * scheduler-emitters + WS7 dispatch-emitters):
 *  - every helper is best-effort: awaiting is allowed but ignoring is fine.
 *    None throw to the caller. The daily billing hot path must never be
 *    coupled to runtime emission success.
 *  - when the governance flag is off OR the m4_billing slice is off, every
 *    helper is a no-op and returns status='disabled'. No DB writes occur.
 *  - fingerprint / severity / lifecycle / aggregation semantics are owned by
 *    M9 normalization + projection. M4 only declares facts at the boundary.
 *  - scheduler.jobs.alive self-check uses the M9 registry + pass helper;
 *    M4 is forbidden from inventing a parallel latest-state model and does
 *    NOT overwrite evidence from other contributors — both M2 and M4 write
 *    a single latest-state row keyed by check_id, each tagging its own
 *    contributor in latest_detail.
 *  - M4 does NOT define new runtime lifecycle rules, severity overrides, or
 *    aggregation behavior — it only names the billing-owned boundary.
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

export interface BillingEmitterOptions {
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
  return new Error(typeof err === "string" ? err : "billing-emitter: unknown");
}

async function safeEmit(
  options: BillingEmitterOptions,
  params: Parameters<typeof emitRuntimeEvent>[0],
): Promise<EmitRuntimeEventResult> {
  try {
    return await emitRuntimeEvent(params, {
      flags: options.flags,
      slice: "m4_billing",
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
  const line = `[runtime-billing:fallback] ${JSON.stringify(payload)}`;
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
// scheduler.billing_job.heartbeat — one informational fact per observed
// billing-job run boundary. Explicitly NOT per asset UPSERT — that would be
// an aggregation design, which belongs in M9.
// ─────────────────────────────────────────────────────────────────────────────

export interface BillingHeartbeatInput {
  readonly assetsSettled: number;
  readonly billingDate: string;
  readonly runStartedAt: Date;
  readonly durationMs: number;
}

export function emitBillingJobHeartbeat(
  options: BillingEmitterOptions,
  input: BillingHeartbeatInput,
): Promise<EmitRuntimeEventResult> {
  return safeEmit(options, {
    event_code: "scheduler.billing_job.heartbeat",
    source: "m4.billing",
    summary: `Billing job run: ${input.assetsSettled} assets settled for ${input.billingDate}`,
    detail: {
      assets_settled: input.assetsSettled,
      billing_date: input.billingDate,
      run_started_at: input.runStartedAt.toISOString(),
      duration_ms: input.durationMs,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// scheduler.billing_job.failed — structured error fact for the M4-owned
// billing-job boundary. Scope: daily billing job only. Generic scheduler/cron
// errors are NOT in scope.
// ─────────────────────────────────────────────────────────────────────────────

export interface BillingFailedInput {
  readonly error: Error;
  readonly billingDate?: string;
  readonly phase?: string;
}

export function emitBillingJobFailed(
  options: BillingEmitterOptions,
  input: BillingFailedInput,
): Promise<EmitRuntimeEventResult> {
  return safeEmit(options, {
    event_code: "scheduler.billing_job.failed",
    source: "m4.billing",
    summary: `Billing job failed: ${input.error.message}`,
    detail: {
      error: input.error.message,
      stack: input.error.stack ?? null,
      phase: input.phase ?? null,
      billing_date: input.billingDate ?? null,
    },
    dedup_keys: { phase: input.phase ?? "run" },
  });
}

// Canonical recovery for a previously-detected billing-job failure.
// Reuses the SAME event_code + source so the fingerprint matches the detected
// issue; M9 projection applies lifecycle_hint='recover' to the existing
// runtime_issues row. No new event code is introduced.
export interface BillingRecoveredInput {
  readonly observedAt: Date;
  readonly phase?: string;
  readonly billingDate?: string;
}

export function emitBillingJobRecovered(
  options: BillingEmitterOptions,
  input: BillingRecoveredInput,
): Promise<EmitRuntimeEventResult> {
  return safeEmit(options, {
    event_code: "scheduler.billing_job.failed",
    source: "m4.billing",
    lifecycle_hint: "recover",
    severity: "info",
    summary: "Billing job run recovered",
    detail: {
      observed_at: input.observedAt.toISOString(),
      phase: input.phase ?? null,
      billing_date: input.billingDate ?? null,
      recovered: true,
    },
    dedup_keys: { phase: input.phase ?? "run" },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical recovery authority
//
// Mirrors the WS5 I3 / WS6 I4b / WS7 I4a pattern: process-local bookkeeping is
// insufficient because a restart between detect and recovery would lose
// authority. The canonical source of truth is the runtime_issues row itself
// (same fingerprint as the failed event). Only when an active
// detected/ongoing cycle exists do we emit the recover event; otherwise this
// helper is a no-op so ordinary healthy billing runs (no prior failure) do
// not synthesize recovered rows on the issues surface.
//
// The fingerprint helper is PHASE-AWARE: emitBillingJobFailed() folds phase
// into dedup_keys, and computeFingerprint() merges dedup_keys into fingerprint
// dimensions. A phase-blind lookup would miss the live issue.
// ─────────────────────────────────────────────────────────────────────────────

export type MaybeEmitBillingRecoveredStatus =
  | "disabled"
  | "no_active_issue"
  | "persisted"
  | "degraded_fallback";

export interface MaybeEmitBillingRecoveredResult {
  readonly status: MaybeEmitBillingRecoveredStatus;
  readonly fingerprint?: string;
  readonly existing?: RuntimeIssue | null;
  readonly error?: Error;
}

function isActiveBillingIssue(issue: RuntimeIssue): boolean {
  return issue.state === "detected" || issue.state === "ongoing";
}

export function billingFailedFingerprintFor(phase?: string | null): string {
  return computeFingerprint({
    event_code: "scheduler.billing_job.failed",
    source: "m4.billing",
    tenant_scope: null,
    dedup_keys: { phase: phase ?? "run" },
  });
}

export async function maybeEmitBillingRecovered(
  options: BillingEmitterOptions,
  input: BillingRecoveredInput,
): Promise<MaybeEmitBillingRecoveredResult> {
  if (!isSliceEnabled(options.flags, "m4_billing")) {
    return { status: "disabled" };
  }
  const fingerprint = billingFailedFingerprintFor(input.phase);

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
      phase: "billing_recover_authority_lookup",
      fingerprint,
      error: error.message,
    });
    return { status: "degraded_fallback", fingerprint, error };
  }

  if (!existing || !isActiveBillingIssue(existing)) {
    return { status: "no_active_issue", fingerprint, existing };
  }

  const emitResult = await emitBillingJobRecovered(options, input);
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
// scheduler.billing_job.missed_run — M4-owned missed-run / lag fact.
// Scope: daily billing job only. Bounded by the caller: emitted only when the
// billing module itself detects that a run is overdue at its own cadence.
// Generic missed-run semantics for every cron stay out of M4 scope.
// ─────────────────────────────────────────────────────────────────────────────

export interface BillingMissedRunInput {
  readonly lastObservedAt: Date;
  readonly observedAt: Date;
  readonly gapMs: number;
  readonly expectedIntervalMs: number;
}

export function emitBillingJobMissedRun(
  options: BillingEmitterOptions,
  input: BillingMissedRunInput,
): Promise<EmitRuntimeEventResult> {
  return safeEmit(options, {
    event_code: "scheduler.billing_job.missed_run",
    source: "m4.billing",
    summary: `Billing job missed run: ${input.gapMs}ms gap vs expected ${input.expectedIntervalMs}ms`,
    detail: {
      last_observed_at: input.lastObservedAt.toISOString(),
      observed_at: input.observedAt.toISOString(),
      gap_ms: input.gapMs,
      expected_interval_ms: input.expectedIntervalMs,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// scheduler.jobs.alive — shared phase-1 self-check. M4 contributes latest-state
// evidence when its billing-job run boundary succeeds. It does NOT overwrite
// evidence from M2 in a way that erases ownership: both contributors write a
// single latest-state row keyed by check_id, each tagging its own contributor
// in latest_detail so readers can distinguish M2 vs. M4 evidence.
//
// The 'stale' posture for this self-check is owned by the cadence watchdog,
// not by M4. M4 is forbidden from flipping status to 'fail'/'stale' from
// business logic — that belongs to the M9 latest-state surface.
// ─────────────────────────────────────────────────────────────────────────────

export type RecordBillingJobsAliveResult =
  | { readonly status: "disabled" }
  | { readonly status: "persisted" }
  | { readonly status: "degraded_fallback"; readonly error: Error };

export interface RecordBillingJobsAliveInput {
  readonly observedAt: Date;
  readonly durationMs: number;
  readonly detail?: RuntimeDetailPayload | null;
  readonly runHost?: string | null;
}

export async function recordBillingJobsAlive(
  options: BillingEmitterOptions,
  input: RecordBillingJobsAliveInput,
): Promise<RecordBillingJobsAliveResult> {
  if (!isSliceEnabled(options.flags, "m4_billing")) {
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
      contributor: "m4.billing",
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
      phase: "billing_jobs_alive_write",
      error: error.message,
    });
    return { status: "degraded_fallback", error };
  }
}
