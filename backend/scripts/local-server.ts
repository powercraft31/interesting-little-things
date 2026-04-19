import express from "express";
import path from "path";
import fs from "fs";
import cors from "cors";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";

import { handler as dashboardHandler } from "../src/bff/handlers/get-dashboard";
import { handler as assetsHandler } from "../src/bff/handlers/get-assets";
import { handler as revenueTrendHandler } from "../src/bff/handlers/get-revenue-trend";
import { handler as tradesHandler } from "../src/bff/handlers/get-trades";
// v5.12: 15 new BFF handlers
import { handler as fleetOverviewHandler } from "../src/bff/handlers/get-fleet-overview";
import { handler as fleetIntegradoresHandler } from "../src/bff/handlers/get-fleet-integradores";
import { handler as fleetOfflineEventsHandler } from "../src/bff/handlers/get-fleet-offline-events";
import { handler as fleetUptimeTrendHandler } from "../src/bff/handlers/get-fleet-uptime-trend";
import { handler as fleetChartsHandler } from "../src/bff/handlers/get-fleet-charts";
import { handler as devicesHandler } from "../src/bff/handlers/get-devices";
import { handler as gatewaysHandler } from "../src/bff/handlers/get-gateways";
import { handler as gatewayEnergyHandler } from "../src/bff/handlers/get-gateway-energy";
import { handler as gatewayEnergyStatsHandler } from "../src/bff/handlers/get-gateway-energy-stats";
import { handler as gatewaysSummaryHandler } from "../src/bff/handlers/get-gateways-summary";
import { handler as gatewayDevicesHandler } from "../src/bff/handlers/get-gateway-devices";
import { handler as deviceDetailHandler } from "../src/bff/handlers/get-device-detail";
import { handler as putDeviceHandler } from "../src/bff/handlers/put-device";
import { handler as deviceScheduleHandler } from "../src/bff/handlers/get-device-schedule";
import { handler as putDeviceScheduleHandler } from "../src/bff/handlers/put-device-schedule";
// v5.20: gateway-level detail + schedule
import { handler as gatewayDetailHandler } from "../src/bff/handlers/get-gateway-detail";
import { handler as gatewayScheduleHandler } from "../src/bff/handlers/get-gateway-schedule";
import { handler as putGatewayScheduleHandler } from "../src/bff/handlers/put-gateway-schedule";
import { handler as tariffsHandler } from "../src/bff/handlers/get-tariffs";
import { handler as hemsOverviewHandler } from "../src/bff/handlers/get-hems-overview";
import { handler as hemsDispatchHandler } from "../src/bff/handlers/post-hems-batch-dispatch";
import { handler as hemsBatchHistoryHandler } from "../src/bff/handlers/get-hems-batch-history";
import { handler as hemsTargetingHandler } from "../src/bff/handlers/get-hems-targeting";
import { handler as vppCapacityHandler } from "../src/bff/handlers/get-vpp-capacity";
import { handler as vppLatencyHandler } from "../src/bff/handlers/get-vpp-latency";
import { handler as vppDrEventsHandler } from "../src/bff/handlers/get-vpp-dr-events";
import { handler as perfScorecardHandler } from "../src/bff/handlers/get-performance-scorecard";
import { handler as perfSavingsHandler } from "../src/bff/handlers/get-performance-savings";
// v5.24: P3 Asset History View
import { handler as getAssetTelemetryHandler } from "../src/bff/handlers/get-asset-telemetry";
import { handler as getAssetHealthHandler } from "../src/bff/handlers/get-asset-health";
import { handleCceeWebhook } from "../src/open-api/handlers/ccee-webhook";
import { handleWeatherWebhook } from "../src/open-api/handlers/weather-webhook";
import { createTelemetryWebhookHandler } from "../src/iot-hub/handlers/telemetry-webhook";

