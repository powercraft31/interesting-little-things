import type { NormalizedRuntimeEvent } from "./contract";
import {
  RUNTIME_SEVERITIES,
  type RuntimeIssue,
  type RuntimeSeverity,
} from "../types/runtime";

// ─────────────────────────────────────────────────────────────────────────────
// Projection rules (v6.10 M9 spine)
//
// Invariants enforced here:
//   - one mutable runtime_issues row per fingerprint (identity is fingerprint)
//   - reopen increments cycle_count on the same row; never creates a new identity
//   - suppressed ≠ closed: a suppressed cycle still exists and can observe events
//   - timestamps are carried through as strings (ISO-8601) to match storage layer
// ─────────────────────────────────────────────────────────────────────────────

export interface ProjectEventInput {
  readonly event: NormalizedRuntimeEvent;
  readonly existing?: RuntimeIssue;
  readonly now?: Date;
}

export interface ProjectedIssue {
  readonly row: RuntimeIssue;
  readonly isNew: boolean;
  readonly cycleStarted: boolean;
}

function severityRank(s: RuntimeSeverity): number {
  return RUNTIME_SEVERITIES.indexOf(s);
}

function maxSeverity(a: RuntimeSeverity, b: RuntimeSeverity): RuntimeSeverity {
  return severityRank(b) > severityRank(a) ? b : a;
}

function nowIso(input: ProjectEventInput): string {
  return (input.now ?? new Date()).toISOString();
}

function buildNewRow(
  event: NormalizedRuntimeEvent,
  updated_at: string,
): RuntimeIssue {
  return {
    fingerprint: event.fingerprint,
    event_code: event.event_code,
    source: event.source,
    tenant_scope: event.tenant_scope,
    cycle_count: 1,
    current_cycle_started_at: event.observed_at,
    first_detected_at: event.observed_at,
    last_observed_at: event.observed_at,
    recovered_at: null,
    closed_at: null,
    suppressed_until: null,
    state: "detected",
    current_severity: event.severity,
    observation_count: 1,
    summary: event.summary,
    latest_detail: event.detail,
    operator_note: null,
    operator_actor: null,
    updated_at,
  };
}

function reopenRow(
  existing: RuntimeIssue,
  event: NormalizedRuntimeEvent,
  updated_at: string,
): RuntimeIssue {
  return {
    ...existing,
    cycle_count: existing.cycle_count + 1,
    current_cycle_started_at: event.observed_at,
    last_observed_at: event.observed_at,
    recovered_at: null,
    closed_at: null,
    suppressed_until: null,
    state: "detected",
    current_severity: event.severity,
    observation_count: 1,
    summary: event.summary ?? existing.summary,
    latest_detail: event.detail ?? existing.latest_detail,
    updated_at,
  };
}

function updateOngoing(
  existing: RuntimeIssue,
  event: NormalizedRuntimeEvent,
  updated_at: string,
): RuntimeIssue {
  return {
    ...existing,
    state: "ongoing",
    last_observed_at: event.observed_at,
    observation_count: existing.observation_count + 1,
    current_severity: maxSeverity(existing.current_severity, event.severity),
    summary: event.summary ?? existing.summary,
    latest_detail: event.detail ?? existing.latest_detail,
    updated_at,
  };
}

function applyRecover(
  existing: RuntimeIssue,
  event: NormalizedRuntimeEvent,
  updated_at: string,
): RuntimeIssue {
  if (existing.state === "closed" || existing.state === "suppressed") {
    // Keep terminal/muted state; just update last_observed_at if we saw the event.
    return {
      ...existing,
      last_observed_at: event.observed_at,
      updated_at,
    };
  }
  return {
    ...existing,
    state: "recovered",
    recovered_at: event.observed_at,
    last_observed_at: event.observed_at,
    observation_count: existing.observation_count + 1,
    summary: event.summary ?? existing.summary,
    latest_detail: event.detail ?? existing.latest_detail,
    updated_at,
  };
}

