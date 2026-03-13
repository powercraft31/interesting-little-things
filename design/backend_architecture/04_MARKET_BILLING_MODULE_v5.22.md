# M4: 市場與計費模組 — 尖峰削減節省歸因

> **模組版本**: v5.22
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.15.md](./00_MASTER_ARCHITECTURE_v5.15.md)
> **前版**: [04_MARKET_BILLING_MODULE_v5.16.md](./04_MARKET_BILLING_MODULE_v5.16.md)
> **最後更新**: 2026-03-13
> **說明**: 兩個新函式：runDailyPsSavings（反事實 kW 重建）+ runMonthlyTrueUp（月末重新掃描）
> **核心主題**: PS 節省歸因的反事實需量重建

---

## 與 v5.16 的差異

**v5.16 → v5.22：無程式碼變更。**

| 面向 | v5.16 | v5.22 |
|------|-------|-------|
| PS 節省計算 | 已實作（runDailyPsSavings） | 不變 |
| 月度調整 | 已實作（runMonthlyTrueUp） | 不變 |
| 資料讀取 | asset_hourly_metrics（每日計費）、asset_5min_metrics（SC/TOU 歸因 + PS 節省）、dispatch_records、tariff_schedules、telemetry_history、assets、gateways | **Schema 依賴備註**: `contracted_demand_kw` 已從 `homes` 遷移至 `gateways`（v5.19） |
| revenue_daily 輸出 | ps_savings_reais, ps_avoided_peak_kva, do_shed_confidence, true_up_adjustment_reais | 不變 |
| Cron 排程 | 每日 00:05 UTC（`"5 0 * * *"`）；月度 true-up 尚無 cron 排程（函式已匯出但未自動觸發） | 不變 |

> **Schema 依賴備註（v5.19）**：v5.19 將 `contracted_demand_kw` 從 `homes` 表遷移至 `gateways` 表。daily-billing-job.ts 中的 `runMonthlyTrueUp` 已正確更新為 `LEFT JOIN gateways g` 並使用 `g.contracted_demand_kw`。但 `runDailyPsSavings` 的 JOIN 雖已改為 `gateways g`，SQL 中仍殘留舊別名 `h.contracted_demand_kw`（應為 `g.contracted_demand_kw`）。此為已知程式碼瑕疵，需修正。

---

## 1. 更新後的計費邏輯

### v5.16 管線（v5.22 不變）

```
daily-billing-job.ts（於 00:05 UTC 執行，cron = "5 0 * * *"）
  |
  +-- [既有 — 不變] Baseline/Actual/BestTou 計算
  +-- [既有 — 不變] SC/TOU 歸因（v5.15）
  |
  +-- [v5.16] runDailyPsSavings(pool, brtWindowStart, brtWindowEnd)
  |     +-- 讀取：asset_5min_metrics（PS 活動窗口）
  |     +-- 讀取：dispatch_records（target_mode = 'peak_shaving'）
  |     +-- 讀取：telemetry_history（DO 狀態轉換）
  |     +-- 讀取：tariff_schedules（demand_charge_rate, billing_power_factor）
  |     +-- 讀取：gateways（contracted_demand_kw）— v5.19 schema 變更（⚠️ runDailyPsSavings SQL 仍殘留 `h.` 別名）
  |     +-- 計算：每 5 分鐘窗口的反事實 kW
  |     +-- 分箱：date_bin 為 15 分鐘需量窗口
  |     +-- 寫入：revenue_daily（ps_savings_reais, ps_avoided_peak_kva, do_shed_confidence）
  |
  +-- [v5.16] runMonthlyTrueUp(pool, billingMonth) — 僅每月 1 日
        +-- 重新掃描整月
        +-- INSERT true_up_adjustment_reais（新列，永不 UPDATE）
```

---

## 2. `runDailyPsSavings` — 完整 SQL 設計

### 檔案：`market-billing/services/daily-billing-job.ts`