import { validateJwtSecret } from "../src/shared/auth/validate-jwt-secret";
import { securityHeaders } from "../src/bff/middleware/security-headers";
import { selectRateLimitStore, createAbuseControlMiddleware } from "../src/bff/middleware/rate-limit";
import { getServicePool, closeAllPools, queryWithOrg } from "../src/shared/db";
import { authMiddleware } from "../src/bff/middleware/auth";
import { createCorsOriginValidator } from "../src/bff/middleware/cors-policy";
import { createLoginHandler, createLogoutHandler } from "../src/bff/handlers/auth-login";
import { createSessionHandler } from "../src/bff/handlers/auth-session";
import { createAdminUsersHandler } from "../src/bff/handlers/admin-users";
import { startScheduleGenerator } from "../src/optimization-engine/services/schedule-generator";
import { startCommandDispatcher } from "../src/dr-dispatcher/services/command-dispatcher";
import { startTimeoutChecker } from "../src/dr-dispatcher/handlers/timeout-checker";
import { createAckHandler } from "../src/dr-dispatcher/handlers/collect-response";
import { startBillingJob } from "../src/market-billing/services/daily-billing-job";
import { startTelemetryAggregator } from "../src/iot-hub/services/telemetry-aggregator";
import { startTelemetry5MinAggregator } from "../src/iot-hub/services/telemetry-5min-aggregator";
import { createSseHandler } from "../src/bff/handlers/sse-events";
// v6.5: P5 Strategy Triggers
import { handler as p5OverviewHandler } from "../src/bff/handlers/get-p5-overview";
import { handler as p5IntentDetailHandler } from "../src/bff/handlers/get-p5-intent-detail";
import { handler as p5IntentActionHandler } from "../src/bff/handlers/post-p5-intent-action";
import { handler as p5PostureOverrideHandler } from "../src/bff/handlers/post-p5-posture-override";
// v7.0: P6 Alerts
import { handler as alertsHandler } from "../src/bff/handlers/get-alerts";
import { handler as alertsSummaryHandler } from "../src/bff/handlers/get-alerts-summary";
// v6.10: WS3 Runtime Governance operator API
import { handler as runtimeHealthHandler } from "../src/bff/handlers/get-runtime-health";
import { handler as runtimeIssuesHandler } from "../src/bff/handlers/get-runtime-issues";
import { handler as runtimeIssueDetailHandler } from "../src/bff/handlers/get-runtime-issue-detail";
import { handler as runtimeEventsHandler } from "../src/bff/handlers/get-runtime-events";
import { handler as runtimeSelfChecksHandler } from "../src/bff/handlers/get-runtime-self-checks";
import { handler as runtimeIssueCloseHandler } from "../src/bff/handlers/post-runtime-issue-close";
import { handler as runtimeIssueSuppressHandler } from "../src/bff/handlers/post-runtime-issue-suppress";
import { handler as runtimeIssueNoteHandler } from "../src/bff/handlers/post-runtime-issue-note";

// v6.10 WS4: runtime governance emitters
import { parseRuntimeFlags } from "../src/shared/runtime/flags";
import {
  emitBffBootFailed,
  emitBffBootReady,
  emitBffBootStarted,
  emitBffAuthAnomalyBurst,
  wrapHandlerWithRuntimeBoundary,
} from "../src/shared/runtime/bff-emitters";
import {
  attachPoolIdleErrorEmitter,
  runDbSubstrateProbes,
} from "../src/shared/runtime/substrate";
import { runRuntimeRetention } from "../src/shared/runtime/retention-job";
import { getAppPool } from "../src/shared/db";

type LambdaHandler = (
  event: APIGatewayProxyEventV2,
) => Promise<APIGatewayProxyResultV2>;

// v6.9 B2: fail fast if JWT_SECRET is missing or weak
validateJwtSecret();

// v6.10 WS4: parse runtime flags once at boot. When the governance flag is
// off, every emitter is a no-op — the BFF keeps running business flows as
// if the spine were absent.
const RUNTIME_FLAGS = parseRuntimeFlags(process.env);

