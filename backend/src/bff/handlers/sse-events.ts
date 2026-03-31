import type { Pool } from "pg";
import { Client } from "pg";
import type { Request, Response } from "express";

/**
 * SSE Real-time Push — v5.21 Phase 3
 *
 * Creates a Server-Sent Events endpoint that forwards pg_notify signals
 * (telemetry_update, gateway_health) to connected browser clients.
 *
 * CRITICAL: Uses a DEDICATED pg.Client for LISTEN — NOT from the connection pool.
 * Each SSE client gets its own LISTEN connection that is held open for the
 * lifetime of the SSE session.
 */

const LISTEN_CONNECTION_STRING =
  process.env.APP_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://solfacil_app:solfacil_vpp_2026@127.0.0.1:5433/solfacil_vpp";

const KEEPALIVE_INTERVAL_MS = 30_000;

export function createSseHandler(_pool: Pool) {
  return async (req: Request, res: Response): Promise<void> => {
    // SSE response headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Dedicated LISTEN connection — NOT from the pool
    const listenClient = new Client({ connectionString: LISTEN_CONNECTION_STRING });

    try {
      await listenClient.connect();
    } catch (err) {
      console.error("[SSE] Failed to connect LISTEN client:", err);
      res.write(
        `data: ${JSON.stringify({ type: "error", message: "db_connect_failed" })}\n\n`,
      );
      res.end();
      return;
    }

    await listenClient.query("LISTEN telemetry_update");
    await listenClient.query("LISTEN gateway_health");
    console.log("[SSE] Client connected, LISTEN active");

    // Forward pg notifications as SSE events
    listenClient.on("notification", (msg) => {
      const event = JSON.stringify({
        type: msg.channel,
        gatewayId: msg.payload,
      });
      res.write(`data: ${event}\n\n`);
    });

    // Keepalive ping every 30s to prevent proxy/browser timeouts
    const keepalive = setInterval(() => {
      res.write(":keepalive\n\n");
    }, KEEPALIVE_INTERVAL_MS);

    // Cleanup on client disconnect
    req.on("close", () => {
      console.log("[SSE] Client disconnected, cleaning up LISTEN connection");
      clearInterval(keepalive);
      listenClient
        .query("UNLISTEN *")
        .catch(() => {})
        .finally(() => {
          listenClient.end().catch(() => {});
        });
    });
  };
}
