import cron from "node-cron";
import { Pool } from "pg";

export function startCommandDispatcher(pool: Pool): void {
  cron.schedule("* * * * *", () => runCommandDispatcher(pool));
}

export async function runCommandDispatcher(pool: Pool): Promise<void> {
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
    }>(`
      SELECT id, asset_id, org_id, action, expected_volume_kwh
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

      // Step 3: 寫入 dispatch_commands（到 M1 邊界停止）
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
      }
    }

    // Step 4: timeout detection moved to timeout-checker.ts (v5.9)

    await client.query("COMMIT");

    if (dueResult.rows.length > 0) {
      console.log(
        `[CommandDispatcher] Dispatched ${dueResult.rows.length} commands at ${new Date().toISOString()}`,
      );
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[CommandDispatcher] Error:", err);
  } finally {
    client.release();
  }
}
