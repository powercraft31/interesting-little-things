// ---------------------------------------------------------------------------
// POST /api/runtime/issues/:fingerprint/suppress — Operator suppress
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
import { executeOperatorSuppress } from "../../shared/runtime/operator-actions";

interface SuppressRequestBody {
  readonly until?: string;
  readonly note?: string | null;
}

function extractFingerprint(rawPath: string): string | null {
  const parts = rawPath.split("/").filter(Boolean);
  const idx = parts.indexOf("issues");
  if (idx < 0 || parts.length <= idx + 1) return null;
  const fp = decodeURIComponent(parts[idx + 1]);
  return fp.length > 0 ? fp : null;
}

function parseBody(event: APIGatewayProxyEventV2): SuppressRequestBody | null {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body) as SuppressRequestBody;
  } catch {
    return null;
  }
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  let actor: string;
  try {
    const ctx = extractTenantContext(event);
    requireRole(ctx, [Role.SOLFACIL_ADMIN]);
    actor = `operator:${ctx.userId}`;
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    return apiError(e.statusCode ?? 401, e.message ?? "Unauthorized");
  }

  const flags = parseRuntimeFlags(process.env);
  if (!flags.governanceEnabled) {
    return apiError(503, "Runtime governance is disabled");
  }

  const fingerprint = extractFingerprint(event.rawPath);
  if (!fingerprint) {
    return apiError(400, "fingerprint is required");
  }

  const body = parseBody(event);
  if (body === null) {
    return apiError(400, "Invalid JSON body");
  }

  if (typeof body.until !== "string" || body.until.length === 0) {
    return apiError(400, "until is required (ISO-8601 timestamp)");
  }

  const until = new Date(body.until);
  if (Number.isNaN(until.getTime())) {
    return apiError(400, "until must be a valid ISO-8601 timestamp");
  }
  if (until.getTime() <= Date.now()) {
    return apiError(400, "until must be in the future");
  }

  const note =
    typeof body.note === "string" && body.note.length > 0 ? body.note : null;

  try {
    const result = await executeOperatorSuppress(fingerprint, {
      actor,
      until: until.toISOString(),
      note,
    });
    if (result.status === "not_found") {
      return apiError(
        404,
        `No runtime issue for fingerprint '${fingerprint}'`,
      );
    }
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ok({ issue: result.issue })),
    };
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error("[post-runtime-issue-suppress] Error:", e);
    return apiError(500, e.message ?? "Internal server error");
  }
}
