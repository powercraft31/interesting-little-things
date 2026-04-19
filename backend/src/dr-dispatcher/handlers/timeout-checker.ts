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
import { parseRuntimeFlags } from "../../shared/runtime/flags";
import {
  emitDispatchAckStalled,
  emitDispatchTimeoutCheckerHeartbeat,
  maybeEmitDispatchAckRecovered,
} from "../../shared/runtime/dispatch-emitters";

const TIMEOUT_CUTOFF_SECONDS = 15 * 60;

export function startTimeoutChecker(pool: Pool): void {
  cron.schedule("* * * * *", () => runTimeoutChecker(pool));
}

export async function runTimeoutChecker(pool: Pool): Promise<void> {
  const runStartedAt = new Date();
  let staleCommandsFailed = 0;
  let staleSampleIds: number[] = [];
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
    } else {
      const ids = timedOut.rows.map((r) => r.id);
      const tradeIds = timedOut.rows.map((r) => r.trade_id);

      // 2. Mark dispatch_commands failed
      await client.query(
        `UPDATE dispatch_commands SET status = 'failed' WHERE id = ANY($1) AND status = 'dispatched'`,
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
      staleCommandsFailed = ids.length;
      staleSampleIds = ids.slice(0, 10);
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[TimeoutChecker] Error:", err);
    return;
  } finally {
    client.release();
  }

  // WS7: timeout-checker-owned observational facts. Strictly best-effort;
  // emitter failures are swallowed by the helpers themselves. M3 ACK semantics
  // and timeout transitions are already committed above.
  const runFinishedAt = new Date();
  const durationMs = runFinishedAt.getTime() - runStartedAt.getTime();
  const flags = parseRuntimeFlags(process.env);

  void emitDispatchTimeoutCheckerHeartbeat(
    { flags },
    {
      staleCommandsFailed,
      runStartedAt,
      durationMs,
    },
  ).catch(() => {
    /* best-effort — heartbeat must not break timeout-checker */
  });

  if (staleCommandsFailed > 0) {
    void emitDispatchAckStalled(
      { flags },
      {
        staleCount: staleCommandsFailed,
        cutoffSeconds: TIMEOUT_CUTOFF_SECONDS,
        observedAt: runFinishedAt,
        sampleDispatchIds: staleSampleIds,
      },
    ).catch(() => {
      /* best-effort — ack-stalled fact must not break timeout-checker */
    });
  } else {
    // Zero stale rows observed. If there is an active dispatch.ack.stalled
    // runtime issue for this scope, emit the canonical recover lifecycle so
    // M9 projection moves it out of detected/ongoing and health stops
    // reporting m3.dispatch degraded on a fault that has cleared. The helper
    // consults runtime_issues as the canonical authority — no process-local
    // bookkeeping — and is a no-op when no active issue exists.
    void maybeEmitDispatchAckRecovered(
      { flags },
      {
        cutoffSeconds: TIMEOUT_CUTOFF_SECONDS,
        observedAt: runFinishedAt,
      },
    ).catch(() => {
      /* best-effort — recovery fact must not break timeout-checker */
    });
  }
}
