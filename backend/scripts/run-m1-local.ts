/**
 * Local M1 runner — connects to real MQTT broker via GatewayConnectionManager.
 * Usage: npx tsx backend/scripts/run-m1-local.ts
 */
import { Pool } from "pg";
import { GatewayConnectionManager } from "../src/iot-hub/services/gateway-connection-manager";
import { handleDeviceList } from "../src/iot-hub/handlers/device-list-handler";
import { handleTelemetry } from "../src/iot-hub/handlers/telemetry-handler";
import { handleHeartbeat } from "../src/iot-hub/handlers/heartbeat-handler";
import {
  handleGetReply,
  handleSetReply,
} from "../src/iot-hub/handlers/command-tracker";
import { CommandPublisher } from "../src/iot-hub/services/command-publisher";
import { BackfillRequester } from "../src/iot-hub/services/backfill-requester";

// Local PostgreSQL — service pool (BYPASSRLS)
const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: "solfacil_vpp",
  user: "solfacil_service",
  password: "solfacil_service_2026",
});

// Stats
let msgCount = 0;
const stats: Record<string, number> = {};

async function main() {
  console.log("[M1 Local] Connecting to DB...");
  const client = await pool.connect();
  const dbTime = await client.query("SELECT NOW()");
  console.log(`[M1 Local] DB connected. Server time: ${dbTime.rows[0].now}`);
  client.release();

  // Wrap handlers with logging
  const wrapHandler = (name: string, fn: Function) => {
    return async (
      pool: Pool,
      gatewayId: string,
      clientId: string,
      payload: any,
    ) => {
      msgCount++;
      stats[name] = (stats[name] || 0) + 1;
      console.log(`[M1 Local] #${msgCount} ${name} from ${clientId}`);
      try {
        await fn(pool, gatewayId, clientId, payload);
      } catch (err: any) {
        console.error(`[M1 Local] ERROR in ${name}:`, err.message);
      }
    };
  };

  const manager = new GatewayConnectionManager(pool, {
    onDeviceList: wrapHandler("deviceList", handleDeviceList),
    onTelemetry: wrapHandler("telemetry", handleTelemetry),
    onGetReply: wrapHandler("getReply", handleGetReply),
    onSetReply: wrapHandler("setReply", handleSetReply),
    onHeartbeat: wrapHandler("heartbeat", handleHeartbeat),
  });

  await manager.start();

  const publisher = new CommandPublisher(pool, manager);
  publisher.start();
  console.log("[M1 Local] CommandPublisher started (10s poll)");

  const backfillRequester = new BackfillRequester(pool, manager);
  backfillRequester.start();
  console.log("[M1 Local] BackfillRequester started (10s poll)");

  console.log("[M1 Local] Running. Press Ctrl+C to stop.");

  // Print stats every 30s
  setInterval(() => {
    console.log(`[M1 Local] Stats: total=${msgCount}`, JSON.stringify(stats));
  }, 30_000);

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n[M1 Local] Shutting down...");
    backfillRequester.stop();
    publisher.stop();
    manager.stop();
    pool.end().then(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error("[M1 Local] Fatal:", err);
  process.exit(1);
});