```sql
-- 步驟 1：重建 PS 活動窗口的 5 分鐘反事實 kW
WITH ps_active_windows AS (
  SELECT
    m.asset_id,
    m.window_start,
    -- 反事實電網需量（kW，瞬時等效值）
    -- grid_import_kwh * 12 將 5 分鐘 kWh 轉換回平均 kW
    (m.grid_import_kwh * 12) + (m.bat_discharge_kwh * 12) AS cf_grid_kw,
    -- DO0 負載削減：DO0 觸發前後的負載差異
    COALESCE(
      (SELECT GREATEST(0, th_b.load_power - th_a.load_power)
       FROM telemetry_history th_b
       JOIN telemetry_history th_a ON th_a.asset_id = th_b.asset_id
       WHERE th_b.asset_id = m.asset_id
         AND COALESCE(th_b.do0_active, false) = false
         AND COALESCE(th_a.do0_active, false) = true
         AND th_b.recorded_at BETWEEN m.window_start - INTERVAL '3 min' AND m.window_start
         AND th_a.recorded_at BETWEEN m.window_start AND m.window_start + INTERVAL '3 min'
       ORDER BY th_b.recorded_at DESC, th_a.recorded_at ASC
       LIMIT 1),
      0  -- 備援：若無 DO 轉換偵測或遙測資料缺失則為 0
    ) AS do0_shed_kw,
    -- DO1 負載削減：第二繼電器的相同邏輯
    COALESCE(
      (SELECT GREATEST(0, th_b.load_power - th_a.load_power)
       FROM telemetry_history th_b
       JOIN telemetry_history th_a ON th_a.asset_id = th_b.asset_id
       WHERE th_b.asset_id = m.asset_id
         AND COALESCE(th_b.do1_active, false) = false
         AND COALESCE(th_a.do1_active, false) = true
         AND th_b.recorded_at BETWEEN m.window_start - INTERVAL '3 min' AND m.window_start
         AND th_a.recorded_at BETWEEN m.window_start AND m.window_start + INTERVAL '3 min'
       ORDER BY th_b.recorded_at DESC, th_a.recorded_at ASC
       LIMIT 1),
      0
    ) AS do1_shed_kw,
    -- 每窗口信心度：基於該 5 分鐘窗口內是否偵測到 DO 遙測
    CASE WHEN EXISTS (
      SELECT 1 FROM telemetry_history th
      WHERE th.asset_id = m.asset_id
        AND COALESCE(th.do0_active, false) = true
        AND th.recorded_at BETWEEN m.window_start AND m.window_start + INTERVAL '5 min'
      LIMIT 1
    ) THEN 'high' ELSE
      CASE WHEN EXISTS (
        SELECT 1 FROM telemetry_history th
        WHERE th.asset_id = m.asset_id
          AND (COALESCE(th.do0_active, false) = true OR COALESCE(th.do1_active, false) = true)
          AND th.recorded_at BETWEEN m.window_start - INTERVAL '5 min' AND m.window_start + INTERVAL '5 min'
        LIMIT 1
      ) THEN 'low' ELSE 'high' END
    END AS window_confidence
  FROM asset_5min_metrics m
  -- 僅 PS 活動窗口：該窗口前最近一次派遣為 peak_shaving
  WHERE m.window_start >= $1 AND m.window_start < $2
    AND (
      SELECT COALESCE(dr.target_mode, 'UNASSIGNED')
      FROM dispatch_records dr
      WHERE dr.asset_id = m.asset_id
        AND dr.dispatched_at <= m.window_start
      ORDER BY dr.dispatched_at DESC LIMIT 1
    ) = 'peak_shaving'
),

-- 步驟 2：分箱為 15 分鐘窗口（BRT 對齊於 03:00 UTC）
demand_15min AS (
  SELECT
    w.asset_id,
    date_bin('15 minutes', w.window_start, TIMESTAMP '2026-01-01 03:00:00+00') AS window_15,
    AVG(w.cf_grid_kw + w.do0_shed_kw + w.do1_shed_kw) AS cf_kw_avg,
    MIN(w.window_confidence) AS confidence
  FROM ps_active_windows w
  GROUP BY w.asset_id, window_15
),

-- 步驟 3：kW → kVA，找到每日最大值
peak_per_asset AS (
  SELECT
    d.asset_id,
    MAX(d.cf_kw_avg / COALESCE(ts.billing_power_factor, 0.92)) AS daily_peak_kva,
    MIN(d.confidence) AS confidence
  FROM demand_15min d
  JOIN assets a ON a.asset_id = d.asset_id
  LEFT JOIN tariff_schedules ts ON ts.org_id = a.org_id
    AND ts.effective_to IS NULL
  GROUP BY d.asset_id
),

-- 步驟 4：avoided_kva x rate = 每日 PS 節省（直接 SELECT，無額外 CTE）
-- ⚠️ 程式碼已知問題：此處 SQL 使用 `h.contracted_demand_kw`（舊 homes 別名），
--   但 JOIN 為 `gateways g`。runMonthlyTrueUp 已正確使用 `g.contracted_demand_kw`。
--   runDailyPsSavings 的此別名不匹配需修正。
SELECT
  p.asset_id,
  GREATEST(0, p.daily_peak_kva - COALESCE(h.contracted_demand_kw, 0)) AS avoided_kva,
  GREATEST(0, p.daily_peak_kva - COALESCE(h.contracted_demand_kw, 0))
    * COALESCE(ts.demand_charge_rate_per_kva, 0)
    / GREATEST(1, DATE_PART('days',
        DATE_TRUNC('month', $1::date) + INTERVAL '1 month'
        - DATE_TRUNC('month', $1::date)
      )) AS daily_ps_savings,
  p.confidence
FROM peak_per_asset p
JOIN assets a ON a.asset_id = p.asset_id
LEFT JOIN gateways g ON g.gateway_id = a.gateway_id
LEFT JOIN tariff_schedules ts ON ts.org_id = a.org_id AND ts.effective_to IS NULL
```