// v6.9 B6: abuse-control store selection (fail-fast in non-dev without Redis)
const rateLimitStore = selectRateLimitStore();
const abuseControl = createAbuseControlMiddleware(rateLimitStore, {
  onThresholdHit: async (evt) => {
    // Bounded auth anomaly fact — fires only at threshold crossings, not per 401.
    await emitBffAuthAnomalyBurst(
      { flags: RUNTIME_FLAGS },
      {
        tenantScope: evt.tenantScope,
        reason: evt.reason,
        retryAfterSeconds: evt.retryAfterSeconds,
      },
    );
  },
});

// v6.10 WS4: emit bff.boot.started at the earliest point we still have a
// functioning process. Fire-and-forget — if emit fails, boot continues.
void emitBffBootStarted({ flags: RUNTIME_FLAGS });

const PORT = Number(process.env.PORT) || 3000;

function makeStubEvent(
  req: express.Request,
  method: string,
  path: string,
): APIGatewayProxyEventV2 {
  // Build actual path from request (supports :params in Express routes)
  const actualPath = req.originalUrl.split("?")[0];
  const qs = req.originalUrl.includes("?") ? req.originalUrl.split("?")[1] : "";
  const qsParams: Record<string, string> = {};
  if (qs) {
    for (const pair of qs.split("&")) {
      const [k, v] = pair.split("=");
      if (k) qsParams[decodeURIComponent(k)] = decodeURIComponent(v ?? "");
    }
  }

  return {
    version: "2.0",
    routeKey: `${method} ${path}`,
    rawPath: actualPath,
    rawQueryString: qs,
    headers: {
      authorization: (req.headers.authorization as string) ?? "",
      "content-type": (req.headers["content-type"] as string) ?? "",
    },
    queryStringParameters:
      Object.keys(qsParams).length > 0 ? qsParams : undefined,
    body: req.body ? JSON.stringify(req.body) : undefined,
    requestContext: {
      accountId: "local",
      apiId: "local",
      domainName: "localhost",
      domainPrefix: "localhost",
      http: {
        method,
        path: actualPath,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "local-server",
      },
      requestId: "local-" + Date.now(),
      routeKey: `${method} ${path}`,
      stage: "$default",
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    isBase64Encoded: false,
  };
}

function wrapHandler(handler: LambdaHandler, method: string, path: string) {
  // v6.10 WS4: wrap every lambda handler with a top-level runtime boundary.
  // If the handler throws, we emit bff.handler.unhandled_exception (scoped
  // by route) and still return a 500 envelope — response contract unchanged.
  const bounded = wrapHandlerWithRuntimeBoundary(handler, {
    flags: RUNTIME_FLAGS,
  });
  return async (req: express.Request, res: express.Response): Promise<void> => {
    const event = makeStubEvent(req, method, path);
    const result = await bounded(event);

    const statusCode =
      typeof result === "string" ? 200 : (result.statusCode ?? 200);
    const body = typeof result === "string" ? result : (result.body ?? "");
    const headers = typeof result === "string" ? {} : (result.headers ?? {});

    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined) {
        res.setHeader(key, String(value));
      }
    }

    res.status(statusCode).send(body);
  };
}

const app = express();
app.set("trust proxy", 1);

app.use(express.json()); // Parse POST body (needed for webhooks)

// v6.9 B1: security response headers (CSP, X-Frame-Options, nosniff, etc.)
app.use(securityHeaders);

// v5.23: JWT auth middleware (replaces demo auth injection)
app.use(authMiddleware);

app.use(
  cors({
    origin: createCorsOriginValidator(),
  }),
);

app.get("/dashboard", wrapHandler(dashboardHandler, "GET", "/dashboard"));
app.get("/assets", wrapHandler(assetsHandler, "GET", "/assets"));
app.get(
  "/revenue-trend",
  wrapHandler(revenueTrendHandler, "GET", "/revenue-trend"),
);
app.get("/trades", wrapHandler(tradesHandler, "GET", "/trades"));