function applySuppressedObservation(
  existing: RuntimeIssue,
  event: NormalizedRuntimeEvent,
  updated_at: string,
): RuntimeIssue {
  // Suppressed cycles still observe facts but stay muted from active summary.
  return {
    ...existing,
    last_observed_at: event.observed_at,
    observation_count: existing.observation_count + 1,
    latest_detail: event.detail ?? existing.latest_detail,
    updated_at,
  };
}

export function projectEventToIssue(input: ProjectEventInput): ProjectedIssue {
  const { event, existing } = input;
  const updated_at = nowIso(input);

  // ── No existing row: honor lifecycle hint ────────────────────────
  if (!existing) {
    // A recover / close / suppress event with no prior row is effectively
    // a no-op projection; we still want to acknowledge the fact. Create a
    // synthetic recovered row so operators see state without inflating
    // active counts.
    if (event.lifecycle_hint === "recover") {
      const synthetic = buildNewRow(event, updated_at);
      return {
        row: {
          ...synthetic,
          state: "recovered",
          recovered_at: event.observed_at,
        },
        isNew: true,
        cycleStarted: true,
      };
    }
    return {
      row: buildNewRow(event, updated_at),
      isNew: true,
      cycleStarted: true,
    };
  }

  // ── Existing row: lifecycle-hint dispatch ────────────────────────
  switch (event.lifecycle_hint) {
    case "recover":
      return {
        row: applyRecover(existing, event, updated_at),
        isNew: false,
        cycleStarted: false,
      };

    case "close":
      // Emit-driven close is rare — operator path is the authoritative surface.
      return {
        row: {
          ...existing,
          state: "closed",
          closed_at: event.observed_at,
          last_observed_at: event.observed_at,
          updated_at,
        },
        isNew: false,
        cycleStarted: false,
      };

    case "suppress":
      return {
        row: {
          ...existing,
          state: "suppressed",
          last_observed_at: event.observed_at,
          updated_at,
        },
        isNew: false,
        cycleStarted: false,
      };

    // 'detect' or 'ongoing' observation (or null hint):
    case "detect":
    case "ongoing":
    case null:
    case undefined:
    default: {
      if (existing.state === "recovered" || existing.state === "closed") {
        return {
          row: reopenRow(existing, event, updated_at),
          isNew: false,
          cycleStarted: true,
        };
      }
      if (existing.state === "suppressed") {
        return {
          row: applySuppressedObservation(existing, event, updated_at),
          isNew: false,
          cycleStarted: false,
        };
      }
      // detected / ongoing → keep same cycle, bump observation_count
      return {
        row: updateOngoing(existing, event, updated_at),
        isNew: false,
        cycleStarted: false,
      };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Operator mutations — applied at the spine, not in handler SQL.
// ─────────────────────────────────────────────────────────────────────────────

export interface OperatorCloseInput {
  readonly actor: string;
  readonly note?: string | null;
  readonly now?: Date;
}

export function applyOperatorClose(
  existing: RuntimeIssue,
  input: OperatorCloseInput,
): RuntimeIssue {
  const updated_at = (input.now ?? new Date()).toISOString();
  return {
    ...existing,
    state: "closed",
    closed_at: updated_at,
    operator_actor: input.actor,
    operator_note: input.note ?? existing.operator_note,
    updated_at,
  };
}

export interface OperatorSuppressInput {
  readonly actor: string;
  readonly until: string;
  readonly note?: string | null;
  readonly now?: Date;
}

export function applyOperatorSuppress(
  existing: RuntimeIssue,
  input: OperatorSuppressInput,
): RuntimeIssue {
  const updated_at = (input.now ?? new Date()).toISOString();
  return {
    ...existing,
    state: "suppressed",
    suppressed_until: input.until,
    operator_actor: input.actor,
    operator_note: input.note ?? existing.operator_note,
    updated_at,
  };
}

export interface OperatorNoteInput {
  readonly actor: string;
  readonly note: string;
  readonly now?: Date;
}

export function applyOperatorNote(
  existing: RuntimeIssue,
  input: OperatorNoteInput,
): RuntimeIssue {
  const updated_at = (input.now ?? new Date()).toISOString();
  return {
    ...existing,
    operator_actor: input.actor,
    operator_note: input.note,
    updated_at,
  };
}