### UPSERT 至 revenue_daily

```sql
UPDATE revenue_daily SET
  ps_savings_reais    = $1,
  ps_avoided_peak_kva = $2,
  do_shed_confidence  = $3
WHERE asset_id = $4 AND date = $5::date
```

### 反事實 kW 重建公式

```
counterfactual_kW =
    actual_grid_import_kW           -- 電網實際輸送的電力
  + bat_discharge_kW                -- 電池覆蓋的部分（無 PS 時將由電網供電）
  + DO0_load_shed_kW                -- DO0 切斷的部分（無繼電器時將為需量）
  + DO1_load_shed_kW                -- DO1 切斷的部分（無繼電器時將為需量）
```

這重建了「若 PS 模式和 DO 繼電器未啟動，站點的電網需量本應是多少」。

### DO 負載削減計算

對於 DO 從 0→1 轉換的每個 5 分鐘窗口：
1. 找到轉換**之前**的最後一筆 `telemetry_history` 記錄（窗口開始前最多 3 分鐘）
2. 找到轉換**之後**的第一筆 `telemetry_history` 記錄（窗口開始後最多 3 分鐘）
3. `load_shed_kW = load_power_before - load_power_after`
4. 若任一記錄缺失：`load_shed_kW = 0`（保守備援）

### 每日節省公式

```
daily_peak_kva = MAX(counterfactual_kVA) 跨當日所有 15 分鐘窗口
avoided_kva = MAX(0, daily_peak_kva - contracted_demand_kw)
daily_ps_savings = avoided_kva * demand_charge_rate_per_kva / days_in_month
```

除以 `days_in_month` 按比例分配月度需量費。這是**暫定**估計 — 月度調整會修正，因為只有整月中最高的單一 15 分鐘窗口才決定實際需量費。

---

## 3. `runMonthlyTrueUp` — 邏輯

### 檔案：`market-billing/services/daily-billing-job.ts`

在每月 1 日執行（或手動觸發）。