// ── v5.12 BFF Endpoints (15 new) ─────────────────────────────────────────
// Fleet
app.get(
  "/api/fleet/overview",
  wrapHandler(fleetOverviewHandler, "GET", "/api/fleet/overview"),
);
app.get(
  "/api/fleet/integradores",
  wrapHandler(fleetIntegradoresHandler, "GET", "/api/fleet/integradores"),
);
app.get(
  "/api/fleet/offline-events",
  wrapHandler(fleetOfflineEventsHandler, "GET", "/api/fleet/offline-events"),
);
app.get(
  "/api/fleet/uptime-trend",
  wrapHandler(fleetUptimeTrendHandler, "GET", "/api/fleet/uptime-trend"),
);
app.get(
  "/api/fleet/charts",
  wrapHandler(fleetChartsHandler, "GET", "/api/fleet/charts"),
);
// Devices & Gateways (v5.19: homes → gateways)
app.get("/api/devices", wrapHandler(devicesHandler, "GET", "/api/devices"));
app.get(
  "/api/gateways/summary",
  wrapHandler(gatewaysSummaryHandler, "GET", "/api/gateways/summary"),
);
app.get(
  "/api/gateways/:gatewayId/energy",
  wrapHandler(gatewayEnergyHandler, "GET", "/api/gateways/:gatewayId/energy"),
);
app.get(
  "/api/gateways/:gatewayId/energy-24h",
  wrapHandler(
    gatewayEnergyHandler,
    "GET",
    "/api/gateways/:gatewayId/energy-24h",
  ),
);
app.get(
  "/api/gateways/:gatewayId/energy-stats",
  wrapHandler(
    gatewayEnergyStatsHandler,
    "GET",
    "/api/gateways/:gatewayId/energy-stats",
  ),
);
app.get(
  "/api/gateways/:gatewayId/devices",
  wrapHandler(gatewayDevicesHandler, "GET", "/api/gateways/:gatewayId/devices"),
);
app.get("/api/gateways", wrapHandler(gatewaysHandler, "GET", "/api/gateways"));
// v5.20: gateway-level detail + schedule
app.get(
  "/api/gateways/:gatewayId/detail",
  wrapHandler(gatewayDetailHandler, "GET", "/api/gateways/:gatewayId/detail"),
);
app.get(
  "/api/gateways/:gatewayId/schedule",
  wrapHandler(
    gatewayScheduleHandler,
    "GET",
    "/api/gateways/:gatewayId/schedule",
  ),
);
app.put(
  "/api/gateways/:gatewayId/schedule",
  wrapHandler(
    putGatewayScheduleHandler,
    "PUT",
    "/api/gateways/:gatewayId/schedule",
  ),
);
// Device detail & config (v5.19 new — device schedule routes kept as deprecated)
app.get(
  "/api/devices/:assetId/schedule",
  wrapHandler(deviceScheduleHandler, "GET", "/api/devices/:assetId/schedule"),
);
app.put(
  "/api/devices/:assetId/schedule",
  wrapHandler(
    putDeviceScheduleHandler,
    "PUT",
    "/api/devices/:assetId/schedule",
  ),
);
app.get(
  "/api/devices/:assetId",
  wrapHandler(deviceDetailHandler, "GET", "/api/devices/:assetId"),
);
app.put(
  "/api/devices/:assetId",
  wrapHandler(putDeviceHandler, "PUT", "/api/devices/:assetId"),
);
// Tariffs (v5.19 new)
app.get("/api/tariffs", wrapHandler(tariffsHandler, "GET", "/api/tariffs"));
// HEMS
app.get(
  "/api/hems/overview",
  wrapHandler(hemsOverviewHandler, "GET", "/api/hems/overview"),
);
app.post(
  "/api/hems/batch-dispatch",
  wrapHandler(hemsDispatchHandler, "POST", "/api/hems/batch-dispatch"),
);
app.get(
  "/api/hems/batch-history",
  wrapHandler(hemsBatchHistoryHandler, "GET", "/api/hems/batch-history"),
);
// v6.4: P4 HEMS targeting (gateway fleet eligibility)
app.get(
  "/api/hems/targeting",
  wrapHandler(hemsTargetingHandler, "GET", "/api/hems/targeting"),
);
// VPP
app.get(
  "/api/vpp/capacity",
  wrapHandler(vppCapacityHandler, "GET", "/api/vpp/capacity"),
);
app.get(
  "/api/vpp/latency",
  wrapHandler(vppLatencyHandler, "GET", "/api/vpp/latency"),
);
app.get(
  "/api/vpp/dr-events",
  wrapHandler(vppDrEventsHandler, "GET", "/api/vpp/dr-events"),
);
// Performance
app.get(
  "/api/performance/scorecard",
  wrapHandler(perfScorecardHandler, "GET", "/api/performance/scorecard"),
);
app.get(
  "/api/performance/savings",
  wrapHandler(perfSavingsHandler, "GET", "/api/performance/savings"),
);
// v5.24: P3 Asset History View
app.get(
  "/api/assets/:assetId/telemetry",
  wrapHandler(
    getAssetTelemetryHandler,
    "GET",
    "/api/assets/:assetId/telemetry",
  ),
);
app.get(
  "/api/assets/:assetId/health",
  wrapHandler(getAssetHealthHandler, "GET", "/api/assets/:assetId/health"),
);
// ────────────────────────────────────────────────────────────────────────

