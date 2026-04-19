// ---------------------------------------------------------------------------
// GET /api/runtime/health — Runtime governance derived platform health summary
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
  fetchLatestSelfChecks,
  runWithServicePool,
} from "../../shared/runtime/persistence";
import {
  allSelfChecksPassing,
  countCriticalOpenIssues,
  deriveComponentStates,
  deriveOverallPosture,
} from "../../shared/runtime/health";
import { runtimeDisabledHealth } from "../../shared/runtime/config";

function disabledResponse(): APIGatewayProxyResultV2 {
  const posture = runtimeDisabledHealth();
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      ok({
        overall: posture.overall,
        components: {},
        criticalOpenCount: posture.criticalOpenCount,
        selfCheckAllPass: posture.selfCheckAllPass,
        capturedAt: posture.capturedAt,
      }),
    ),
  };
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
    return disabledResponse();
  }

  try {
    const { activeIssues, selfChecks } = await runWithServicePool(
      async (client) => {
        const [issues, checks] = await Promise.all([
          fetchActiveRuntimeIssues(client),
          fetchLatestSelfChecks(client),
        ]);
        return { activeIssues: issues, selfChecks: checks };
      },
    );

    const overall = deriveOverallPosture({ activeIssues, selfChecks });
    const components = deriveComponentStates({ activeIssues, selfChecks });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        ok({
          overall,
          components,
          criticalOpenCount: countCriticalOpenIssues(activeIssues),
          selfCheckAllPass: allSelfChecksPassing(selfChecks),
          capturedAt: new Date().toISOString(),
        }),
      ),
    };
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error("[get-runtime-health] Error:", e);
    return apiError(500, e.message ?? "Internal server error");
  }
}
