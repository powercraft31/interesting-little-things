// ---------------------------------------------------------------------------
// GET /api/runtime/issues/:fingerprint — Single issue + recent event tail
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
  fetchRecentRuntimeEventsByFingerprint,
  fetchRuntimeIssueByFingerprint,
  runWithServicePool,
} from "../../shared/runtime/persistence";

const DEFAULT_EVENT_TAIL = 50;

function extractFingerprint(rawPath: string): string | null {
  // expected: /api/runtime/issues/:fingerprint
  const parts = rawPath.split("/").filter(Boolean);
  const idx = parts.indexOf("issues");
  if (idx < 0 || parts.length <= idx + 1) return null;
  const fp = decodeURIComponent(parts[idx + 1]);
  return fp.length > 0 ? fp : null;
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

  const fingerprint = extractFingerprint(event.rawPath);
  if (!fingerprint) {
    return apiError(400, "fingerprint is required");
  }

  const flags = parseRuntimeFlags(process.env);
  if (!flags.governanceEnabled) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        ok({
          overall: "disabled" as const,
          issue: null,
          events: [],
        }),
      ),
    };
  }

  try {
    const { issue, events } = await runWithServicePool(async (client) => {
      const row = await fetchRuntimeIssueByFingerprint(client, fingerprint);
      if (!row) {
        return { issue: null, events: [] as const };
      }
      const tail = await fetchRecentRuntimeEventsByFingerprint(
        client,
        fingerprint,
        DEFAULT_EVENT_TAIL,
      );
      return { issue: row, events: tail };
    });

    if (!issue) {
      return apiError(404, `No runtime issue for fingerprint '${fingerprint}'`);
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        ok({
          overall: "ok" as const,
          issue,
          events,
        }),
      ),
    };
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error("[get-runtime-issue-detail] Error:", e);
    return apiError(500, e.message ?? "Internal server error");
  }
}
