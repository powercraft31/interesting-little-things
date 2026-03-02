/**
 * DR Dispatcher — Timeout Checker (v5.9)
 *
 * Cron job (every minute) that detects stale dispatch_commands stuck in
 * 'dispatched' for > 15 minutes and marks them (and their parent
 * trade_schedules) as 'failed'.
 *
 * Replaces the old AWS SQS delay-queue + DynamoDB approach.
 */
import cron from "node-cron";
import { Pool } from "pg";

export function startTimeoutChecker(pool: Pool): void {
  cron.schedule("* * * * *", () => runTimeoutChecker(pool));
}

export async function runTimeoutChecker(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Find dispatched commands older than 15 minutes
    const timedOut = await client.query<{ id: number; trade_id: number }>(`
      SELECT id, trade_id FROM dispatch_commands
      WHERE status = 'dispatched'
        AND dispatched_at < NOW() - INTERVAL '15 minutes'
    `);

    if (timedOut.rows.length === 0) {
      await client.query("COMMIT");
      return;
    }

    const ids = timedOut.rows.map((r) => r.id);
    const tradeIds = timedOut.rows.map((r) => r.trade_id);

    // 2. Mark dispatch_commands failed
    await client.query(
      `UPDATE dispatch_commands SET status = 'failed' WHERE id = ANY($1)`,
      [ids],
    );

    // 3. Mark trade_schedules failed
    await client.query(
      `UPDATE trade_schedules SET status = 'failed' WHERE id = ANY($1) AND status = 'executing'`,
      [tradeIds],
    );

    await client.query("COMMIT");
    console.log(
      `[TimeoutChecker] Marked ${ids.length} commands as failed (timeout)`,
    );
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[TimeoutChecker] Error:", err);
  } finally {
    client.release();
  }
}
