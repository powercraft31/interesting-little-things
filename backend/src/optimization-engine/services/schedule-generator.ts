import cron from "node-cron";
import { Pool } from "pg";

export function startScheduleGenerator(pool: Pool): void {
  // 立即執行一次（系統啟動時），然後每小時定期跑
  runScheduleGenerator(pool);
  cron.schedule("0 * * * *", () => runScheduleGenerator(pool));
}

export async function runScheduleGenerator(pool: Pool): Promise<void> {
  try {
    // 1. 取得每小時平均 PLD 作為代理電價（因為 pld_horario 只有 Jan 2026 歷史資料）
    const pldResult = await pool.query<{ hora: number; avg_pld: number }>(`
      SELECT hora, ROUND(AVG(pld_hora), 2) as avg_pld
      FROM pld_horario
      GROUP BY hora
      ORDER BY hora
    `);
    const pldByHour: Record<number, number> = {};
    for (const row of pldResult.rows) {
      pldByHour[row.hora] = Number(row.avg_pld);
    }
    const DEFAULT_PLD = 150; // 若 pld_horario 無資料時的 fallback

    // 2. 取得所有 active assets
    const assetsResult = await pool.query<{
      asset_id: string;
      org_id: string;
      capacidade_kw: number;
      submercado: string;
    }>(`
      SELECT asset_id, org_id, capacidade_kw, submercado
      FROM assets
      WHERE is_active = true
    `);

    for (const asset of assetsResult.rows) {
      const powerKw = Number(asset.capacidade_kw ?? 5) * 0.8; // 額定功率的 80%
      const volumeKwh = powerKw * 1; // 1 小時 = volume_kwh

      // 3. 刪除此 asset 未來 24 小時內尚未開始的舊排程（避免重複）
      await pool.query(
        `
        DELETE FROM trade_schedules
        WHERE asset_id = $1
          AND status = 'scheduled'
          AND planned_time >= NOW()
          AND planned_time < NOW() + INTERVAL '24 hours'
      `,
        [asset.asset_id],
      );

      // 4. 產生未來 24 小時的排程
      const inserts: Array<[string, string, Date, string, number, number]> = [];
      for (let i = 1; i <= 24; i++) {
        const slotTime = new Date(Date.now() + i * 60 * 60 * 1000);
        const hora = slotTime.getHours();
        const pld = pldByHour[hora] ?? DEFAULT_PLD;

        // Mock Rule-based 決策邏輯：
        // 深夜強制充電（00:00-05:00），高電價放電（PLD >= 300），其餘充電
        let action: "charge" | "discharge";
        if (hora >= 0 && hora < 5) {
          action = "charge";
        } else if (pld >= 300) {
          action = "discharge";
        } else {
          action = "charge";
        }

        inserts.push([
          asset.asset_id,
          asset.org_id,
          slotTime,
          action,
          volumeKwh,
          pld,
        ]);
      }

      // 5. 批次 INSERT
      for (const [
        assetId,
        orgId,
        plannedTime,
        action,
        volume,
        pld,
      ] of inserts) {
        await pool.query(
          `
          INSERT INTO trade_schedules
            (asset_id, org_id, planned_time, action, expected_volume_kwh, target_pld_price, status)
          VALUES ($1, $2, $3, $4, $5, $6, 'scheduled')
        `,
          [assetId, orgId, plannedTime, action, volume, pld],
        );
      }
    }

    console.log(
      `[ScheduleGenerator] Generated schedules for ${assetsResult.rows.length} assets at ${new Date().toISOString()}`,
    );
  } catch (err) {
    console.error("[ScheduleGenerator] Error:", err);
  }
}
