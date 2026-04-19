import type {
  RuntimeHealthSnapshot,
  RuntimeIssue,
  RuntimePersistedOverall,
  RuntimeSelfCheckRow,
  RuntimeSeverity,
} from "../types/runtime";

// ─────────────────────────────────────────────────────────────────────────────
// Runtime health derivation (v6.10 M9 shared-layer spine)
//
// Pure, plain-object helpers that translate (active runtime_issues rows,
// latest runtime_self_checks rows) into the persisted overall posture.
//
// Contract invariants:
//   - derivation helpers NEVER return 'disabled' — that is an API-layer
//     concern handled by config.ts / runtimeDisabledHealth().
//   - only 'detected' and 'ongoing' issue states contribute to severity.
//     'recovered', 'closed', and 'suppressed' are excluded from overall.
// ─────────────────────────────────────────────────────────────────────────────

export const SELF_CHECK_CRITICAL_FAIL_THRESHOLD = 3;

const PERSISTED_RANK: Readonly<Record<RuntimePersistedOverall, number>> =
  Object.freeze({
    ok: 0,
    warning: 1,
    degraded: 2,
    critical: 3,
  });

function maxOverall(
  a: RuntimePersistedOverall,
  b: RuntimePersistedOverall,
): RuntimePersistedOverall {
  return PERSISTED_RANK[b] > PERSISTED_RANK[a] ? b : a;
}

function severityToOverall(
  severity: RuntimeSeverity,
): RuntimePersistedOverall {
  switch (severity) {
    case "critical":
      return "critical";
    case "degraded":
      return "degraded";
    case "warning":
    case "notice":
      return "warning";
    case "info":
    default:
      return "ok";
  }
}

function isActiveForSeverity(issue: RuntimeIssue): boolean {
  return issue.state === "detected" || issue.state === "ongoing";
}

function selfCheckContribution(
  row: RuntimeSelfCheckRow,
): RuntimePersistedOverall {
  if (
    row.last_status === "fail" &&
    row.consecutive_failures >= SELF_CHECK_CRITICAL_FAIL_THRESHOLD
  ) {
    return "critical";
  }
  if (row.last_status === "fail") {
    return "warning";
  }
  if (row.last_status === "stale") {
    return "warning";
  }
  return "ok";
}

export interface DeriveHealthInput {
  readonly activeIssues: readonly RuntimeIssue[];
  readonly selfChecks: readonly RuntimeSelfCheckRow[];
}

export function deriveOverallPosture(
  input: DeriveHealthInput,
): RuntimePersistedOverall {
  let overall: RuntimePersistedOverall = "ok";

  for (const issue of input.activeIssues) {
    if (!isActiveForSeverity(issue)) {
      continue;
    }
    overall = maxOverall(overall, severityToOverall(issue.current_severity));
  }

  for (const row of input.selfChecks) {
    overall = maxOverall(overall, selfCheckContribution(row));
  }

  return overall;
}

export function deriveComponentStates(
  input: DeriveHealthInput,
): Readonly<Record<string, RuntimePersistedOverall>> {
  const out: Record<string, RuntimePersistedOverall> = {};

  for (const issue of input.activeIssues) {
    if (!isActiveForSeverity(issue)) {
      continue;
    }
    const contribution = severityToOverall(issue.current_severity);
    const prev = out[issue.source] ?? "ok";
    out[issue.source] = maxOverall(prev, contribution);
  }

  for (const row of input.selfChecks) {
    const contribution = selfCheckContribution(row);
    if (contribution === "ok" && out[row.source] === undefined) {
      // a passing check on a quiet source should surface as 'ok' in components
      out[row.source] = "ok";
      continue;
    }
    const prev = out[row.source] ?? "ok";
    out[row.source] = maxOverall(prev, contribution);
  }

  return Object.freeze(out);
}

export function countCriticalOpenIssues(
  activeIssues: readonly RuntimeIssue[],
): number {
  let n = 0;
  for (const issue of activeIssues) {
    if (isActiveForSeverity(issue) && issue.current_severity === "critical") {
      n += 1;
    }
  }
  return n;
}

export function allSelfChecksPassing(
  selfChecks: readonly RuntimeSelfCheckRow[],
): boolean {
  if (selfChecks.length === 0) {
    return true;
  }
  for (const row of selfChecks) {
    if (row.last_status !== "pass") {
      return false;
    }
  }
  return true;
}

export interface BuildHealthSnapshotInput extends DeriveHealthInput {
  readonly capturedAt: string;
  readonly snapshotSource: string;
}

export function buildHealthSnapshotInput(
  input: BuildHealthSnapshotInput,
): Omit<RuntimeHealthSnapshot, "id"> {
  const overall = deriveOverallPosture(input);
  const component_states = deriveComponentStates(input);
  return {
    captured_at: input.capturedAt,
    overall,
    component_states,
    critical_open_count: countCriticalOpenIssues(input.activeIssues),
    self_check_all_pass: allSelfChecksPassing(input.selfChecks),
    snapshot_source: input.snapshotSource,
  };
}
