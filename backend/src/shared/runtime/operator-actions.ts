import {
  fetchRuntimeIssueByFingerprint,
  runWithServicePool,
  upsertRuntimeIssue,
  type RuntimeQueryable,
} from "./persistence";
import {
  applyOperatorClose,
  applyOperatorNote,
  applyOperatorSuppress,
  type OperatorCloseInput,
  type OperatorNoteInput,
  type OperatorSuppressInput,
} from "./projection";
import type { RuntimeIssue } from "../types/runtime";

// ─────────────────────────────────────────────────────────────────────────────
// Operator-action orchestrators (v6.10 M9 shared-layer spine)
//
// Handlers MUST route close / suppress / note mutations through these helpers
// rather than issuing raw UPDATE statements. Each helper:
//   1. loads the current runtime_issues row by fingerprint (via service pool)
//   2. applies the pure projection transform
//   3. writes the transformed row back through upsertRuntimeIssue
//
// If no row exists for the given fingerprint, operators receive `null` so the
// handler can return a 404 without duplicating lookup logic.
// ─────────────────────────────────────────────────────────────────────────────

export type OperatorActionResult =
  | { readonly status: "applied"; readonly issue: RuntimeIssue }
  | { readonly status: "not_found" };

export interface OperatorActionOptions {
  readonly client?: RuntimeQueryable;
}

async function runOperator<T>(
  options: OperatorActionOptions,
  fn: (client: RuntimeQueryable) => Promise<T>,
): Promise<T> {
  if (options.client) {
    return fn(options.client);
  }
  return runWithServicePool((client) => fn(client));
}

export async function executeOperatorClose(
  fingerprint: string,
  input: OperatorCloseInput,
  options: OperatorActionOptions = {},
): Promise<OperatorActionResult> {
  return runOperator(options, async (client) => {
    const existing = await fetchRuntimeIssueByFingerprint(client, fingerprint);
    if (!existing) {
      return { status: "not_found" } as const;
    }
    const next = applyOperatorClose(existing, input);
    await upsertRuntimeIssue(client, next);
    return { status: "applied", issue: next } as const;
  });
}

export async function executeOperatorSuppress(
  fingerprint: string,
  input: OperatorSuppressInput,
  options: OperatorActionOptions = {},
): Promise<OperatorActionResult> {
  return runOperator(options, async (client) => {
    const existing = await fetchRuntimeIssueByFingerprint(client, fingerprint);
    if (!existing) {
      return { status: "not_found" } as const;
    }
    const next = applyOperatorSuppress(existing, input);
    await upsertRuntimeIssue(client, next);
    return { status: "applied", issue: next } as const;
  });
}

export async function executeOperatorNote(
  fingerprint: string,
  input: OperatorNoteInput,
  options: OperatorActionOptions = {},
): Promise<OperatorActionResult> {
  return runOperator(options, async (client) => {
    const existing = await fetchRuntimeIssueByFingerprint(client, fingerprint);
    if (!existing) {
      return { status: "not_found" } as const;
    }
    const next = applyOperatorNote(existing, input);
    await upsertRuntimeIssue(client, next);
    return { status: "applied", issue: next } as const;
  });
}
