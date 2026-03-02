import express from "express";
import cors from "cors";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";

import { handler as dashboardHandler } from "../src/bff/handlers/get-dashboard";
import { handler as assetsHandler } from "../src/bff/handlers/get-assets";
import { handler as revenueTrendHandler } from "../src/bff/handlers/get-revenue-trend";
import { handler as tradesHandler } from "../src/bff/handlers/get-trades";
import { handleCceeWebhook } from "../src/open-api/handlers/ccee-webhook";
import { handleWeatherWebhook } from "../src/open-api/handlers/weather-webhook";
import { createTelemetryWebhookHandler } from "../src/iot-hub/handlers/telemetry-webhook";

import { getPool } from "../src/shared/db";
import { startScheduleGenerator } from "../src/optimization-engine/services/schedule-generator";
import { startCommandDispatcher } from "../src/dr-dispatcher/services/command-dispatcher";
import { startBillingJob } from "../src/market-billing/services/daily-billing-job";
import { startTelemetryAggregator } from "../src/iot-hub/services/telemetry-aggregator";

type LambdaHandler = (
  event: APIGatewayProxyEventV2,
) => Promise<APIGatewayProxyResultV2>;

const PORT = 3000;

function makeStubEvent(
  req: express.Request,
  method: string,
  path: string,
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: "",
    headers: {
      authorization: (req.headers.authorization as string) ?? "",
      "content-type": (req.headers["content-type"] as string) ?? "",
    },
    requestContext: {
      accountId: "local",
      apiId: "local",
      domainName: "localhost",
      domainPrefix: "localhost",
      http: {
        method,
        path,
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

// Demo mode: inject default auth context if no Authorization header is provided
// Allows frontend to call the API without a login flow during local testing
app.use((req, _res, next) => {
  if (!req.headers.authorization) {
    req.headers.authorization = JSON.stringify({
      userId: "demo-user",
      orgId: "ORG_SOLFACIL",
      role: "SOLFACIL_ADMIN", // demo: see all 4 assets across orgs
    });
  }
  next();
});

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

// ── v5.7 Inbound Webhooks ────────────────────────────────────────────────
app.post("/webhooks/ccee-pld", handleCceeWebhook);
app.post("/webhooks/weather", handleWeatherWebhook);
// ────────────────────────────────────────────────────────────────────────

// ── Shared DB pool ───────────────────────────────────────────────────────
const pool = getPool();

// ── v5.8 Telemetry Feedback Loop ─────────────────────────────────────────
app.post("/api/telemetry/mock", createTelemetryWebhookHandler(pool));
// ────────────────────────────────────────────────────────────────────────

// ── v5.6 System Heartbeat: 啟動自動化管線 ──────────────────────────────
startScheduleGenerator(pool); // M2: 每小時生成 trade_schedules
startCommandDispatcher(pool); // M3: 每分鐘推進狀態機 → dispatch_commands
startBillingJob(pool); // M4: 每天 00:05 結算 revenue_daily
console.log("[v5.6] System heartbeat started: M2/M3/M4 pipelines active");
// ────────────────────────────────────────────────────────────────────────

// ── v5.8 Telemetry Aggregator (hourly cron) ──────────────────────────────
startTelemetryAggregator(pool);
console.log(
  "[v5.8] Telemetry aggregator started: hourly rollup to asset_hourly_metrics",
);
// ────────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Local API Gateway emulator running at http://localhost:${PORT}`);
  console.log("Routes:");
  console.log("  GET /dashboard");
  console.log("  GET /assets");
  console.log("  GET /revenue-trend");
  console.log("  GET /trades");
  console.log("  POST /webhooks/ccee-pld");
  console.log("  POST /webhooks/weather");
  console.log("  POST /api/telemetry/mock");
  console.log("");
  console.log("Auth: pass Authorization header as raw JSON, e.g.:");
  console.log(
    '  curl -H \'Authorization: {"userId":"u1","orgId":"ORG_ENERGIA_001","role":"ORG_MANAGER"}\' http://localhost:3000/dashboard',
  );
});