// ── v5.7 Inbound Webhooks ────────────────────────────────────────────────
app.post("/webhooks/ccee-pld", handleCceeWebhook);
app.post("/webhooks/weather", handleWeatherWebhook);
// ────────────────────────────────────────────────────────────────────────

// ── Shared DB pool (v5.11: dual pool — service pool for cron/internal) ────
const servicePool = getServicePool();

// ── v5.23 Auth Routes ────────────────────────────────────────────────────
// v6.9 B6: abuse-control middleware wraps login only (pre-check + post-hook)
const loginHandler = createLoginHandler(servicePool);
app.post("/api/auth/login", abuseControl.preHandler, async (req, res) => {
  await loginHandler(req, res);
  await abuseControl.postHandler(req, res);
});
app.post("/api/auth/logout", createLogoutHandler());
// v6.9 B4: Browser session endpoint (cookie-only)
app.get("/api/auth/session", createSessionHandler(queryWithOrg));
app.post("/api/users", createAdminUsersHandler(servicePool));
// ────────────────────────────────────────────────────────────────────────

// ── v5.21 SSE endpoint — raw express handler, not Lambda wrapper ──────────
app.get("/api/events", createSseHandler(servicePool));
// ────────────────────────────────────────────────────────────────────────

// ── v5.8 Telemetry Feedback Loop ─────────────────────────────────────────
app.post("/api/telemetry/mock", createTelemetryWebhookHandler(servicePool));
// ────────────────────────────────────────────────────────────────────────

// ── v5.9 Dispatch ACK endpoint ──────────────────────────────────────────
app.post("/api/dispatch/ack", createAckHandler(servicePool));
// ────────────────────────────────────────────────────────────────────────

// ── P5 Strategy Triggers (v6.5) ─────────────────────────────────────────
app.get(
  "/api/p5/overview",
  wrapHandler(p5OverviewHandler, "GET", "/api/p5/overview"),
);
app.get(
  "/api/p5/intents/:intentId",
  wrapHandler(p5IntentDetailHandler, "GET", "/api/p5/intents/:intentId"),
);
app.post(
  "/api/p5/intents/:intentId/:action",
  wrapHandler(
    p5IntentActionHandler,
    "POST",
    "/api/p5/intents/:intentId/:action",
  ),
);
app.post(
  "/api/p5/posture-override",
  wrapHandler(p5PostureOverrideHandler, "POST", "/api/p5/posture-override"),
);
app.post(
  "/api/p5/posture-override/:overrideId/cancel",
  wrapHandler(
    p5PostureOverrideHandler,
    "POST",
    "/api/p5/posture-override/:overrideId/cancel",
  ),
);
// ────────────────────────────────────────────────────────────────────────

// ── P6 Alerts (v7.0) ────────────────────────────────────────────────────
app.get(
  "/api/alerts/summary",
  wrapHandler(alertsSummaryHandler, "GET", "/api/alerts/summary"),
);
app.get(
  "/api/alerts",
  wrapHandler(alertsHandler, "GET", "/api/alerts"),
);
// ────────────────────────────────────────────────────────────────────────

