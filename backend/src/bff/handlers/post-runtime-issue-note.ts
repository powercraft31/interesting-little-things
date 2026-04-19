// ---------------------------------------------------------------------------
// POST /api/runtime/issues/:fingerprint/note — Operator note
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
import { executeOperatorNote } from "../../shared/runtime/operator-actions";

interface NoteRequestBody {
  readonly note?: string;
}

function extractFingerprint(rawPath: string): string | null {
  const parts = rawPath.split("/").filter(Boolean);
  const idx = parts.indexOf("issues");
  if (idx < 0 || parts.length <= idx + 1) return null;
  const fp = decodeURIComponent(parts[idx + 1]);
  return fp.length > 0 ? fp : null;
}

function parseBody(event: APIGatewayProxyEventV2): NoteRequestBody | null {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body) as NoteRequestBody;
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

  if (typeof body.note !== "string" || body.note.length === 0) {
    return apiError(400, "note is required");
  }

  try {
    const result = await executeOperatorNote(fingerprint, {
      actor,
      note: body.note,
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
    console.error("[post-runtime-issue-note] Error:", e);
    return apiError(500, e.message ?? "Internal server error");
  }
}
