import { createHash, randomUUID } from "crypto";
import {
  RUNTIME_LIFECYCLE_HINTS,
  RUNTIME_SEVERITIES,
  type RuntimeEventInput,
  type RuntimeLifecycleHint,
  type RuntimeSeverity,
} from "../types/runtime";

// ─────────────────────────────────────────────────────────────────────────────
// Closed event-code registry. Modules must pick a code from this list; they
// MUST NOT invent ad-hoc codes at the emitter boundary (see
// 09_SHARED_LAYER_v6.10.md §4.2 — emitters declare facts, spine owns semantics).
// ─────────────────────────────────────────────────────────────────────────────

export interface RuntimeEventCodeSpec {
  readonly code: string;
  readonly source: string;
  readonly defaultSeverity: RuntimeSeverity;
  readonly defaultLifecycle: RuntimeLifecycleHint | null;
  /** Fields folded into the fingerprint besides event_code + source. */
  readonly dedupDimensions: readonly string[];
}

function spec(s: RuntimeEventCodeSpec): RuntimeEventCodeSpec {
  return Object.freeze({
    ...s,
    dedupDimensions: Object.freeze([...s.dedupDimensions]),
  });
}

export const RUNTIME_EVENT_CODES: readonly RuntimeEventCodeSpec[] = Object.freeze([
  // ── BFF surface ────────────────────────────────────────────────
  spec({
    code: "bff.boot.started",
    source: "bff",
    defaultSeverity: "info",
    defaultLifecycle: "ongoing",
    dedupDimensions: ["event_code", "source"],
  }),
  spec({
    code: "bff.boot.ready",
    source: "bff",
    defaultSeverity: "info",
    defaultLifecycle: "recover",
    dedupDimensions: ["event_code", "source"],
  }),
  spec({
    code: "bff.boot.failed",
    source: "bff",
    defaultSeverity: "critical",
    defaultLifecycle: "detect",
    dedupDimensions: ["event_code", "source"],
  }),
  spec({
    code: "bff.handler.unhandled_exception",
    source: "bff",
    defaultSeverity: "critical",
    defaultLifecycle: "detect",
    dedupDimensions: ["event_code", "source", "route"],
  }),
  spec({
    code: "bff.auth.anomaly_burst",
    source: "bff",
    defaultSeverity: "warning",
    defaultLifecycle: "detect",
    dedupDimensions: ["event_code", "source", "tenant_scope"],
  }),
  spec({
    code: "bff.listen.down",
    source: "bff",
    defaultSeverity: "critical",
    defaultLifecycle: "detect",
    dedupDimensions: ["event_code", "source"],
  }),

  // ── DB substrate ───────────────────────────────────────────────
  spec({
    code: "db.app_pool.unreachable",
    source: "db",
    defaultSeverity: "critical",
    defaultLifecycle: "detect",
    dedupDimensions: ["event_code", "source"],
  }),
  spec({
    code: "db.service_pool.unreachable",
    source: "db",
    defaultSeverity: "critical",
    defaultLifecycle: "detect",
    dedupDimensions: ["event_code", "source"],
  }),
  spec({
    code: "db.critical_query.failed",
    source: "db",
    defaultSeverity: "critical",
    defaultLifecycle: "detect",
    dedupDimensions: ["event_code", "source"],
  }),
  spec({
    code: "db.pool.idle_error",
    source: "db",
    defaultSeverity: "warning",
    defaultLifecycle: "detect",
    dedupDimensions: ["event_code", "source", "pool"],
  }),

  // ── Shared runtime housekeeping ────────────────────────────────
  spec({
    code: "storage.retention.executor.failed",
    source: "shared.runtime",
    defaultSeverity: "critical",
    defaultLifecycle: "detect",
    dedupDimensions: ["event_code", "source", "phase"],
  }),

  // ── M1 ingest ──────────────────────────────────────────────────
  spec({
    code: "ingest.telemetry.stale",
    source: "m1.ingest",
    defaultSeverity: "degraded",
    defaultLifecycle: "detect",
    dedupDimensions: ["event_code", "source", "tenant_scope"],
  }),
  spec({
    code: "ingest.fragment.backlog",
    source: "m1.ingest",
    defaultSeverity: "warning",
    defaultLifecycle: "detect",
    dedupDimensions: ["event_code", "source"],
  }),
  spec({
    code: "ingest.parser.failed",
    source: "m1.ingest",
    defaultSeverity: "warning",
    defaultLifecycle: "detect",
    dedupDimensions: ["event_code", "source", "parser_id"],
  }),

  // ── M2 scheduler (optimization) ────────────────────────────────
  spec({
    code: "scheduler.schedule_generator.heartbeat",
    source: "m2.scheduler",
    defaultSeverity: "info",
    defaultLifecycle: "ongoing",
    dedupDimensions: ["event_code", "source"],
  }),
  spec({
    code: "scheduler.schedule_generator.failed",
    source: "m2.scheduler",
    defaultSeverity: "degraded",
    defaultLifecycle: "detect",
    dedupDimensions: ["event_code", "source"],
  }),
  spec({
    code: "scheduler.schedule_generator.missed_run",
    source: "m2.scheduler",
    defaultSeverity: "warning",
    defaultLifecycle: "detect",
    dedupDimensions: ["event_code", "source"],
  }),

  // ── M3 dispatch ────────────────────────────────────────────────
  spec({
    code: "dispatch.loop.heartbeat",
    source: "m3.dispatch",
    defaultSeverity: "info",
    defaultLifecycle: "ongoing",
    dedupDimensions: ["event_code", "source"],
  }),
  spec({
    code: "dispatch.loop.stalled",
    source: "m3.dispatch",
    defaultSeverity: "critical",
    defaultLifecycle: "detect",
    dedupDimensions: ["event_code", "source"],
  }),
  spec({
    code: "dispatch.timeout_checker.heartbeat",
    source: "m3.dispatch",
    defaultSeverity: "info",
    defaultLifecycle: "ongoing",
    dedupDimensions: ["event_code", "source"],
  }),
  spec({
    code: "dispatch.ack.stalled",
    source: "m3.dispatch",
    defaultSeverity: "degraded",
    defaultLifecycle: "detect",
    dedupDimensions: ["event_code", "source", "tenant_scope"],
  }),

  // ── M4 billing ─────────────────────────────────────────────────
  spec({
    code: "scheduler.billing_job.heartbeat",
    source: "m4.billing",
    defaultSeverity: "info",
    defaultLifecycle: "ongoing",
    dedupDimensions: ["event_code", "source"],
  }),
  spec({
    code: "scheduler.billing_job.failed",
    source: "m4.billing",
    defaultSeverity: "degraded",
    defaultLifecycle: "detect",
    dedupDimensions: ["event_code", "source"],
  }),
  spec({
    code: "scheduler.billing_job.missed_run",
    source: "m4.billing",
    defaultSeverity: "warning",
    defaultLifecycle: "detect",
    dedupDimensions: ["event_code", "source"],
  }),
]);

