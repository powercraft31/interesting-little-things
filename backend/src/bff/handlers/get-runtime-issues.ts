// ---------------------------------------------------------------------------
// GET /api/runtime/issues — Active/recovered runtime issue list (operator read)
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
  fetchActiveRuntimeIssues,
  runWithServicePool,
} from "../../shared/runtime/persistence";

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
          issues: [],
        }),
      ),
    };
  }

  try {
    const issues = await runWithServicePool((client) =>
      fetchActiveRuntimeIssues(client),
    );
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        ok({
          overall: "ok" as const,
          issues,
        }),
      ),
    };
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error("[get-runtime-issues] Error:", e);
    return apiError(500, e.message ?? "Internal server error");
  }
}
