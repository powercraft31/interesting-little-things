import cron from "node-cron";
import { Pool } from "pg";
import { parseRuntimeFlags } from "../../shared/runtime/flags";
import {
  emitDispatchLoopHeartbeat,
  emitDispatchLoopStalled,
  recordDispatchLoopAlive,
} from "../../shared/runtime/dispatch-emitters";

export function startCommandDispatcher(pool: Pool): void {
  // Existing: trade_schedules → dispatch_commands (every minute)
  cron.schedule("* * * * *", () => runCommandDispatcher(pool));

  // New: device_command_logs pending_dispatch → MQTT (every 10 seconds)
  setInterval(() => runPendingCommandDispatcher(pool), 10_000);

  // Timeout check: dispatched commands with no ACK after 90s
  setInterval(() => runTimeoutCheck(pool), 30_000);
}

export async function runCommandDispatcher(pool: Pool): Promise<void> {
  const runStartedAt = new Date();
  let commandsDispatched = 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Step 1: 撈取「時間已到」且尚為 scheduled 的紀錄，使用 FOR UPDATE SKIP LOCKED
    const dueResult = await client.query<{
      id: number;
      asset_id: string;
      org_id: string;
      action: string;
      expected_volume_kwh: number;
      target_mode: string | null;
    }>(`
      SELECT id, asset_id, org_id, action, expected_volume_kwh, target_mode
      FROM trade_schedules
      WHERE status = 'scheduled'
        AND planned_time <= NOW()
      FOR UPDATE SKIP LOCKED
    `);

    if (dueResult.rows.length > 0) {
      const ids = dueResult.rows.map((r) => r.id);

      // Step 2: 推進到 executing
      await client.query(
        `
        UPDATE trade_schedules
        SET status = 'executing'
        WHERE id = ANY($1)
      `,
        [ids],
      );

      // Step 3: 寫入 dispatch_commands（到 M1 邊界停止）+ dispatch_records for PS
      for (const trade of dueResult.rows) {
        await client.query(
          `
          INSERT INTO dispatch_commands
            (trade_id, asset_id, org_id, action, volume_kwh, status, m1_boundary)
          VALUES ($1, $2, $3, $4, $5, 'dispatched', true)
        `,
          [
            trade.id,
            trade.asset_id,
            trade.org_id,
            trade.action,
            trade.expected_volume_kwh,
          ],
        );

        // Peak Shaving: write dispatch_records with target_mode and compute peak_limit_kva
        if (trade.target_mode === "peak_shaving") {
          const demandResult = await client.query<{
            contracted_demand_kw: number;
            billing_power_factor: number;
          }>(
            `
            SELECT g.contracted_demand_kw,
                   COALESCE(ts.billing_power_factor, 0.92) AS billing_power_factor
            FROM assets a
            JOIN gateways g ON g.gateway_id = a.gateway_id
            LEFT JOIN tariff_schedules ts ON ts.org_id = a.org_id
              AND ts.effective_from <= CURRENT_DATE
              AND (ts.effective_to IS NULL OR ts.effective_to >= CURRENT_DATE)
            WHERE a.asset_id = $1
            LIMIT 1
          `,
            [trade.asset_id],
          );

          const contractedKw = demandResult.rows[0]?.contracted_demand_kw ?? 0;
          const pf = demandResult.rows[0]?.billing_power_factor ?? 0.92;
          const peakLimitKva =
            pf > 0 ? Math.round((contractedKw / pf) * 100) / 100 : contractedKw;

          await client.query(
            `
            INSERT INTO dispatch_records
              (asset_id, dispatched_at, dispatch_type, commanded_power_kw, target_mode)
            VALUES ($1, NOW(), 'peak_shaving', $2, 'peak_shaving')
          `,
            [trade.asset_id, peakLimitKva],
          );
        }
      }
    }

    // Step 4: timeout detection moved to timeout-checker.ts (v5.9)

    await client.query("COMMIT");

    commandsDispatched = dueResult.rows.length;
    if (dueResult.rows.length > 0) {
      console.log(
        `[CommandDispatcher] Dispatched ${dueResult.rows.length} commands at ${new Date().toISOString()}`,
      );
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[CommandDispatcher] Error:", err);
    // WS7: dispatcher-owned non-progression fact. Best-effort; must not
    // rethrow because the existing contract of this function is to swallow
    // dispatch-loop failures (legacy caller behavior).
    const error = err instanceof Error ? err : new Error(String(err));
    void emitDispatchLoopStalled(
      { flags: parseRuntimeFlags(process.env) },
      { error, runStartedAt, phase: "run" },
    ).catch(() => {
      /* best-effort — dispatcher error path must not throw */
    });
    return;
  } finally {
    client.release();
  }

  // WS7: success-path heartbeat + dispatch.loop.alive self-check contribution.
  // These are strictly observational. Any emitter or self-check write failure
  // is swallowed inside the helpers (safeEmit / degraded_fallback). The
  // dispatcher run itself is already complete and cannot be affected.
  const runFinishedAt = new Date();
  const durationMs = runFinishedAt.getTime() - runStartedAt.getTime();
  const flags = parseRuntimeFlags(process.env);

  void emitDispatchLoopHeartbeat(
    { flags },
    {
      commandsDispatched,
      runStartedAt,
      durationMs,
    },
  ).catch(() => {
    /* best-effort — heartbeat must not break dispatcher */
  });

  void recordDispatchLoopAlive(
    { flags },
    {
      observedAt: runFinishedAt,
      durationMs,
      detail: {
        commands_dispatched: commandsDispatched,
      },
    },
  ).catch(() => {
    /* best-effort — self-check update must not break dispatcher */
  });
}

