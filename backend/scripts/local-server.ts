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
import { handler as devicesHandler } from "../src/bff/handlers/get-devices";
import { handler as gatewaysHandler } from "../src/bff/handlers/get-gateways";
import { handler as gatewayEnergyHandler } from "../src/bff/handlers/get-gateway-energy";
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
import { handler as hemsDispatchHandler } from "../src/bff/handlers/post-hems-dispatch";
import { handler as vppCapacityHandler } from "../src/bff/handlers/get-vpp-capacity";
import { handler as vppLatencyHandler } from "../src/bff/handlers/get-vpp-latency";
import { handler as vppDrEventsHandler } from "../src/bff/handlers/get-vpp-dr-events";
import { handler as perfScorecardHandler } from "../src/bff/handlers/get-performance-scorecard";
import { handler as perfSavingsHandler } from "../src/bff/handlers/get-performance-savings";
import { handleCceeWebhook } from "../src/open-api/handlers/ccee-webhook";
import { handleWeatherWebhook } from "../src/open-api/handlers/weather-webhook";
import { createTelemetryWebhookHandler } from "../src/iot-hub/handlers/telemetry-webhook";

import { getServicePool, closeAllPools } from "../src/shared/db";
import { authMiddleware } from "../src/bff/middleware/auth";
import { createLoginHandler } from "../src/bff/handlers/auth-login";
import { createAdminUsersHandler } from "../src/bff/handlers/admin-users";
import { startScheduleGenerator } from "../src/optimization-engine/services/schedule-generator";
import { startCommandDispatcher } from "../src/dr-dispatcher/services/command-dispatcher";
import { startTimeoutChecker } from "../src/dr-dispatcher/handlers/timeout-checker";
import { createAckHandler } from "../src/dr-dispatcher/handlers/collect-response";
import { startBillingJob } from "../src/market-billing/services/daily-billing-job";
import { startTelemetryAggregator } from "../src/iot-hub/services/telemetry-aggregator";
import { startTelemetry5MinAggregator } from "../src/iot-hub/services/telemetry-5min-aggregator";
import { createSseHandler } from "../src/bff/handlers/sse-events";

type LambdaHandler = (
  event: APIGatewayProxyEventV2,
) => Promise<APIGatewayProxyResultV2>;

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
  return async (req: express.Request, res: express.Response): Promise<void> => {
    const event = makeStubEvent(req, method, path);
    const result = await handler(event);

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

app.use(express.json()); // Parse POST body (needed for webhooks)

// v5.23: JWT auth middleware (replaces demo auth injection)
app.use(authMiddleware);

app.use(
  cors({
    origin: (origin, callback) => {
      if (
        !origin ||
        /^https?:\/\/(localhost|152\.42\.235\.155)(:\d+)?$/.test(origin)
      ) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
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
  "/api/hems/dispatch",
  wrapHandler(hemsDispatchHandler, "POST", "/api/hems/dispatch"),
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
// ────────────────────────────────────────────────────────────────────────

// ── v5.7 Inbound Webhooks ────────────────────────────────────────────────
app.post("/webhooks/ccee-pld", handleCceeWebhook);
app.post("/webhooks/weather", handleWeatherWebhook);
// ────────────────────────────────────────────────────────────────────────

// ── Shared DB pool (v5.11: dual pool — service pool for cron/internal) ────
const servicePool = getServicePool();

// ── v5.23 Auth Routes ────────────────────────────────────────────────────
app.post("/api/auth/login", createLoginHandler(servicePool));
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
const FRONTEND_DIR = fs.existsSync(FRONTEND_DOCKER) ? FRONTEND_DOCKER : FRONTEND_LOCAL;
app.use(express.static(FRONTEND_DIR));
app.get("/", (_req, res) =>
  res.sendFile(path.join(FRONTEND_DIR, "index.html")),
);
app.get("/login", (_req, res) =>
  res.sendFile(path.join(FRONTEND_DIR, "login.html")),
);
// ────────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Local API Gateway emulator running at http://localhost:${PORT}`);
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
  console.log("  POST /api/hems/dispatch             (v5.12)");
  console.log("  GET  /api/vpp/capacity              (v5.12)");
  console.log("  GET  /api/vpp/latency               (v5.12)");
  console.log("  GET  /api/vpp/dr-events             (v5.12)");
  console.log("  GET  /api/performance/scorecard     (v5.12)");
  console.log("  GET  /api/performance/savings       (v5.12)");
  console.log("  POST /webhooks/ccee-pld");
  console.log("  POST /webhooks/weather");
  console.log("  POST /api/telemetry/mock");
  console.log("  GET  /api/events (SSE)              (v5.21)");
  console.log("  POST /api/dispatch/ack");
  console.log("  POST /api/auth/login             (v5.23)");
  console.log("  POST /api/users                  (v5.23)");
  console.log("");
  console.log("Auth: JWT required for /api/* routes (except /api/auth/login)");
  console.log("  curl -X POST http://localhost:3000/api/auth/login \\");
  console.log('    -H "Content-Type: application/json" \\');
  console.log(
    '    -d \'{"email":"admin@solfacil.com.br","password":"solfacil2026"}\'',
  );
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