// ── v6.10 WS3 Runtime Governance operator API (SOLFACIL_ADMIN only) ─────
app.get(
  "/api/runtime/health",
  wrapHandler(runtimeHealthHandler, "GET", "/api/runtime/health"),
);
app.get(
  "/api/runtime/issues",
  wrapHandler(runtimeIssuesHandler, "GET", "/api/runtime/issues"),
);
app.get(
  "/api/runtime/issues/:fingerprint",
  wrapHandler(
    runtimeIssueDetailHandler,
    "GET",
    "/api/runtime/issues/:fingerprint",
  ),
);
app.get(
  "/api/runtime/events",
  wrapHandler(runtimeEventsHandler, "GET", "/api/runtime/events"),
);
app.get(
  "/api/runtime/self-checks",
  wrapHandler(runtimeSelfChecksHandler, "GET", "/api/runtime/self-checks"),
);
app.post(
  "/api/runtime/issues/:fingerprint/close",
  wrapHandler(
    runtimeIssueCloseHandler,
    "POST",
    "/api/runtime/issues/:fingerprint/close",
  ),
);
app.post(
  "/api/runtime/issues/:fingerprint/suppress",
  wrapHandler(
    runtimeIssueSuppressHandler,
    "POST",
    "/api/runtime/issues/:fingerprint/suppress",
  ),
);
app.post(
  "/api/runtime/issues/:fingerprint/note",
  wrapHandler(
    runtimeIssueNoteHandler,
    "POST",
    "/api/runtime/issues/:fingerprint/note",
  ),
);
// ────────────────────────────────────────────────────────────────────────

// ── v5.6 System Heartbeat: 啟動自動化管線 ──────────────────────────────
startScheduleGenerator(servicePool); // M2: 每小時生成 trade_schedules
startCommandDispatcher(servicePool); // M3: 每分鐘推進狀態機 → dispatch_commands
startTimeoutChecker(servicePool); // M3: 每分鐘檢查 stale dispatches → failed (v5.9)
startBillingJob(servicePool); // M4: 每天 00:05 結算 revenue_daily
console.log("[v5.6] System heartbeat started: M2/M3/M4 pipelines active");
// ────────────────────────────────────────────────────────────────────────

// ── v5.8 Telemetry Aggregator (hourly cron) ──────────────────────────────
startTelemetryAggregator(servicePool);
console.log(
  "[v5.8] Telemetry aggregator started: hourly rollup to asset_hourly_metrics",
);
// ────────────────────────────────────────────────────────────────────────

// ── v5.15 5-Min Telemetry Aggregator ─────────────────────────────────────
startTelemetry5MinAggregator(servicePool);
console.log(
  "[v5.15] 5-min aggregator started: telemetry_history → asset_5min_metrics",
);
// ────────────────────────────────────────────────────────────────────────

// ── Static frontend serving (v5.23: removed /frontend-v2/ path, added /login) ──
// Docker: /app/dist/scripts → ../../frontend-v2 = /app/frontend-v2
// Local:  backend/dist/scripts → ../../../frontend-v2 = repo-root/frontend-v2
const FRONTEND_DOCKER = path.resolve(__dirname, "../../frontend-v2");
const FRONTEND_LOCAL = path.resolve(__dirname, "../../../frontend-v2");
const FRONTEND_DIR = fs.existsSync(FRONTEND_DOCKER)
  ? FRONTEND_DOCKER
  : FRONTEND_LOCAL;
app.use(express.static(FRONTEND_DIR));
app.get("/", (_req, res) =>
  res.sendFile(path.join(FRONTEND_DIR, "index.html")),
);
app.get("/login", (_req, res) =>
  res.sendFile(path.join(FRONTEND_DIR, "login.html")),
);
// ────────────────────────────────────────────────────────────────────────

// v6.10 WS4: register structured pool idle-error emitters. These replace the
// free-form console.error paths in shared/db.ts with a bounded runtime fact
// (db.pool.idle_error) when governance is on. When off, the listener fires
// but emit no-ops.
attachPoolIdleErrorEmitter(getAppPool(), {
  pool: "app",
  flags: RUNTIME_FLAGS,
});
attachPoolIdleErrorEmitter(servicePool, {
  pool: "service",
  flags: RUNTIME_FLAGS,
});