export async function runPendingCommandDispatcher(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const pendingResult = await client.query<{
      id: number;
    }>(`
      SELECT id
      FROM device_command_logs
      WHERE result = 'pending'
      ORDER BY created_at ASC
      LIMIT 50
      FOR UPDATE SKIP LOCKED
    `);

    if (pendingResult.rows.length === 0) {
      await client.query("COMMIT");
      return;
    }

    const ids = pendingResult.rows.map((r) => r.id);

    await client.query(
      `UPDATE device_command_logs
       SET result = 'dispatched'
       WHERE id = ANY($1)`,
      [ids],
    );

    await client.query("COMMIT");

    console.log(
      `[PendingCommandDispatcher] Dispatched ${pendingResult.rows.length} commands`,
    );
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[PendingCommandDispatcher] Error:", err);
  } finally {
    client.release();
  }
}

async function runTimeoutCheck(pool: Pool): Promise<void> {
  try {
    // Timeout 1: dispatched commands (90s from created_at — no gateway response)
    const dispatched = await pool.query(`
      UPDATE device_command_logs
      SET result = 'timeout', resolved_at = NOW(), error_message = 'gateway_no_response'
      WHERE result = 'dispatched' AND command_type = 'set'
        AND created_at < NOW() - INTERVAL '90 seconds'
      RETURNING id
    `);
    if (dispatched.rowCount && dispatched.rowCount > 0) {
      console.log(
        `[TimeoutCheck] Timed out ${dispatched.rowCount} dispatched commands (no gateway response)`,
      );
    }

    // Timeout 2: accepted commands (20s from accepted time in device_timestamp)
    const accepted = await pool.query(`
      UPDATE device_command_logs
      SET result = 'timeout', resolved_at = NOW(), error_message = 'device_write_timeout'
      WHERE result = 'accepted' AND command_type = 'set'
        AND device_timestamp < NOW() - INTERVAL '20 seconds'
      RETURNING id
    `);
    if (accepted.rowCount && accepted.rowCount > 0) {
      console.log(
        `[TimeoutCheck] Timed out ${accepted.rowCount} accepted commands (device write timeout)`,
      );
    }
  } catch (err) {
    console.error("[TimeoutCheck] Error:", err);
  }
}
