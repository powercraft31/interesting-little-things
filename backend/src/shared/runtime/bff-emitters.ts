/**
 * BFF runtime emitters (v6.10 WS4).
 *
 * Thin, best-effort wrappers around the shared emit() surface for the boot
 * lifecycle, the top-level unhandled-exception boundary, and the bounded auth
 * anomaly path. Modules call these directly instead of hand-rolling a
 * normalize+persist loop.
 *
 * Design invariants:
 *  - every helper is fire-and-forget-safe: awaiting is allowed but ignoring
 *    the result is fine. None of them throw.
 *  - when the governance flag (or bff_db slice) is off, every helper is a
 *    no-op and returns status='disabled'.
 *  - wrapHandlerWithRuntimeBoundary preserves the caller's response contract:
 *    an unhandled exception becomes a 500 JSON envelope identical to what
 *    BFF handlers already produce via apiError().
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { emitRuntimeEvent, type EmitRuntimeEventResult } from "./emit";
import type { RuntimeFlags } from "./flags";
import type { RuntimeQueryable } from "./persistence";

// ─────────────────────────────────────────────────────────────────────────────
// Shared options shape
// ─────────────────────────────────────────────────────────────────────────────

export interface BffEmitterOptions {
  readonly flags: RuntimeFlags;
  readonly client?: RuntimeQueryable;
  readonly logger?: (line: string) => void;
  readonly now?: Date;
}

function coerceError(err: unknown): Error {
  if (err instanceof Error) {
    return err;
  }
  return new Error(typeof err === "string" ? err : "bff-emitter: unknown");
}

async function safeEmit(
  options: BffEmitterOptions,
  params: Parameters<typeof emitRuntimeEvent>[0],
): Promise<EmitRuntimeEventResult> {
  try {
    return await emitRuntimeEvent(params, {
      flags: options.flags,
      slice: "bff_db",
      client: options.client,
      logger: options.logger,
      now: options.now,
    });
  } catch (err) {
    const error = coerceError(err);
    return { status: "degraded_fallback", error };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Boot lifecycle
// ─────────────────────────────────────────────────────────────────────────────

export function emitBffBootStarted(
  options: BffEmitterOptions,
): Promise<EmitRuntimeEventResult> {
  return safeEmit(options, {
    event_code: "bff.boot.started",
    source: "bff",
    summary: "BFF boot sequence started",
  });
}

export function emitBffBootReady(
  options: BffEmitterOptions,
): Promise<EmitRuntimeEventResult> {
  return safeEmit(options, {
    event_code: "bff.boot.ready",
    source: "bff",
    summary: "BFF accepted first listen callback",
  });
}

export function emitBffBootFailed(
  options: BffEmitterOptions,
  err: Error,
): Promise<EmitRuntimeEventResult> {
  return safeEmit(options, {
    event_code: "bff.boot.failed",
    source: "bff",
    summary: "BFF boot sequence failed",
    detail: { error: err.message, stack: err.stack ?? null },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-level unhandled exception
// ─────────────────────────────────────────────────────────────────────────────

export interface UnhandledExceptionInput {
  readonly route: string;
  readonly error: Error;
}

export function emitBffUnhandledException(
  options: BffEmitterOptions,
  input: UnhandledExceptionInput,
): Promise<EmitRuntimeEventResult> {
  return safeEmit(options, {
    event_code: "bff.handler.unhandled_exception",
    source: "bff",
    summary: `Unhandled exception at ${input.route}`,
    detail: {
      route: input.route,
      error: input.error.message,
      stack: input.error.stack ?? null,
    },
    dedup_keys: { route: input.route },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 500 envelope helper — matches apiError() shape so the top-level boundary
// stays drop-in compatible with BFF handler expectations.
// ─────────────────────────────────────────────────────────────────────────────

function internalServerErrorResponse(): APIGatewayProxyResultV2 {
  return {
    statusCode: 500,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      success: false,
      error: "Internal server error",
      data: null,
      timestamp: new Date().toISOString(),
    }),
  };
}

function routeKeyOf(event: APIGatewayProxyEventV2): string {
  return (
    event.routeKey ??
    `${event.requestContext?.http?.method ?? "UNKNOWN"} ${event.rawPath ?? "/"}`
  );
}

/**
 * Wrap a Lambda-style handler with a top-level runtime boundary.
 *
 * If the inner handler throws, the wrapper:
 *   1. fires emitBffUnhandledException (best-effort; emit errors are
 *      swallowed so the response path stays intact).
 *   2. returns a 500 JSON envelope matching apiError().
 *
 * Successful handler results pass through unchanged — the wrapper adds
 * exactly one observability hook and no other behavior.
 */
export type LambdaHandler = (
  event: APIGatewayProxyEventV2,
) => Promise<APIGatewayProxyResultV2>;

export function wrapHandlerWithRuntimeBoundary(
  handler: LambdaHandler,
  options: BffEmitterOptions,
): LambdaHandler {
  return async (event) => {
    try {
      return await handler(event);
    } catch (err) {
      const error = coerceError(err);
      // emit is best-effort; do not await in a way that can reach the caller.
      try {
        await emitBffUnhandledException(options, {
          route: routeKeyOf(event),
          error,
        });
      } catch {
        /* emit itself is wrapped by safeEmit; this catch is belt-and-braces */
      }
      return internalServerErrorResponse();
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bounded auth anomaly emission
//
// Intentionally narrow: invoked only when the abuse-control middleware crosses
// its IP or email threshold. Single event per threshold crossing — we do NOT
// eventify every 401 from /api/auth/login. Dedup dimension is tenant_scope so
// per-IP/per-email bursts project to distinct runtime_issues rows.
// ─────────────────────────────────────────────────────────────────────────────

export type BffAuthAnomalyReason =
  | "ip_threshold_exceeded"
  | "email_threshold_exceeded";

export interface BffAuthAnomalyInput {
  readonly tenantScope: string;
  readonly reason: BffAuthAnomalyReason;
  readonly retryAfterSeconds?: number;
}

export function emitBffAuthAnomalyBurst(
  options: BffEmitterOptions,
  input: BffAuthAnomalyInput,
): Promise<EmitRuntimeEventResult> {
  return safeEmit(options, {
    event_code: "bff.auth.anomaly_burst",
    source: "bff",
    summary: `Auth anomaly burst: ${input.reason}`,
    tenant_scope: input.tenantScope,
    detail: {
      reason: input.reason,
      retry_after_seconds: input.retryAfterSeconds ?? null,
    },
    dedup_keys: { tenant_scope: input.tenantScope },
  });
}
