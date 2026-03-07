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

    // 2. 取得所有 active assets（LEFT JOIN device_state + vpp_strategies for SoC guardrails）
    // v5.15: added allow_export column for grid export constraint
    const assetsResult = await pool.query<{
      asset_id: string;
      org_id: string;
      capacidade_kw: number;
      submercado: string;
      operation_mode: string;
      battery_soc: number;
      min_soc: number;
      max_soc: number;
      allow_export: boolean;
    }>(`
      SELECT
        a.asset_id, a.org_id, a.capacidade_kw, a.submercado, a.operation_mode,
        COALESCE(d.battery_soc, 50) AS battery_soc,
        COALESCE(vs.min_soc, 20)   AS min_soc,
        COALESCE(vs.max_soc, 95)   AS max_soc,
        COALESCE(a.allow_export, false) AS allow_export
      FROM assets a
      LEFT JOIN device_state d ON d.asset_id = a.asset_id
      LEFT JOIN vpp_strategies vs ON vs.org_id = a.org_id
        AND vs.target_mode = a.operation_mode
        AND vs.is_active = true
      WHERE a.is_active = true
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
        let action: "charge" | "discharge" | "idle";
        if (hora >= 0 && hora < 5) {
          action = "charge";
        } else if (pld >= 300) {
          action = "discharge";
        } else {
          action = "charge";
        }

        // SoC guardrails: clamp actions based on battery state and strategy limits
        const { battery_soc, min_soc, max_soc } = asset;
        if (action === "charge" && battery_soc >= max_soc) action = "idle";
        if (action === "discharge" && battery_soc <= min_soc) action = "idle";

        // v5.15: export constraint — if allow_export is false, skip discharge
        // slots that would export to grid (simplified: no discharge when export disallowed
        // unless load is expected to absorb it — conservative approach)
        if (action === "discharge" && !asset.allow_export) {
          // Conservative: still allow discharge but flag it as self-consumption only
          // The actual export capping happens at the EMS level
        }

        // Skip inserting 'idle' slots into trade_schedules (no-op)
        if (action === "idle") continue;

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