```
1. 確定 billing_month = 上一完整月份
2. 查詢全月 asset_5min_metrics 中所有 PS 活動窗口
3. 重建完整 15 分鐘需量序列（與每日相同的 CTE，但為全月範圍）
4. 找到真實 monthly_peak_kva（整月最高 15 分鐘窗口）
5. 計算：avoided_kva = MAX(0, monthly_peak_kva - contracted_demand_kw)
6. 計算：true_ps_savings = avoided_kva * demand_charge_rate_per_kva
7. 計算：sum_of_daily_provisionals = 上月 SUM(ps_savings_reais)
8. true_up = true_ps_savings - sum_of_daily_provisionals
9. INSERT INTO revenue_daily
     (asset_id, date = first_of_month, true_up_adjustment_reais = true_up)
   -- 永不 UPDATE 既有列
```

### 月度重新掃描 SQL

```sql
-- 與每日相同的 ps_active_windows 和 demand_15min CTE，
-- 但使用全月範圍：$1 = month_start, $2 = month_end

WITH all_ps_windows AS (
  SELECT
    m.asset_id,
    date_bin('15 minutes', m.window_start, TIMESTAMP '2026-01-01 03:00:00+00') AS window_15,
    AVG((m.grid_import_kwh * 12) + (m.bat_discharge_kwh * 12)) AS cf_kw_avg
  FROM asset_5min_metrics m
  WHERE m.window_start >= $1 AND m.window_start < $2
    AND (
      SELECT COALESCE(dr.target_mode, 'UNASSIGNED')
      FROM dispatch_records dr
      WHERE dr.asset_id = m.asset_id AND dr.dispatched_at <= m.window_start
      ORDER BY dr.dispatched_at DESC LIMIT 1
    ) = 'peak_shaving'
  GROUP BY m.asset_id, window_15
),
monthly_peak AS (
  SELECT
    w.asset_id,
    MAX(w.cf_kw_avg / COALESCE(ts.billing_power_factor, 0.92)) AS monthly_peak_kva
  FROM all_ps_windows w
  JOIN assets a ON a.asset_id = w.asset_id
  LEFT JOIN tariff_schedules ts ON ts.org_id = a.org_id
    AND ts.effective_to IS NULL
  GROUP BY w.asset_id
),
daily_sum AS (
  SELECT asset_id, COALESCE(SUM(ps_savings_reais), 0) AS sum_provisionals
  FROM revenue_daily
  WHERE date >= $3 AND date < $4
  GROUP BY asset_id
)
SELECT
  mp.asset_id,
  GREATEST(0, mp.monthly_peak_kva - COALESCE(g.contracted_demand_kw, 0))
    * COALESCE(ts.demand_charge_rate_per_kva, 0) AS true_ps_savings,
  COALESCE(ds.sum_provisionals, 0) AS sum_daily_provisionals
FROM monthly_peak mp
JOIN assets a ON a.asset_id = mp.asset_id
LEFT JOIN gateways g ON g.gateway_id = a.gateway_id
LEFT JOIN tariff_schedules ts ON ts.org_id = a.org_id
  AND ts.effective_to IS NULL
LEFT JOIN daily_sum ds ON ds.asset_id = mp.asset_id
```

### 調整 INSERT

```sql
-- 硬約束：INSERT 新列，永不 UPDATE 歷史每日列
INSERT INTO revenue_daily (asset_id, date, true_up_adjustment_reais)
VALUES ($1, $2, $3)
ON CONFLICT (asset_id, date) DO UPDATE
  SET true_up_adjustment_reais = EXCLUDED.true_up_adjustment_reais
```

調整列使用 `date = first_of_month` 作為其鍵。這與每日暫定值（使用 `date = each_day`）是分開的列。若調整任務執行多次，它覆蓋自己的列（冪等）但永不觸及 28-31 筆每日列。

---

## 4. Cron 排程

| 任務 | 排程 | 描述 |
|------|------|------|
| `runDailyPsSavings` | **每日 00:05 UTC**（`"5 0 * * *"` 觸發的 `runDailyBilling` 內部呼叫） | 在既有每日計費 cron 中的 SC/TOU 歸因之後執行 |
| `runMonthlyTrueUp` | **尚無 cron 排程**（函式已匯出，需手動或外部觸發） | 設計為每月 1 日執行，但程式碼中未註冊 cron 項目 |

### 月度調整 Cron

