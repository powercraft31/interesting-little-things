/**
 * DR Dispatcher — ACK Handler (v5.9)
 *
 * Express endpoint: POST /api/dispatch/ack
 *
 * Receives acknowledgement from hardware (or mock client) indicating a
 * dispatch command completed or failed.  Updates dispatch_commands and
 * cascades status to the parent trade_schedules row.
 */
import { Pool } from "pg";
import type { Request, Response } from "express";

interface AckPayload {
  dispatch_id: number;
  status: "completed" | "failed";
  asset_id: string;
}

export function createAckHandler(pool: Pool) {
  return async (req: Request, res: Response): Promise<void> => {
    const { dispatch_id, status, asset_id } = req.body as AckPayload;

    // ── Validate payload ──────────────────────────────────────────────
    if (
      dispatch_id == null ||
      !["completed", "failed"].includes(status) ||
      !asset_id
    ) {
      res.status(400).json({
        ok: false,
        error:
          "Missing or invalid fields: dispatch_id (number), status ('completed'|'failed'), asset_id (string)",
      });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // ── Check dispatch exists and is 'dispatched' (not terminal) ────
      const existing = await client.query<{
        id: number;
        trade_id: number;
        status: string;
      }>(
        `SELECT id, trade_id, status FROM dispatch_commands WHERE id = $1 FOR UPDATE`,
        [dispatch_id],
      );

      if (existing.rows.length === 0) {
        await client.query("ROLLBACK");
        res
          .status(404)
          .json({ ok: false, error: "Dispatch command not found" });
        return;
      }

      const current = existing.rows[0];

      // Already in terminal state → 409 Conflict (idempotency guard)
      if (current.status !== "dispatched") {
        await client.query("ROLLBACK");
        res.status(409).json({
          ok: false,
          error: `Dispatch already in terminal state: ${current.status}`,
        });
        return;
      }

      // ── Update dispatch_commands ────────────────────────────────────
      await client.query(
        `UPDATE dispatch_commands SET status = $1 WHERE id = $2`,
        [status, dispatch_id],
      );

      // ── Cascade to trade_schedules ──────────────────────────────────
      if (status === "completed") {
        await client.query(
          `UPDATE trade_schedules SET status = 'executed' WHERE id = $1 AND status = 'executing'`,
          [current.trade_id],
        );
      } else {
        // status === 'failed'
        await client.query(
          `UPDATE trade_schedules SET status = 'failed' WHERE id = $1 AND status = 'executing'`,
          [current.trade_id],
        );
      }

      await client.query("COMMIT");

      console.log(
        `[AckHandler] dispatch_id=${dispatch_id} asset=${asset_id} → ${status}`,
      );
      res.status(200).json({ ok: true, dispatch_id, status });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[AckHandler] Error:", err);
      res.status(500).json({ ok: false, error: "Internal server error" });
    } finally {
      client.release();
    }
  };
}