// v6.10 WS4: run one DB substrate probe cycle shortly after boot so operators
// see baseline self-check state. Non-fatal — any failure degrades to fallback
// log via the shared emitter, business flows continue regardless.
void runDbSubstrateProbes({
  flags: RUNTIME_FLAGS,
  appPool: getAppPool(),
  servicePool,
});

// v6.10 WS10: schedule the runtime retention executor best-effort.
// Runs once shortly after boot and then on a fixed interval. The executor is
// a full no-op when governance is off, so enabling the schedule here is safe
// under disabled-mode. Any persistence failure is captured inside the
// executor and surfaced via the shared fallback logger — it must NEVER throw
// into the business request path.
const RUNTIME_RETENTION_INTERVAL_MS = Number(
  process.env.RUNTIME_RETENTION_INTERVAL_MS ?? 60 * 60 * 1000,
);

function scheduleRuntimeRetention(): void {
  if (!RUNTIME_FLAGS.governanceEnabled) {
    return;
  }
  const tick = async (): Promise<void> => {
    try {
      const result = await runRuntimeRetention({ flags: RUNTIME_FLAGS });
      if (result.status === "degraded_fallback") {
        console.error(
          `[runtime-retention:scheduler] ${JSON.stringify({
            status: result.status,
            errors: result.errors,
            recoveredAutoClosed: result.recoveredAutoClosed,
            staleAutoClosed: result.staleAutoClosed,
            eventsDeleted: result.eventsDeleted,
            snapshotsDeleted: result.snapshotsDeleted,
            closedIssuesDeleted: result.closedIssuesDeleted,
            deviceCommandLogsArchived: result.deviceCommandLogsArchived,
            deviceCommandLogsDeleted: result.deviceCommandLogsDeleted,
            gatewayAlarmEventsArchived: result.gatewayAlarmEventsArchived,
            gatewayAlarmEventsDeleted: result.gatewayAlarmEventsDeleted,
            backfillRequestsDeleted: result.backfillRequestsDeleted,
          })}`,
        );
      }
    } catch {
      // runRuntimeRetention is internally best-effort; this guard is defensive.
    }
  };
  // Stagger the first tick so boot is not slowed by retention.
  const firstDelayMs = Math.min(30_000, RUNTIME_RETENTION_INTERVAL_MS);
  const firstTimer = setTimeout(() => {
    void tick();
  }, firstDelayMs);
  const interval = setInterval(() => {
    void tick();
  }, Math.max(60_000, RUNTIME_RETENTION_INTERVAL_MS));
  // Do not keep the event loop alive just for retention.
  firstTimer.unref?.();
  interval.unref?.();
}

scheduleRuntimeRetention();