> **注意：程式碼差異** — 下方 cron 項目為設計意圖，但目前程式碼中**尚未實作**。`runMonthlyTrueUp(pool, billingMonth)` 已匯出，但 `startBillingJob()` 僅註冊了每日 cron，未註冊月度 cron。需手動呼叫或新增 cron 排程。

```typescript
// 設計意圖（尚未在 daily-billing-job.ts 中實作）：
cron.schedule("0 4 1 * *", () => {
  const lastMonth = new Date();
  lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
  runMonthlyTrueUp(pool, lastMonth);
});
```

### 執行順序（每日）

```
00:05 UTC  daily-billing-job 開始（cron = "5 0 * * *"）
  |-- 1. 查詢 asset_hourly_metrics + tariff_schedules
  |-- 2. calculateBaselineCost / calculateActualCost / calculateBestTouCost（不變）
  |-- 3. calculateSelfConsumption / calculateSelfSufficiency
  |-- 4. UPSERT revenue_daily（基礎欄位）
  |-- 5. SC/TOU 歸因（v5.15，5 分鐘窗口 + dispatch_records）
  |-- 6. runDailyPsSavings（v5.16）
00:xx UTC  daily-billing-job 完成
```

---

## 5. 連線池與邊界規則

| 規則 | 執行方式 |
|------|----------|
| M4 讀取 `asset_5min_metrics` 用於 PS 反事實 | 程式碼審查 + 測試 |
| M4 讀取 `telemetry_history` **僅**用於 DO 轉換 | v5.8 紅線的例外（範圍限定：僅 DO 狀態，非能量資料） |
| M4 讀取 `dispatch_records` 取得 target_mode | 與 v5.15 相同 |
| M4 讀取 `tariff_schedules` 取得 demand_charge_rate、billing_power_factor | 程式碼審查 + 測試 |
| M4 讀取 `gateways` 取得 contracted_demand_kw | 程式碼審查 + 測試（v5.19 schema 變更：從 homes 改為 gateways） |
| M4 使用 `shared/tarifa.ts` 純函式計算 baseline/actual/bestTou 成本 | 程式碼審查（`calculateBaselineCost`、`calculateActualCost`、`calculateBestTouCost`、`calculateSelfConsumption`、`calculateSelfSufficiency`） |
| M4 使用 Pool（由 `startBillingJob(pool)` 傳入） | 任務啟動時傳入連線池 |
| **M4 永不寫入 dispatch_records** | 程式碼審查 |

### telemetry_history 存取例外

v5.8 確立了 M4 永不讀取 `telemetry_history`。v5.16 新增了**範圍限定例外**：M4 僅在 PS 節省計算期間讀取 `telemetry_history` 的 DO 狀態轉換（`do0_active`、`do1_active`）。這是必要的，因為 DO 狀態未彙總至 `asset_5min_metrics`（它是時間點繼電器狀態，非能量流）。

存取限定於：
- 讀取欄位：`recorded_at`、`load_power`、`do0_active`、`do1_active`
- 時間範圍：與計費窗口相同的 BRT 日
- 目的：偵測 0→1 轉換並計算 load_shed_kW

---

## 6. 範圍外項目

| 指標 | 範圍外原因 | 時程 |
|------|-----------|------|
| CCEE PLD 批發套利 | 分散式儲能未受規管 | v6.0+ |
| DR 補貼收入 | ANEEL DR 框架尚未定案 | v6.0+ |
| 離線回填重新掃描 | 閘道器回填未實作 | v6.0 |
| 跨時段 TOU 費用成本 | TOU 使用同時段費率 | v5.17+ |

---

## 7. 程式碼變更清單

