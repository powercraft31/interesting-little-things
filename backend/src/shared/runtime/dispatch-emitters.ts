/**
 * M3 dispatch runtime emitters (v6.10 WS7).
 *
 * Thin, best-effort wrappers around the shared M9 emit() surface for the M3
 * dispatch lifecycle boundaries:
 *   - dispatch.loop.heartbeat            — successful dispatcher run boundary
 *     (one informational fact per dispatcher pass, NOT per dispatched command)
 *   - dispatch.loop.stalled              — dispatcher run non-progression
 *     boundary (the try/catch around runCommandDispatcher — the loop failed
 *     to make progress this cycle)
 *   - dispatch.timeout_checker.heartbeat — successful timeout-checker run
 *     boundary (one informational fact per timeout-checker pass)
 *   - dispatch.ack.stalled               — stale-ack condition observed at
 *     the timeout-checker boundary when dispatch_commands rows are marked
 *     failed for timing out in 'dispatched'. Only emitted when there is a
 *     real stale-ack population, never per ordinary failure
 *   - dispatch.loop.alive (self-check)   — M3 latest-state contribution from
 *     successful dispatcher run progress
 *
 * Design invariants (mirror WS4 bff-emitters + WS5 ingest-emitters + WS6
 * scheduler-emitters):
 *  - every helper is best-effort: awaiting is allowed but ignoring is fine.
 *    None throw to the caller. The dispatcher / timeout-checker / ACK hot
 *    paths must never be coupled to runtime emission success.
 *  - when the governance flag is off OR the m3_dispatch slice is off, every
 *    helper is a no-op and returns status='disabled'. No DB writes occur.
 *  - fingerprint / severity / lifecycle / aggregation semantics are owned by
 *    M9 normalization + projection. M3 only declares facts at the boundary.
 *  - dispatch.loop.alive self-check uses the M9 registry + pass helper;
 *    M3 is forbidden from inventing a parallel latest-state model.
 *  - M3 does NOT define new runtime lifecycle rules, severity overrides, or
 *    aggregation behavior — it only names the dispatch-owned boundary.
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

export interface DispatchEmitterOptions {
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
  return new Error(typeof err === "string" ? err : "dispatch-emitter: unknown");
}

async function safeEmit(
  options: DispatchEmitterOptions,
  params: Parameters<typeof emitRuntimeEvent>[0],
): Promise<EmitRuntimeEventResult> {
  try {
    return await emitRuntimeEvent(params, {
      flags: options.flags,
      slice: "m3_dispatch",
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
  const line = `[runtime-dispatch:fallback] ${JSON.stringify(payload)}`;
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
// dispatch.loop.heartbeat — one informational fact per observed dispatcher
// run boundary. Explicitly NOT per dispatched command — that would be an
// aggregation design, which belongs in M9.
// ─────────────────────────────────────────────────────────────────────────────

export interface DispatchLoopHeartbeatInput {
  readonly commandsDispatched: number;
  readonly runStartedAt: Date;
  readonly durationMs: number;
}

export function emitDispatchLoopHeartbeat(
  options: DispatchEmitterOptions,
  input: DispatchLoopHeartbeatInput,
): Promise<EmitRuntimeEventResult> {
  return safeEmit(options, {
    event_code: "dispatch.loop.heartbeat",
    source: "m3.dispatch",
    summary: `Dispatch loop run: ${input.commandsDispatched} commands dispatched`,
    detail: {
      commands_dispatched: input.commandsDispatched,
      run_started_at: input.runStartedAt.toISOString(),
      duration_ms: input.durationMs,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// dispatch.loop.stalled — dispatcher-run non-progression boundary. Scope:
// dispatcher failed to make progress this cycle (try/catch around
// runCommandDispatcher). Not per-command failure and not ordinary ACK errors.
// ─────────────────────────────────────────────────────────────────────────────

export interface DispatchLoopStalledInput {
  readonly error: Error;
  readonly runStartedAt: Date;
  readonly phase?: string;
}

export function emitDispatchLoopStalled(
  options: DispatchEmitterOptions,
  input: DispatchLoopStalledInput,
): Promise<EmitRuntimeEventResult> {
  return safeEmit(options, {
    event_code: "dispatch.loop.stalled",
    source: "m3.dispatch",
    summary: `Dispatch loop stalled: ${input.error.message}`,
    detail: {
      error: input.error.message,
      stack: input.error.stack ?? null,
      phase: input.phase ?? "run",
      run_started_at: input.runStartedAt.toISOString(),
    },
    dedup_keys: { phase: input.phase ?? "run" },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// dispatch.timeout_checker.heartbeat — one informational fact per timeout
// checker run boundary. Emitted from the timeout-checker's own boundary,
// independently of the main dispatch loop heartbeat.
// ─────────────────────────────────────────────────────────────────────────────

export interface DispatchTimeoutCheckerHeartbeatInput {
  readonly staleCommandsFailed: number;
  readonly runStartedAt: Date;
  readonly durationMs: number;
}

export function emitDispatchTimeoutCheckerHeartbeat(
  options: DispatchEmitterOptions,
  input: DispatchTimeoutCheckerHeartbeatInput,
): Promise<EmitRuntimeEventResult> {
  return safeEmit(options, {
    event_code: "dispatch.timeout_checker.heartbeat",
    source: "m3.dispatch",
    summary: `Dispatch timeout checker run: ${input.staleCommandsFailed} stale command(s) failed`,
    detail: {
      stale_commands_failed: input.staleCommandsFailed,
      run_started_at: input.runStartedAt.toISOString(),
      duration_ms: input.durationMs,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// dispatch.ack.stalled — stale-ack boundary. Emitted only when the timeout
// checker finds a real stale-ack population (dispatch_commands stuck in
// 'dispatched' past the cutoff). Scope: no-progress in ACK path only,
// explicitly NOT every ACK failure and not a projection of ordinary ACK flow.
// ─────────────────────────────────────────────────────────────────────────────

export interface DispatchAckStalledInput {
  readonly staleCount: number;
  readonly cutoffSeconds: number;
  readonly observedAt: Date;
  readonly tenantScope?: string | null;
  readonly sampleDispatchIds?: readonly number[];
}

export function emitDispatchAckStalled(
  options: DispatchEmitterOptions,
  input: DispatchAckStalledInput,
): Promise<EmitRuntimeEventResult> {
  return safeEmit(options, {
    event_code: "dispatch.ack.stalled",
    source: "m3.dispatch",
    summary: `Dispatch ACK stalled: ${input.staleCount} command(s) past ${input.cutoffSeconds}s`,
    tenant_scope: input.tenantScope ?? null,
    detail: {
      stale_count: input.staleCount,
      cutoff_seconds: input.cutoffSeconds,
      observed_at: input.observedAt.toISOString(),
      sample_dispatch_ids: input.sampleDispatchIds ?? [],
    },
  });
}

// Canonical recovery for a previously-detected dispatch ACK stall episode.
// Reuses the SAME event_code + source + tenant_scope so the fingerprint
// matches the detected issue; M9 projection applies lifecycle_hint='recover'
// to the existing runtime_issues row. No new event code is introduced.
export interface DispatchAckRecoveredInput {
  readonly cutoffSeconds: number;
  readonly observedAt: Date;
  readonly tenantScope?: string | null;
}

export function emitDispatchAckRecovered(
  options: DispatchEmitterOptions,
  input: DispatchAckRecoveredInput,
): Promise<EmitRuntimeEventResult> {
  return safeEmit(options, {
    event_code: "dispatch.ack.stalled",
    source: "m3.dispatch",
    lifecycle_hint: "recover",
    severity: "info",
    summary: "Dispatch ACK backlog cleared",
    tenant_scope: input.tenantScope ?? null,
    detail: {
      cutoff_seconds: input.cutoffSeconds,
      observed_at: input.observedAt.toISOString(),
      recovered: true,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical recovery authority
//
// Mirrors the WS5 I3 pattern: process-local stale bookkeeping is insufficient
// because a restart between detect and recovery would lose authority. The
// canonical source of truth is the runtime_issues row itself (same fingerprint
// as the stale event). Only when an active detected/ongoing cycle exists do we
// emit the recover event; otherwise this helper is a no-op so ordinary
// timeout-checker runs (no stale rows, no prior stall) do not synthesize
// recovered rows on the issues surface.
// ─────────────────────────────────────────────────────────────────────────────

export type MaybeEmitDispatchAckRecoveredStatus =
  | "disabled"
  | "no_active_issue"
  | "persisted"
  | "degraded_fallback";

export interface MaybeEmitDispatchAckRecoveredResult {
  readonly status: MaybeEmitDispatchAckRecoveredStatus;
  readonly fingerprint?: string;
  readonly existing?: RuntimeIssue | null;
  readonly error?: Error;
}

function isActiveDispatchIssue(issue: RuntimeIssue): boolean {
  return issue.state === "detected" || issue.state === "ongoing";
}

export function dispatchAckStalledFingerprintFor(
  tenantScope?: string | null,
): string {
  return computeFingerprint({
    event_code: "dispatch.ack.stalled",
    source: "m3.dispatch",
    tenant_scope: tenantScope ?? null,
  });
}

export async function maybeEmitDispatchAckRecovered(
  options: DispatchEmitterOptions,
  input: DispatchAckRecoveredInput,
): Promise<MaybeEmitDispatchAckRecoveredResult> {
  if (!isSliceEnabled(options.flags, "m3_dispatch")) {
    return { status: "disabled" };
  }
  const fingerprint = dispatchAckStalledFingerprintFor(input.tenantScope);

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
      phase: "dispatch_ack_recover_authority_lookup",
      fingerprint,
      error: error.message,
    });
    return { status: "degraded_fallback", fingerprint, error };
  }

  if (!existing || !isActiveDispatchIssue(existing)) {
    return { status: "no_active_issue", fingerprint, existing };
  }

  const emitResult = await emitDispatchAckRecovered(options, input);
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
// dispatch.loop.alive — shared phase-1 self-check. M3 contributes latest-state
// evidence when its dispatcher run boundary succeeds. It uses the shared
// registry + pass helper exclusively — no parallel latest-state model.
//
// The 'stale' posture for this self-check is owned by the cadence watchdog,
// not by M3. M3 is forbidden from flipping status to 'fail'/'stale' from
// business logic — that belongs to the M9 latest-state surface.
// ─────────────────────────────────────────────────────────────────────────────

export type RecordDispatchLoopAliveResult =
  | { readonly status: "disabled" }
  | { readonly status: "persisted" }
  | { readonly status: "degraded_fallback"; readonly error: Error };

export interface RecordDispatchLoopAliveInput {
  readonly observedAt: Date;
  readonly durationMs: number;
  readonly detail?: RuntimeDetailPayload | null;
  readonly runHost?: string | null;
}

export async function recordDispatchLoopAlive(
  options: DispatchEmitterOptions,
  input: RecordDispatchLoopAliveInput,
): Promise<RecordDispatchLoopAliveResult> {
  if (!isSliceEnabled(options.flags, "m3_dispatch")) {
    return { status: "disabled" };
  }
  const now = options.now ?? new Date();
  const runHost = input.runHost ?? options.runHost ?? null;

  const base = buildInitialSelfCheckRow("dispatch.loop.alive", {
    now,
    runHost,
  });
  const row = applySelfCheckPass(base, {
    runAt: input.observedAt.toISOString(),
    durationMs: input.durationMs,
    now,
    detail: {
      contributor: "m3.dispatch",
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
      phase: "dispatch_loop_alive_write",
      error: error.message,
    });
    return { status: "degraded_fallback", error };
  }
}
