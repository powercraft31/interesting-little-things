// ---------------------------------------------------------------------------
// GET /api/runtime/events — Retained raw runtime-event tail (operator read)
// WS3 (v6.10 M5 operator API) — SOLFACIL_ADMIN only
// ---------------------------------------------------------------------------
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { ok } from "../../shared/types/api";
import { Role } from "../../shared/types/auth";
import { extractTenantContext, requireRole, apiError } from "../middleware/auth";
import { parseRuntimeFlags } from "../../shared/runtime/flags";
import {
  fetchRecentRuntimeEvents,
  runWithServicePool,
} from "../../shared/runtime/persistence";

const DEFAULT_EVENT_LIMIT = 100;
const MAX_EVENT_LIMIT = 500;

function parseLimit(event: APIGatewayProxyEventV2): number {
  const raw = event.queryStringParameters?.limit;
  if (raw === undefined) return DEFAULT_EVENT_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_EVENT_LIMIT;
  return Math.min(MAX_EVENT_LIMIT, parsed);
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  try {
    const ctx = extractTenantContext(event);
    requireRole(ctx, [Role.SOLFACIL_ADMIN]);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    return apiError(e.statusCode ?? 401, e.message ?? "Unauthorized");
  }

  const flags = parseRuntimeFlags(process.env);
  if (!flags.governanceEnabled) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        ok({
          overall: "disabled" as const,
          events: [],
        }),
      ),
    };
  }

  const limit = parseLimit(event);

  try {
    const events = await runWithServicePool((client) =>
      fetchRecentRuntimeEvents(client, limit),
    );
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        ok({
          overall: "ok" as const,
          events,
        }),
      ),
    };
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error("[get-runtime-events] Error:", e);
    return apiError(500, e.message ?? "Internal server error");
  }
}