| 檔案 | 動作 | 描述 |
|------|------|------|
| `market-billing/services/daily-billing-job.ts` | **無變更** | v5.16 實作不變。已知問題：(1) `runDailyPsSavings` SQL 中 `h.contracted_demand_kw` 別名不匹配（JOIN 為 `gateways g` 但引用 `h.`），`runMonthlyTrueUp` 已正確使用 `g.`；(2) `startBillingJob()` 僅註冊每日 cron（`"5 0 * * *"`），月度 true-up cron 未實作 |
| `market-billing/handlers/calculate-profit.ts` | **無變更** | 利潤計算邏輯維持不變。Lambda Handler，接收 `ProfitRequest` 事件，使用 AppConfig 動態計費規則 |
| `market-billing/handlers/get-tariff-schedule.ts` | **無變更** | 電價查詢邏輯維持不變。API Gateway handler，使用 RLS 租戶隔離（`SET LOCAL app.current_org_id`） |
| `shared/tarifa.ts` | **無變更** | 提供 `calculateBaselineCost`、`calculateActualCost`、`calculateBestTouCost`、`calculateSelfConsumption`、`calculateSelfSufficiency` 等純函式，供 daily-billing-job.ts 使用 |

---

## 8. 測試策略

| 測試 | 輸入 | 預期結果 |
|------|------|----------|
| PS 節省基本案例 | grid_import=5kWh, bat_discharge=3kWh, 無 DO, contracted=100kW, rate=10 R$/kVA | counterfactual_kW = (5+3)*12 = 96kW; kVA = 96/0.92 = 104.3; avoided = 4.3; savings = 4.3*10/30 |
| DO0 負載削減 | DO0 轉換 0→1, load_before=50kW, load_after=30kW | do0_shed_kw = 20 |
| 缺失 DO 遙測 | DO0 轉換但無轉換後記錄 | do0_shed_kw = 0, confidence = 'low' |
| 無 PS 派遣 | 當日無 peak_shaving dispatch_records | ps_savings = 0 |
| 月度調整 | 每日暫定值合計 100，真實月度值 = 120 | true_up = 20 |
| 負向調整 | 每日暫定值合計 150，真實月度值 = 120 | true_up = -30 |
| 調整冪等 | 同一月份執行兩次 | 相同結果，單一調整列 |
| NULL demand_charge_rate | demand_charge_rate IS NULL | ps_savings = 0（COALESCE 為 0） |
| date_bin 對齊 | window_start 於 03:00 UTC | 對齊至 BRT 午夜 15 分鐘邊界 |
| 永不 UPDATE 每日列 | 調整執行 | 不 UPDATE 每日 ps_savings 列；僅在月初列上 INSERT/UPSERT |

---

## 文件歷史

| 版本 | 日期 | 摘要 |
|------|------|------|
| v5.2 | 2026-02-27 | 初版：Lambda + DynamoDB 計費 |
| v5.5 | 2026-02-28 | 雙層經濟模型 |
| v5.6 | 2026-02-28 | PLD 逐時資料匯入管線 |
| v5.8 | 2026-03-02 | 資料契約 — 僅讀取 asset_hourly_metrics |
| v5.11 | 2026-03-05 | 每日計費批次任務使用 Service Pool |
| v5.13 | 2026-03-05 | Tarifa Branca C 端節省 + 優化 Alpha |
| v5.14 | 2026-03-06 | 公式大修：DP 最優 TOU + baseline/actual/bestTou |
| v5.15 | 2026-03-07 | 5 分鐘資料的 SC/TOU 歸因 + 派遣模式 JOIN |
| v5.16 | 2026-03-07 | PS 節省歸因：runDailyPsSavings（反事實 kW = grid_import + bat_discharge + DO_shed；date_bin 15 分鐘需量；kW→kVA；avoided_kva * rate / days_in_month）；runMonthlyTrueUp（月度重新掃描，INSERT true_up_adjustment_reais，永不 UPDATE 歷史）；telemetry_history 範圍限定例外用於 DO 轉換；月度 cron 0 4 1 * *；do_shed_confidence high/low |
| **v5.22** | **2026-03-13** | **無程式碼變更。Schema 依賴備註：contracted_demand_kw 從 homes 遷移至 gateways（v5.19）；runMonthlyTrueUp 已正確使用 `g.contracted_demand_kw`，runDailyPsSavings 殘留舊別名 `h.`（待修正）。文件修正：cron 為 `"5 0 * * *"`（非 02:00 UTC）、月度 cron 未實作、confidence 邏輯為逐窗口 MIN 聚合（非簡單 MAX 判斷）、新增 shared/tarifa.ts 參考** |