const server = app.listen(PORT, () => {
  // v6.10 WS4: listen callback is our signal that the BFF is accepting.
  void emitBffBootReady({ flags: RUNTIME_FLAGS });
  console.log(
    `Local API Gateway emulator running on port ${PORT} (host-local probe: http://127.0.0.1:${PORT})`,
  );
  console.log("Routes:");
  console.log("  GET  /dashboard");
  console.log("  GET  /assets");
  console.log("  GET  /revenue-trend");
  console.log("  GET  /trades");
  console.log("  GET  /api/fleet/overview          (v5.12)");
  console.log("  GET  /api/fleet/integradores       (v5.12)");
  console.log("  GET  /api/fleet/offline-events      (v5.12)");
  console.log("  GET  /api/fleet/uptime-trend        (v5.12)");
  console.log("  GET  /api/devices                   (v5.12)");
  console.log("  GET  /api/gateways                  (v5.19)");
  console.log("  GET  /api/gateways/summary          (v5.19)");
  console.log("  GET  /api/gateways/:id/energy       (v5.19)");
  console.log("  GET  /api/gateways/:id/energy-24h   (v6.3)");
  console.log("  GET  /api/gateways/:id/energy-stats (v6.3)");
  console.log("  GET  /api/gateways/:id/devices      (v5.19)");
  console.log("  GET  /api/gateways/:id/detail       (v5.20)");
  console.log("  GET  /api/gateways/:id/schedule     (v5.20)");
  console.log("  PUT  /api/gateways/:id/schedule     (v5.20)");
  console.log("  GET  /api/devices/:id               (v5.19)");
  console.log("  PUT  /api/devices/:id               (v5.19)");
  console.log("  GET  /api/devices/:id/schedule      (v5.19)");
  console.log("  PUT  /api/devices/:id/schedule      (v5.19)");
  console.log("  GET  /api/tariffs                   (v5.19)");
  console.log("  GET  /api/hems/overview             (v5.12)");
  console.log("  POST /api/hems/batch-dispatch       (v6.0)");
  console.log("  GET  /api/hems/batch-history        (v6.0)");
  console.log("  GET  /api/hems/targeting            (v6.4)");
  console.log("  GET  /api/vpp/capacity              (v5.12)");
  console.log("  GET  /api/vpp/latency               (v5.12)");
  console.log("  GET  /api/vpp/dr-events             (v5.12)");
  console.log("  GET  /api/performance/scorecard     (v5.12)");
  console.log("  GET  /api/performance/savings       (v5.12)");
  console.log("  GET  /api/assets/:id/telemetry     (v5.24)");
  console.log("  GET  /api/assets/:id/health        (v5.24)");
  console.log("  POST /webhooks/ccee-pld");
  console.log("  POST /webhooks/weather");
  console.log("  POST /api/telemetry/mock");
  console.log("  GET  /api/events (SSE)              (v5.21)");
  console.log("  POST /api/dispatch/ack");
  console.log("  POST /api/auth/login             (v5.23)");
  console.log("  POST /api/auth/logout            (v6.8)");
  console.log("  GET  /api/auth/session           (v6.9)");
  console.log("  POST /api/users                  (v5.23)");
  console.log("  GET  /api/p5/overview               (v6.5)");
  console.log("  GET  /api/p5/intents/:id             (v6.5)");
  console.log("  POST /api/p5/intents/:id/:action     (v6.5)");
  console.log("  POST /api/p5/posture-override        (v6.5)");
  console.log("  POST /api/p5/posture-override/:id/cancel (v6.5)");
  console.log("  GET  /api/alerts                    (v7.0)");
  console.log("  GET  /api/alerts/summary             (v7.0)");
  console.log("  GET  /api/runtime/health              (v6.10 WS3)");
  console.log("  GET  /api/runtime/issues              (v6.10 WS3)");
  console.log("  GET  /api/runtime/issues/:fp          (v6.10 WS3)");
  console.log("  GET  /api/runtime/events              (v6.10 WS3)");
  console.log("  GET  /api/runtime/self-checks          (v6.10 WS3)");
  console.log("  POST /api/runtime/issues/:fp/close     (v6.10 WS3)");
  console.log("  POST /api/runtime/issues/:fp/suppress  (v6.10 WS3)");
  console.log("  POST /api/runtime/issues/:fp/note      (v6.10 WS3)");
  console.log("");
  console.log("Auth: JWT required for /api/* routes (except /api/auth/login, /api/auth/logout)");
  console.log(`  curl -X POST http://127.0.0.1:${PORT}/api/auth/login \\`);
  console.log('    -H "Content-Type: application/json" \\');
  console.log(
    '    -d \'{"email":"admin@solfacil.com.br","password":"solfacil2026"}\'',
  );
});

// v6.10 WS4: listen failure → bff.boot.failed. Fire-and-forget.
server.on("error", (err: Error) => {
  void emitBffBootFailed({ flags: RUNTIME_FLAGS }, err);
  console.error("[Boot] listen error:", err);
});

// ── Graceful Shutdown ─────────────────────────────────────────────────
async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`\n[Shutdown] Received ${signal}. Closing all database pools...`);
  await closeAllPools();
  console.log("[Shutdown] All pools closed. Exiting.");
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
