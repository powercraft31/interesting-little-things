import {
  normalizeEventInput,
  type NormalizedRuntimeEvent,
} from "./contract";
import {
  isRuntimeGovernanceEnabled,
  isSliceEnabled,
  type RuntimeFlags,
  type RuntimeSlice,
} from "./flags";
import {
  fetchRuntimeIssueByFingerprint,
  insertRuntimeEvent,
  runWithServicePool,
  upsertRuntimeIssue,
  type RuntimeQueryable,
} from "./persistence";
import { projectEventToIssue } from "./projection";
import type { RuntimeEventInput } from "../types/runtime";

// ─────────────────────────────────────────────────────────────────────────────
// Runtime event emit surface (v6.10 M9 shared-layer spine)
//
// Contract guarantees:
//   - feature-flag-gated: returns 'disabled' without any side-effects when the
//     global gate or the per-slice flag is off.
//   - best-effort: all persistence failures are caught and reported via the
//     result. The caller is never made to handle a runtime-governance error.
//   - stdout fallback: when persistence fails, a structured single-line log
//     is written via the provided logger (defaults to console.error) as a
//     last-resort operator signal.
// ─────────────────────────────────────────────────────────────────────────────

export type EmitStatus = "disabled" | "persisted" | "degraded_fallback";

export interface EmitRuntimeEventResult {
  readonly status: EmitStatus;
  readonly event?: NormalizedRuntimeEvent;
  readonly error?: Error;
}

export interface EmitRuntimeEventOptions {
  readonly flags: RuntimeFlags;
  readonly slice: RuntimeSlice;
  /** Optional override for persistence. Absent → use service pool. */
  readonly client?: RuntimeQueryable;
  readonly now?: Date;
  /** Fallback sink for degraded-mode structured log. Defaults to console.error. */
  readonly logger?: (line: string) => void;
}

export interface EmitRuntimeGovernanceOptions {
  readonly flags: RuntimeFlags;
  readonly client?: RuntimeQueryable;
  readonly now?: Date;
  readonly logger?: (line: string) => void;
}

export type EmitRuntimeGovernanceResult = EmitRuntimeEventResult;

function coerceError(err: unknown): Error {
  if (err instanceof Error) {
    return err;
  }
  return new Error(typeof err === "string" ? err : "runtime-emit: unknown error");
}

function emitFallbackLog(
  logger: ((line: string) => void) | undefined,
  payload: Record<string, unknown>,
): void {
  const line = `[runtime-emit:fallback] ${JSON.stringify(payload)}`;
  if (logger) {
    try {
      logger(line);
    } catch {
      // never let a logger bug bubble up
    }
    return;
  }
  // Default: stderr, matching existing DB-pool error channel.
  // eslint-disable-next-line no-console
  console.error(line);
}

async function persistWithClient(
  client: RuntimeQueryable,
  event: NormalizedRuntimeEvent,
  now: Date,
): Promise<void> {
  await insertRuntimeEvent(client, event);

  let existing = null;
  try {
    existing = await fetchRuntimeIssueByFingerprint(client, event.fingerprint);
  } catch {
    // SELECT failure is recoverable: we proceed as if no existing row was found.
    // The upsert path is idempotent-by-fingerprint so we still converge on the
    // correct runtime_issues identity.
    existing = null;
  }

  const projected = projectEventToIssue({
    event,
    existing: existing ?? undefined,
    now,
  }).row;
  await upsertRuntimeIssue(client, projected);
}

export async function emitRuntimeGovernanceEvent(
  input: RuntimeEventInput,
  options: EmitRuntimeGovernanceOptions,
): Promise<EmitRuntimeGovernanceResult> {
  if (!isRuntimeGovernanceEnabled(options.flags)) {
    return { status: "disabled" };
  }

  const now = options.now ?? new Date();

  let event: NormalizedRuntimeEvent;
  try {
    event = normalizeEventInput(input, now);
  } catch (err) {
    const error = coerceError(err);
    emitFallbackLog(options.logger, {
      phase: "normalize",
      slice: "shared_runtime",
      event_code: input.event_code,
      source: input.source,
      error: error.message,
    });
    return { status: "degraded_fallback", error };
  }

  try {
    if (options.client) {
      await persistWithClient(options.client, event, now);
    } else {
      await runWithServicePool((client) => persistWithClient(client, event, now));
    }
    return { status: "persisted", event };
  } catch (err) {
    const error = coerceError(err);
    emitFallbackLog(options.logger, {
      phase: "persist",
      slice: "shared_runtime",
      event_code: event.event_code,
      source: event.source,
      fingerprint: event.fingerprint,
      severity: event.severity,
      summary: event.summary,
      error: error.message,
    });
    return { status: "degraded_fallback", event, error };
  }
}

export async function emitRuntimeEvent(
  input: RuntimeEventInput,
  options: EmitRuntimeEventOptions,
): Promise<EmitRuntimeEventResult> {
  if (!isSliceEnabled(options.flags, options.slice)) {
    return { status: "disabled" };
  }

  return emitRuntimeGovernanceEvent(input, options);
}
