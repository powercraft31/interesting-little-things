/**
 * M1 ingest runtime emitters (v6.10 WS5).
 *
 * Thin, best-effort wrappers around the shared M9 emit() surface for the M1
 * ingest lifecycle boundaries:
 *   - ingest.telemetry.stale        — gateway-level telemetry gap boundary
 *   - ingest.fragment.backlog       — fragment-assembler backlog crossed threshold
 *   - ingest.parser.failed          — parser / adapter / timestamp rejection
 *   - ingest.freshness (self-check) — latest-state pass/stale for M1 cadence
 *
 * Design invariants (mirrors WS4 bff-emitters):
 *  - every helper is best-effort: awaiting is allowed but ignoring is fine.
 *    None throw to the caller. M1 hot paths (telemetry write, backfill trigger,
 *    heartbeat update) are never coupled to runtime emission.
 *  - when the governance flag is off OR the m1_ingest slice is off, every
 *    helper is a no-op and returns status='disabled'. No DB writes occur.
 *  - fingerprint / severity / lifecycle semantics are owned by M9 normalization
 *    + projection. M1 only declares facts at the boundary.
 *  - ingest.freshness self-check uses the M9 registry + pass/stale helpers;
 *    M1 is forbidden from inventing a parallel latest-state model.
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
  applySelfCheckStale,
  buildInitialSelfCheckRow,
} from "./self-check";
import type { RuntimeDetailPayload, RuntimeIssue } from "../types/runtime";

export interface IngestEmitterOptions {
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
  return new Error(typeof err === "string" ? err : "ingest-emitter: unknown");
}

async function safeEmit(
  options: IngestEmitterOptions,
  params: Parameters<typeof emitRuntimeEvent>[0],
): Promise<EmitRuntimeEventResult> {
  try {
    return await emitRuntimeEvent(params, {
      flags: options.flags,
      slice: "m1_ingest",
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
  const line = `[runtime-ingest:fallback] ${JSON.stringify(payload)}`;
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
// ingest.telemetry.stale — bounded by real gateway-level gap detection
// ─────────────────────────────────────────────────────────────────────────────

export interface IngestTelemetryStaleInput {
  readonly tenantScope: string;
  readonly gatewayId: string;
  readonly lastObservedAt: Date;
  readonly observedAt: Date;
  readonly staleForMs: number;
  readonly thresholdMs: number;
}

export function emitIngestTelemetryStale(
  options: IngestEmitterOptions,
  input: IngestTelemetryStaleInput,
): Promise<EmitRuntimeEventResult> {
  return safeEmit(options, {
    event_code: "ingest.telemetry.stale",
    source: "m1.ingest",
    summary: `Telemetry stale for gateway ${input.gatewayId}`,
    tenant_scope: input.tenantScope,
    detail: {
      gateway_id: input.gatewayId,
      last_observed_at: input.lastObservedAt.toISOString(),
      observed_at: input.observedAt.toISOString(),
      stale_for_ms: input.staleForMs,
      threshold_ms: input.thresholdMs,
    },
  });
}

// Canonical recovery for a previously-detected stale-telemetry episode.
// Reuses the SAME event_code + source + tenant_scope so the fingerprint
// matches the detected issue; M9 projection applies lifecycle_hint='recover'
// to the existing runtime_issues row. No new event code is introduced.
export interface IngestTelemetryRecoveredInput {
  readonly tenantScope: string;
  readonly gatewayId: string;
  readonly lastObservedAt: Date;
  readonly observedAt: Date;
  readonly gapMs: number;
}

export function emitIngestTelemetryRecovered(
  options: IngestEmitterOptions,
  input: IngestTelemetryRecoveredInput,
): Promise<EmitRuntimeEventResult> {
  return safeEmit(options, {
    event_code: "ingest.telemetry.stale",
    source: "m1.ingest",
    lifecycle_hint: "recover",
    severity: "info",
    summary: `Telemetry resumed for gateway ${input.gatewayId}`,
    tenant_scope: input.tenantScope,
    detail: {
      gateway_id: input.gatewayId,
      last_observed_at: input.lastObservedAt.toISOString(),
      observed_at: input.observedAt.toISOString(),
      gap_ms: input.gapMs,
      recovered: true,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical recovery authority
//
// I3 fix / review guidance: process-local stale bookkeeping is too weak —
// a restart between detect and recovery would lose authority. The canonical
// source of truth is the runtime_issues row itself (same fingerprint as the
// stale event). Only when an active detected/ongoing cycle exists do we
// emit the recover event; otherwise this helper is a no-op so we don't
// synthesize recovered rows at normal cadence.
// ─────────────────────────────────────────────────────────────────────────────

export type MaybeEmitIngestTelemetryRecoveredStatus =
  | "disabled"
  | "no_active_issue"
  | "persisted"
  | "degraded_fallback";

export interface MaybeEmitIngestTelemetryRecoveredResult {
  readonly status: MaybeEmitIngestTelemetryRecoveredStatus;
  readonly fingerprint?: string;
  readonly existing?: RuntimeIssue | null;
  readonly error?: Error;
}

function isActiveIssue(issue: RuntimeIssue): boolean {
  return issue.state === "detected" || issue.state === "ongoing";
}

export function ingestTelemetryStaleFingerprintFor(tenantScope: string): string {
  return computeFingerprint({
    event_code: "ingest.telemetry.stale",
    source: "m1.ingest",
    tenant_scope: tenantScope,
  });
}

export async function maybeEmitIngestTelemetryRecovered(
  options: IngestEmitterOptions,
  input: IngestTelemetryRecoveredInput,
): Promise<MaybeEmitIngestTelemetryRecoveredResult> {
  if (!isSliceEnabled(options.flags, "m1_ingest")) {
    return { status: "disabled" };
  }
  const fingerprint = ingestTelemetryStaleFingerprintFor(input.tenantScope);

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
      phase: "recover_authority_lookup",
      fingerprint,
      error: error.message,
    });
    return { status: "degraded_fallback", fingerprint, error };
  }

  if (!existing || !isActiveIssue(existing)) {
    return { status: "no_active_issue", fingerprint, existing };
  }

  const emitResult = await emitIngestTelemetryRecovered(options, input);
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
// ingest.fragment.backlog — bounded by threshold crossing, never per-fragment
// ─────────────────────────────────────────────────────────────────────────────

export interface IngestFragmentBacklogInput {
  readonly backlogCount: number;
  readonly thresholdCount: number;
  readonly assemblerKind: "live" | "backfill";
  readonly sampleClientIds?: readonly string[];
}

export function emitIngestFragmentBacklog(
  options: IngestEmitterOptions,
  input: IngestFragmentBacklogInput,
): Promise<EmitRuntimeEventResult> {
  return safeEmit(options, {
    event_code: "ingest.fragment.backlog",
    source: "m1.ingest",
    summary: `Fragment assembler backlog (${input.assemblerKind}) at ${input.backlogCount} / threshold ${input.thresholdCount}`,
    detail: {
      assembler_kind: input.assemblerKind,
      backlog_count: input.backlogCount,
      threshold_count: input.thresholdCount,
      sample_client_ids: input.sampleClientIds ?? [],
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ingest.parser.failed — structured parser / adapter rejection boundary
// ─────────────────────────────────────────────────────────────────────────────

export interface IngestParserFailedInput {
  readonly parserId: string;
  readonly error: Error;
  readonly orgId?: string;
  readonly deviceId?: string;
  readonly gatewayId?: string;
  readonly reason?: string;
}

export function emitIngestParserFailed(
  options: IngestEmitterOptions,
  input: IngestParserFailedInput,
): Promise<EmitRuntimeEventResult> {
  return safeEmit(options, {
    event_code: "ingest.parser.failed",
    source: "m1.ingest",
    summary: `Ingest parser failed: ${input.parserId}`,
    detail: {
      parser_id: input.parserId,
      error: input.error.message,
      org_id: input.orgId ?? null,
      device_id: input.deviceId ?? null,
      gateway_id: input.gatewayId ?? null,
      reason: input.reason ?? null,
    },
    dedup_keys: { parser_id: input.parserId },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ingest.freshness — latest-state self-check (pass on activity, stale on gap)
// ─────────────────────────────────────────────────────────────────────────────

export type IngestFreshnessStatus = "pass" | "stale";

export type IngestFreshnessResult =
  | { readonly status: "disabled" }
  | { readonly status: "persisted" }
  | { readonly status: "degraded_fallback"; readonly error: Error };

export interface RecordIngestFreshnessInput {
  readonly status: IngestFreshnessStatus;
  readonly observedAt: Date;
  readonly detail?: RuntimeDetailPayload | null;
  readonly runHost?: string | null;
}

export async function recordIngestFreshness(
  options: IngestEmitterOptions,
  input: RecordIngestFreshnessInput,
): Promise<IngestFreshnessResult> {
  if (!isSliceEnabled(options.flags, "m1_ingest")) {
    return { status: "disabled" };
  }
  const now = options.now ?? new Date();
  const runHost = input.runHost ?? options.runHost ?? null;

  const base = buildInitialSelfCheckRow("ingest.freshness", {
    now,
    runHost,
  });
  const row =
    input.status === "pass"
      ? applySelfCheckPass(base, {
          runAt: input.observedAt.toISOString(),
          durationMs: 0,
          now,
          detail: input.detail ?? null,
        })
      : applySelfCheckStale(base, { now, detail: input.detail ?? null });

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
      phase: "ingest_freshness_write",
      status: input.status,
      error: error.message,
    });
    return { status: "degraded_fallback", error };
  }
}