const CODE_INDEX: ReadonlyMap<string, RuntimeEventCodeSpec> = new Map(
  RUNTIME_EVENT_CODES.map((s) => [s.code, s]),
);

export function getEventCodeSpec(code: string): RuntimeEventCodeSpec | undefined {
  return CODE_INDEX.get(code);
}

export function isKnownEventCode(code: string): boolean {
  return CODE_INDEX.has(code);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fingerprint
//
// Deterministic short hex digest of (event_code, source, declared dedup
// dimension values). This is the identity of a runtime issue row.
// ─────────────────────────────────────────────────────────────────────────────

function readDimensionValue(
  input: RuntimeEventInput,
  dimension: string,
): string {
  if (dimension === "event_code") {
    return input.event_code;
  }
  if (dimension === "source") {
    return input.source;
  }
  if (dimension === "tenant_scope") {
    return input.tenant_scope ?? "";
  }
  if (input.dedup_keys && dimension in input.dedup_keys) {
    const raw = input.dedup_keys[dimension];
    return raw === null || raw === undefined ? "" : String(raw);
  }
  // Unknown registry dimension: absent on this input → empty slot.
  return "";
}

function computeFromSpec(
  input: RuntimeEventInput,
  dimensions: readonly string[],
): string {
  const parts: string[] = [];
  for (const dim of dimensions) {
    parts.push(`${dim}=${readDimensionValue(input, dim)}`);
  }
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

export function computeFingerprint(input: RuntimeEventInput): string {
  if (input.fingerprint && input.fingerprint.length > 0) {
    return input.fingerprint;
  }
  const registered = CODE_INDEX.get(input.event_code);
  const dims = registered?.dedupDimensions ?? ["event_code", "source"];
  const dedupKeyDims = input.dedup_keys ? Object.keys(input.dedup_keys) : [];
  const merged = [...dims];
  for (const extra of dedupKeyDims) {
    if (!merged.includes(extra)) {
      merged.push(extra);
    }
  }
  return computeFromSpec(input, merged);
}

// ─────────────────────────────────────────────────────────────────────────────
// normalizeEventInput — fills registry defaults, fingerprint, and timestamps.
// Throws on unregistered codes so modules cannot smuggle in ad-hoc semantics.
// ─────────────────────────────────────────────────────────────────────────────

export interface NormalizedRuntimeEvent {
  readonly event_id: string;
  readonly event_code: string;
  readonly source: string;
  readonly severity: RuntimeSeverity;
  readonly lifecycle_hint: RuntimeLifecycleHint | null;
  readonly occurred_at: string;
  readonly observed_at: string;
  readonly fingerprint: string;
  readonly correlation_id: string | null;
  readonly tenant_scope: string | null;
  readonly summary: string | null;
  readonly detail: Record<string, unknown> | null;
}

export function normalizeEventInput(
  input: RuntimeEventInput,
  now: Date = new Date(),
): NormalizedRuntimeEvent {
  const registered = CODE_INDEX.get(input.event_code);
  if (!registered) {
    throw new Error(
      `runtime-contract: unknown event_code "${input.event_code}". Register it in RUNTIME_EVENT_CODES before emitting.`,
    );
  }
  const severity: RuntimeSeverity = input.severity ?? registered.defaultSeverity;
  if (!(RUNTIME_SEVERITIES as readonly string[]).includes(severity)) {
    throw new Error(`runtime-contract: invalid severity "${severity}"`);
  }

  const lifecycle_hint: RuntimeLifecycleHint | null =
    input.lifecycle_hint !== undefined
      ? input.lifecycle_hint
      : registered.defaultLifecycle;
  if (
    lifecycle_hint !== null &&
    !(RUNTIME_LIFECYCLE_HINTS as readonly string[]).includes(lifecycle_hint)
  ) {
    throw new Error(
      `runtime-contract: invalid lifecycle_hint "${lifecycle_hint}"`,
    );
  }

  const observed_at = input.observed_at ?? now.toISOString();
  const occurred_at = input.occurred_at ?? observed_at;

  return {
    event_id: input.event_id ?? randomUUID(),
    event_code: input.event_code,
    source: input.source,
    severity,
    lifecycle_hint,
    occurred_at,
    observed_at,
    fingerprint: computeFingerprint(input),
    correlation_id: input.correlation_id ?? null,
    tenant_scope: input.tenant_scope ?? null,
    summary: input.summary ?? null,
    detail: input.detail ?? null,
  };
}
