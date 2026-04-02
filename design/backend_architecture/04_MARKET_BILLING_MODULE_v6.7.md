# M4: 市場與計費模組 — v6.7 完整技術參考

> **模組版本**: v6.7
> **Git HEAD**: `b94adf3`
> **上層文件**: [00_MASTER_ARCHITECTURE_v6.7.md](./00_MASTER_ARCHITECTURE_v6.7.md)
> **前版**: [04_MARKET_BILLING_MODULE_v5.24.md](./_archive/04_MARKET_BILLING_MODULE_v5.24.md)
> **最後更新**: 2026-04-02
> **說明**: v6.7 完整模組參考文件 — 整合電價查詢、利潤計算、每日計費批次、收入模型、自消費/自給率、P3 節省公式
> **核心主題**: Market Billing 模組全景：Tariff Schedule Handler + Profit Calculation + Daily Billing Job + Revenue Model

---

## 與 v5.24 的差異

**v5.24 → v6.7：`runDailyPsSavings` SQL 別名修正 + 文件升級為完整技術參考。**

| 面向 | v5.24 | v6.6 |
|------|-------|------|
| 文件範圍 | 僅 P3 Savings 即時計算公式補充 | **完整模組參考**：涵蓋所有 handlers、services、shared functions |
| `runDailyPsSavings` SQL 別名 | ⚠️ v5.22 已知問題：`h.contracted_demand_kw` 殘留（文件記錄但未修正） | **已修正**：所有 `contracted_demand_kw` 引用均使用 `g.`（`gateways g`） |
| Baseline/Actual/BestTou 計算 | 不變 | 不變 |
| SC/TOU 歸因 | 不變 | 不變 |
| PS 節省（runDailyPsSavings） | 不變 | SQL 別名已修正，邏輯不變 |
| 月度調整（runMonthlyTrueUp） | 不變 | 不變 |
| P3 即時 savings 公式 | v5.24 新增 | **納入本文件**（§8） |
| 電價查詢 Handler | 未記錄於 v5.24 | **新增文件**：get-tariff-schedule.ts（§2） |
| 利潤計算 Handler | 未記錄於 v5.24 | **新增文件**：calculate-profit.ts（§3） |
| shared/tarifa.ts | 簡要提及 | **完整記錄**：所有純函式簽名與公式（§7） |
| DB Schema 參考 | 分散 | **統一**：revenue_daily 完整欄位（§9） |

---

## 1. 架構概覽

### 1.1 模組組成

```
market-billing/
├── handlers/
│   ├── get-tariff-schedule.ts   — API Gateway handler：查詢電價時間表
│   └── calculate-profit.ts      — Lambda handler：利潤計算（直接調用）
├── services/
│   └── daily-billing-job.ts     — Cron 每日計費批次任務
└── schema.sql                   — 模組 DDL 參考 (legacy column names; runtime uses db-init/02_schema.sql)（organizations, assets, tariff_schedules）

shared/
└── tarifa.ts                    — 純函式庫：Tarifa Branca 分段費率計算
```

### 1.2 執行模型

| 組件 | 觸發方式 | 運行環境 |
|------|----------|----------|
| `get-tariff-schedule` | API Gateway HTTP GET | Lambda（冷啟動連線池） |
| `calculate-profit` | Lambda 直接調用（非 API Gateway） | Lambda |
| `daily-billing-job` | Cron `"5 0 * * *"` 每日 00:05 UTC | Service Pool（長駐程序） |
| `runMonthlyTrueUp` | 已匯出，尚無自動 cron（設計為 `"0 4 1 * *"`） | 手動觸發或外部排程 |

### 1.3 收入模型（Revenue Model）

M4 實作雙層經濟模型：

| 層 | 欄位 | 描述 | 狀態 |
|----|------|------|------|
| **C-side（客戶端）** | `client_savings_reais` | 客戶因 PV + 電池而省下的電費（baseline - actual） | **已實作** |
| **B-side（平台端）** | `vpp_arbitrage_profit_reais` | VPP PLD 批發套利利潤 | **佔位符**（= 0，待 PLD 真實資料） |

C-side 節省進一步拆分為三個歸因：

| 歸因 | 欄位 | 計算 |
|------|------|------|
| 自消費節省 | `sc_savings_reais` | PV 自消費能量 x 平均費率 |
| 分時套利節省 | `tou_savings_reais` | 放電@尖峰費率 - 充電@離峰費率 |
| 削峰節省 | `ps_savings_reais` | 避免的超約 kVA x 需量費率 / 月天數 |

---

## 2. 電價查詢 Handler（get-tariff-schedule.ts）

### 2.1 端點行為

- **路由**：API Gateway HTTP endpoint
- **鑒權**：JWT token → `verifyTenantToken` + `requireRole`
- **允許角色**：`SOLFACIL_ADMIN`, `ORG_MANAGER`, `ORG_OPERATOR`, `ORG_VIEWER`
- **租戶隔離**：PostgreSQL RLS，通過 `SET LOCAL app.current_org_id = $1` 在顯式事務中啟用
- **回傳**：`tariff_schedules` 全部欄位，按 `effective_from DESC` 排序

### 2.2 連線池

```typescript
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
```

每 Lambda 冷啟動實例化一次。查詢使用 `BEGIN` / `SET LOCAL` / `COMMIT` 三步事務模式，確保 RLS 防護罩生效。

### 2.3 RLS 事務模式

```sql
BEGIN;
SET LOCAL app.current_org_id = $1;   -- 激活 RLS
SELECT * FROM tariff_schedules ORDER BY effective_from DESC;
COMMIT;
```

失敗時 `ROLLBACK`，`finally` 區塊釋放連線（`client.release()`）。

---

## 3. 利潤計算 Handler（calculate-profit.ts）

### 3.1 輸入/輸出

**輸入**：`ProfitRequest` 事件（Lambda 直接調用，非 API Gateway）

```typescript
interface ProfitRequest {
  readonly orgId?: string;         // 必填（鑒權門禁）
  readonly assetId?: string;
  readonly date?: string;
  readonly energyKwh?: number;     // 零值/負值 → 全部歸零
  readonly tariff?: Partial<Tariff>;
  readonly operatingCostPerKwh?: number;
  readonly role?: string;
}
```

**輸出**：按 Tarifa Branca 三段費率加權分配能量，計算 grossRevenue / operatingCost / profit

### 3.2 電價結構

```typescript
interface Tariff {
  readonly peakRate: number;
  readonly offPeakRate: number;
  readonly intermediateRate: number;
  readonly peakHours: number;        // 三段小時數之和必須 = 24
  readonly offPeakHours: number;
  readonly intermediateHours: number;
}
```

### 3.3 計算公式

```
能量分配（按時段小時數加權）:
  peakEnergy         = energyKwh * (peakHours / 24)
  offPeakEnergy      = energyKwh * (offPeakHours / 24)
  intermediateEnergy = energyKwh * (intermediateHours / 24)

各時段收入:
  peakRevenue         = peakEnergy * peakRate
  offPeakRevenue      = offPeakEnergy * offPeakRate
  intermediateRevenue = intermediateEnergy * intermediateRate

匯總:
  grossRevenue  = peakRevenue + offPeakRevenue + intermediateRevenue
  operatingCost = energyKwh * operatingCostPerKwh * tariffPenaltyMultiplier
  profit        = grossRevenue - operatingCost
```

所有金額四捨五入至小數點後 2 位（`round2`）。

### 3.4 AppConfig 動態計費規則

從 AWS AppConfig 取得每組織計費規則（500ms timeout，失敗回退預設值）：

```
URL: ${APPCONFIG_BASE}/applications/${APPCONFIG_APP}/environments/${APPCONFIG_ENV}/configurations/billing-rules
```

```typescript
interface BillingRulesConfig {
  readonly [orgId: string]: {
    readonly tariffPenaltyMultiplier?: number;  // 預設 1.0
    readonly operatingCostPerKwh?: number;
  };
}
```

### 3.5 TODO 備註

```
// TODO: v5.6 — Implement real two-tier profit calculation.
// B-side: JOIN pld_horario + trade history → vppArbitrageProfit (R$/MWh)
// C-side: retail_buy_rate_kwh × self-consumed kWh → clientSavings (R$/kWh)
```

`calculate-profit.ts` 目前為 Demo 狀態，用於單次利潤計算。真正的每日計費邏輯由 `daily-billing-job.ts` 執行。

---

## 4. 每日計費批次任務（daily-billing-job.ts）

### 4.1 Cron 排程

```typescript
cron.schedule("5 0 * * *", () => runDailyBilling(pool));
```

每日 00:05 UTC 執行，處理前一完整 BRT 日的資料。

### 4.2 執行管線

```
00:05 UTC  runDailyBilling 開始
  |
  |-- Step 1: 查詢 asset_hourly_metrics + assets
  |     SQL: SELECT ahm.*, a.org_id, a.capacity_kwh, a.soc_min_pct, a.max_charge_rate_kw, a.max_discharge_rate_kw
  |          FROM asset_hourly_metrics ahm JOIN assets a
  |          WHERE DATE(ahm.hour_timestamp AT TIME ZONE 'America/Sao_Paulo') = yesterday
  |
  |-- Step 2: 查詢 tariff_schedules（每組織生效費率）
  |     SQL: SELECT DISTINCT ON (org_id) ... WHERE effective_from <= date AND (effective_to IS NULL OR ...)
  |
  |-- Step 3: 按資產分組小時資料，累計每日總量
  |     ├── totalPvKwh, totalGridImportKwh, totalGridExportKwh
  |     ├── totalDischargeKwh, totalLoadKwh
  |     └── initialSoc（hour 0 的 avg_battery_soc，fallback 50%）
  |
  |-- Step 4: 計算並 UPSERT revenue_daily（基礎欄位）
  |     ├── calculateBaselineCost(hourlyLoads, schedule)
  |     ├── calculateActualCost(hourlyGridImports, schedule)
  |     ├── calculateBestTouCost({hourlyData, schedule, capacity, ...})
  |     ├── calculateSelfConsumption(totalPvKwh, totalGridExportKwh)
  |     ├── calculateSelfSufficiency(totalLoadKwh, totalGridImportKwh)
  |     └── clientSavings = baselineCost - actualCost
  |
  |-- Step 5 (v5.15): SC/TOU 歸因（5 分鐘窗口 + dispatch_records）
  |     ├── BRT 窗口：yesterday 03:00 UTC → today 03:00 UTC
  |     ├── 讀取 asset_5min_metrics + dispatch_records（active_mode JOIN）
  |     ├── scSavings = scEnergyKwh * avgRate
  |     └── touSavings = touDischargeKwh * peakRate - touChargeKwh * offpeakRate
  |
  |-- Step 6 (v5.16): runDailyPsSavings — PS 削峰節省歸因
  |
  `-- 完成：log settled count
```

### 4.3 Baseline / Actual / BestTou 成本計算

| 成本 | 公式 | 資料源 |
|------|------|--------|
| **Baseline** | `Σ load_kwh[h] * rate(h)` for h=0..23 | `asset_hourly_metrics.load_consumption_kwh` |
| **Actual** | `Σ grid_import_kwh[h] * rate(h)` for h=0..23 | `asset_hourly_metrics.grid_import_kwh` |
| **BestTou** | DP 最優化：給定完美預知，找到最小化電網進口成本的充放電排程 | load + PV per hour，電池參數 |

**client_savings_reais = baseline_cost - actual_cost**

### 4.4 SC/TOU 歸因（Step 5）

使用 `asset_5min_metrics` 搭配 `dispatch_records` 的 `target_mode` JOIN：

```sql
WITH windowed AS (
  SELECT m.asset_id, m.window_start, ...,
    COALESCE(
      (SELECT dr.target_mode FROM dispatch_records dr
       WHERE dr.asset_id = m.asset_id AND dr.dispatched_at <= m.window_start
       ORDER BY dr.dispatched_at DESC LIMIT 1),
      'UNASSIGNED'
    ) AS active_mode
  FROM asset_5min_metrics m
  WHERE m.window_start >= $1 AND m.window_start < $2
)
SELECT asset_id,
  SUM(CASE WHEN active_mode = 'self_consumption' THEN ... END) AS sc_energy_kwh,
  SUM(CASE WHEN active_mode = 'peak_valley_arbitrage' THEN bat_discharge_kwh END) AS tou_discharge_kwh,
  SUM(CASE WHEN active_mode = 'peak_valley_arbitrage' THEN bat_charge_from_grid_kwh END) AS tou_charge_kwh
FROM windowed GROUP BY asset_id
```

SC/TOU 節省寫入 `revenue_daily` 的 `sc_savings_reais` 和 `tou_savings_reais`。

---

## 5. PS 節省歸因（runDailyPsSavings）

### 5.1 反事實 kW 重建公式

```
counterfactual_kW =
    actual_grid_import_kW       -- 電網實際輸送的電力
  + bat_discharge_kW            -- 電池覆蓋的部分（無 PS 時將由電網供電）
  + DO0_load_shed_kW            -- DO0 繼電器切斷的部分
  + DO1_load_shed_kW            -- DO1 繼電器切斷的部分
```

### 5.2 DO 負載削減偵測

對於每個 5 分鐘窗口：
1. 找 DO 0→1 轉換**前**的最後一筆 `telemetry_history`（窗口前 3 分鐘內）
2. 找轉換**後**的第一筆記錄（窗口後 3 分鐘內）
3. `load_shed_kW = load_power_before - load_power_after`
4. 任一記錄缺失 → `load_shed_kW = 0`（保守備援）

### 5.3 需量計算管線

```
5 分鐘窗口 → date_bin('15 minutes') → AVG(cf_kw) → kW/PF → kVA
→ MAX(daily_peak_kva) → avoided_kva = MAX(0, daily_peak_kva - contracted_demand_kw)
→ daily_ps_savings = avoided_kva * demand_charge_rate_per_kva / days_in_month
```

### 5.4 信心度（Confidence）

每窗口信心度基於 DO 遙測：
- `'high'`：窗口內偵測到 `do0_active = true`
- `'low'`：僅在窗口前後 5 分鐘偵測到 DO 觸發
- 聚合時取 `MIN(confidence)`（最悲觀）

### 5.5 v6.6 修正：SQL 別名

**v5.22 已知問題已修正**：`runDailyPsSavings` SQL 現在正確使用 `g.contracted_demand_kw`（`LEFT JOIN gateways g`），與 `runMonthlyTrueUp` 一致。

---

## 6. 月度調整（runMonthlyTrueUp）

### 6.1 設計意圖

每月 1 日重新掃描整月 PS 活動窗口，計算真實月度尖峰 kVA，與每日暫定值合計比較，寫入調整值。

### 6.2 計算流程

```
1. 確定 billing_month = 上一完整月份
2. 全月 asset_5min_metrics PS 窗口 → date_bin 15 分鐘 → 月度 MAX kVA
3. avoided_kva = MAX(0, monthly_peak_kva - contracted_demand_kw)
4. true_ps_savings = avoided_kva * demand_charge_rate_per_kva
5. sum_daily_provisionals = SUM(ps_savings_reais) 前月
6. adjustment = true_ps_savings - sum_daily_provisionals
7. INSERT INTO revenue_daily (asset_id, date=first_of_month, true_up_adjustment_reais)
   ON CONFLICT DO UPDATE（冪等 UPSERT，永不修改歷史每日列）
```

### 6.3 Cron 狀態

> **注意**：`startBillingJob()` 僅註冊每日 cron（`"5 0 * * *"`）。月度 true-up cron `"0 4 1 * *"` 為設計意圖但**尚未在程式碼中自動註冊**。`runMonthlyTrueUp` 已匯出可手動調用。

---

## 7. 共用純函式庫（shared/tarifa.ts）

### 7.1 Tarifa Branca 預設值

```typescript
TARIFA_BRANCA_DEFAULTS = {
  peak:         { startHour: 18, endHour: 21, rate: 0.82 R$/kWh },
  intermediate: { ranges: [17-18, 21-22],     rate: 0.55 R$/kWh },
  offpeak:      { all other hours,             rate: 0.25 R$/kWh },
}
```

### 7.2 函式清單

| 函式 | 簽名 | 描述 |
|------|------|------|
| `classifyHour(hour)` | `(number) → TarifaPeriod` | 將 0-23 小時分類為 `ponta` / `intermediaria` / `fora_ponta` |
| `getRateForHour(hour, schedule)` | `(number, TariffSchedule\|null) → number` | 取得指定小時的費率，schedule 為 null 時使用預設值 |
| `calculateBaselineCost(hourlyLoads, schedule)` | `(Array<{hour,loadKwh}>, TariffSchedule) → number` | 假設帳單：所有負載由電網供電 |
| `calculateActualCost(hourlyGridImports, schedule)` | `(Array<{hour,gridImportKwh}>, TariffSchedule) → number` | 實際帳單：僅電網進口計費 |
| `calculateBestTouCost(params)` | `(BestTouInput) → BestTouResult` | DP 最優 TOU：給定完美預知的最優充放電排程 |
| `calculateSelfConsumption(pvKwh, exportKwh)` | `(number, number) → number\|null` | 自消費率 = (PV - export) / PV * 100 |
| `calculateSelfSufficiency(loadKwh, importKwh)` | `(number, number) → number\|null` | 自給率 = (load - gridImport) / load * 100 |

### 7.3 自消費與自給率

```
自消費率 (Self-Consumption):
  SC% = (pv_generation_kwh - grid_export_kwh) / pv_generation_kwh * 100
  意義：太陽能產出中有多少比例被站內消耗（非出口至電網）
  pv_generation = 0 時回傳 null

自給率 (Self-Sufficiency):
  SS% = (total_load_kwh - grid_import_kwh) / total_load_kwh * 100
  意義：負載中有多少比例不依賴電網供電
  total_load = 0 時回傳 null
```

### 7.4 DP 最優 TOU 演算法

`calculateBestTouCost` 使用動態規劃（Dynamic Programming），離散化 SoC 為 5% 步長：

- **狀態空間**：SoC 離散值（socMin → capacity，步長 = capacity * 5%），|S| <= 20
- **轉移**：每小時可充電/放電 ±maxRate，受限於 SoC 邊界
- **成本**：`gridImport * rate(hour)`，其中 `gridImport = MAX(0, delta - (pvKwh - loadKwh))`
- **最終**：所有終態中成本最小者
- **邊界**：capacity = 0 時退化為無電池場景

---

## 8. P3 Summary Savings 即時計算公式（原 v5.24）

### 8.1 即時計算 vs 預聚合的邊界

| 面向 | M4 每日批次（revenue_daily） | P3 即時計算（BFF handler） |
|------|----------------------------|--------------------------|
| **觸發時機** | Cron `"5 0 * * *"` 每日 00:05 UTC | 使用者請求 P3 頁面時 |
| **數據源** | `asset_hourly_metrics` + `asset_5min_metrics` | `telemetry_history`（原始 5 分鐘遙測） |
| **計算範圍** | 前一完整 BRT 日 | 使用者選定的任意日期範圍 |
| **節省類型** | baseline - actual（3 段費率）+ PS 需量費 | 假設帳單 - 實際帳單（3 段費率，不含 PS） |
| **寫入** | UPSERT → `revenue_daily` | 無（純讀計算，不持久化） |
| **精度** | 小時級 + 5 分鐘級 | 5 分鐘級（全部） |

### 8.2 P3 Savings 公式（與 M4 對齊）

```
假設帳單 (hypothetical_bill):
  = Σ (load_power_kw / 12) × rate(hour)
  其中 rate(hour) = peak_rate    if hour ∈ [18, 21)
                  = inter_rate   if hour ∈ [17, 18) ∪ [21, 22)
                  = offpeak_rate otherwise

實際帳單 (actual_bill):
  = Σ grid_import_kwh × rate(hour) - Σ grid_export_kwh × feed_in_rate

P3 savings = hypothetical_bill - actual_bill
```

### 8.3 已知精度差異

1. **PS 需量費不含**：P3 僅計算能量費節省，不含 PS 需量費（需整月數據）
2. **粒度差異**：M4 小時級 vs P3 5 分鐘級，差異 < 1%
3. **月度調整不含**：P3 不包含 `true_up_adjustment_reais`
4. **出口扣減差異**：P3 包含 `grid_export × feed_in_rate` 扣減，M4 batch 另行處理

### 8.4 前端顯示建議

P3 Summary 節省金額卡片應標註「估算」：
- 顯示格式：`R$ 8.50 (估算)`
- Tooltip：「基於 Tarifa Branca 三段費率即時計算，不含需量費調整。精確值見績效頁面。」

---

## 9. DB 表依賴

### 9.1 M4 讀取的表

| 表 | 讀取欄位 | 用途 | 步驟 |
|----|----------|------|------|
| `asset_hourly_metrics` | total_charge/discharge_kwh, pv_generation_kwh, grid_import/export_kwh, load_consumption_kwh, avg_battery_soc | 每日 Baseline/Actual/BestTou 計算 | Step 1 |
| `assets` | org_id, capacity_kwh, soc_min_pct, max_charge_rate_kw, max_discharge_rate_kw, gateway_id | 資產參數 | Step 1 |
| `tariff_schedules` | peak_rate, offpeak_rate, intermediate_rate, demand_charge_rate_per_kva, billing_power_factor | 費率 | Step 2, 5, 6 |
| `asset_5min_metrics` | pv_energy_kwh, bat_discharge_kwh, grid_export_kwh, bat_charge_from_grid_kwh, grid_import_kwh | SC/TOU 歸因 + PS 反事實 | Step 5, 6 |
| `dispatch_records` | target_mode, dispatched_at | 派遣模式（self_consumption / peak_valley_arbitrage / peak_shaving） | Step 5, 6 |
| `telemetry_history` | recorded_at, load_power, do0_active, do1_active | DO 轉換偵測（⚠️ v5.8 紅線例外：僅 DO 狀態） | Step 6 |
| `gateways` | contracted_demand_kw | 契約需量 | Step 6 |

### 9.2 M4 寫入的表

**唯一寫入目標：`revenue_daily`**

```sql
CREATE TABLE public.revenue_daily (
    id                          SERIAL PRIMARY KEY,
    asset_id                    VARCHAR(200) NOT NULL REFERENCES assets(asset_id),
    date                        DATE NOT NULL,
    -- 能量指標
    pv_energy_kwh               NUMERIC(10,3),
    grid_export_kwh             NUMERIC(10,3),
    grid_import_kwh             NUMERIC(10,3),
    bat_discharged_kwh          NUMERIC(10,3),
    -- 收入/成本
    revenue_reais               NUMERIC(12,2),
    cost_reais                  NUMERIC(12,2),
    profit_reais                NUMERIC(12,2),
    -- 雙層經濟模型
    vpp_arbitrage_profit_reais  NUMERIC(12,2),     -- B-side（佔位符 = 0）
    client_savings_reais        NUMERIC(12,2),     -- C-side = baseline - actual
    -- 自消費
    actual_self_consumption_pct NUMERIC(5,2),
    self_sufficiency_pct        REAL,
    -- 成本三元組
    baseline_cost_reais         NUMERIC(10,2),
    actual_cost_reais           NUMERIC(10,2),
    best_tou_cost_reais         NUMERIC(10,2),
    -- SC/TOU 歸因
    sc_savings_reais            NUMERIC(10,2),
    tou_savings_reais           NUMERIC(10,2),
    -- PS 削峰歸因
    ps_savings_reais            NUMERIC(10,2),
    ps_avoided_peak_kva         NUMERIC(8,3),
    do_shed_confidence          VARCHAR(10),        -- 'high' | 'low'
    -- 月度調整
    true_up_adjustment_reais    NUMERIC(10,2),
    -- 參考
    tariff_schedule_id          INTEGER,
    calculated_at               TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- 唯一約束
    UNIQUE (asset_id, date)
);
```

### 9.3 UPSERT 策略

| 操作 | 策略 |
|------|------|
| Step 4（基礎欄位） | `INSERT ... ON CONFLICT (asset_id, date) DO UPDATE` — 覆蓋所有基礎欄位 |
| Step 5（SC/TOU） | `UPDATE ... WHERE asset_id = $3 AND date = $4` — 只更新 sc/tou 欄位 |
| Step 6（PS） | `UPDATE ... WHERE asset_id = $4 AND date = $5` — 只更新 ps 欄位 |
| 月度 True-up | `INSERT ... ON CONFLICT DO UPDATE SET true_up_adjustment_reais` — 永不修改歷史每日列 |

---

## 10. 連線池與邊界規則

| 規則 | 執行方式 |
|------|----------|
| M4 每日批次讀取 `asset_hourly_metrics`（小時能量資料） | 程式碼審查 + 測試 |
| M4 讀取 `asset_5min_metrics` 用於 SC/TOU/PS 歸因 | 程式碼審查 + 測試 |
| M4 讀取 `telemetry_history` **僅**用於 DO 轉換偵測 | v5.8 紅線的範圍限定例外（僅 DO 狀態，非能量資料） |
| M4 使用 `shared/tarifa.ts` 純函式（無副作用） | 程式碼審查 |
| M4 使用 Pool（由 `startBillingJob(pool)` 傳入） | 任務啟動時傳入連線池 |
| **M4 永不寫入 dispatch_records** | 程式碼審查 |
| **M4 永不直接讀取 telemetry_history 的能量欄位** | 程式碼審查 |
| get-tariff-schedule 使用獨立 Pool（Lambda 冷啟動） | 架構審查 |
| calculate-profit 無資料庫連線（純計算） | 架構審查 |

---

## 11. 範圍外項目

| 指標 | 範圍外原因 | 時程 |
|------|-----------|------|
| CCEE PLD 批發套利（B-side 真實計算） | 分散式儲能未受規管；`vpp_arbitrage_profit_reais = 0` 為佔位符 | v7.0+ |
| DR 補貼收入 | ANEEL DR 框架尚未定案 | v7.0+ |
| 離線回填重新掃描 | 閘道器回填未實作 | v7.0 |
| 跨時段 TOU 費用成本 | TOU 歸因使用同時段費率（充電@offpeak, 放電@peak） | v7.0+ |
| 月度 true-up cron 自動註冊 | 函式已匯出但 startBillingJob 未註冊 `"0 4 1 * *"` | 下一版本 |

---

## 12. 程式碼變更清單（v5.24 → v6.6）

| 檔案 | 動作 | 描述 |
|------|------|------|
| `market-billing/services/daily-billing-job.ts` | **Bug fix** | `runDailyPsSavings` SQL 中 `h.contracted_demand_kw` 修正為 `g.contracted_demand_kw`，與 `LEFT JOIN gateways g` 一致。其餘邏輯不變 |
| `market-billing/handlers/calculate-profit.ts` | **無變更** | Lambda Handler，ProfitRequest → 三段費率加權利潤計算，AppConfig 動態規則 |
| `market-billing/handlers/get-tariff-schedule.ts` | **無變更** | API Gateway handler，RLS 租戶隔離（`SET LOCAL app.current_org_id`） |
| `shared/tarifa.ts` | **無變更** | 純函式：classifyHour、getRateForHour、calculateBaselineCost、calculateActualCost、calculateBestTouCost、calculateSelfConsumption、calculateSelfSufficiency |
| `market-billing/schema.sql` | **無變更** | DDL 參考 (legacy; runtime column names differ — see db-init/02_schema.sql for authoritative DDL) |

---

## 13. 測試策略

| 測試 | 輸入 | 預期結果 |
|------|------|----------|
| Baseline 成本 | 24 小時負載 × Tarifa Branca 費率 | Σ load × rate(h)，四捨五入至 0.01 |
| Actual 成本 | 24 小時 grid_import × 費率 | Σ import × rate(h) |
| Client savings | baseline=100, actual=60 | savings = 40 |
| BestTou DP（無電池） | capacity=0 | bestCost = Σ max(0, load-pv) × rate |
| BestTou DP（有電池） | capacity=10, load/pv/rate 已知 | bestCost <= actualCost |
| 自消費率 | pv=100, export=30 | SC = 70% |
| 自消費率（無 PV） | pv=0 | null |
| 自給率 | load=100, import=20 | SS = 80% |
| SC/TOU 歸因 | self_consumption 模式 5min 窗口 | sc_energy 正確累加 |
| PS 節省基本案例 | grid_import=5kWh, bat_discharge=3kWh, 無 DO | cf_kW = 96, kVA = 104.3, avoided = 4.3 |
| DO0 負載削減 | DO0 轉換 0→1, load_before=50, load_after=30 | do0_shed_kw = 20 |
| 缺失 DO 遙測 | 無轉換後記錄 | shed = 0, confidence = 'low' |
| 月度調整 | daily_sum=100, true_monthly=120 | adjustment = 20 |
| 負向調整 | daily_sum=150, true_monthly=120 | adjustment = -30 |
| 調整冪等 | 同月執行兩次 | 相同結果，單一列 |
| Profit Handler 零能量 | energyKwh=0 | all zeros, statusCode=200 |
| Profit Handler 缺失電價 | tariff 不完整 | throws Error |
| Tariff Handler 無 token | 無 Authorization header | 401 |
| Tariff Handler RLS | orgId=A 查詢 | 僅回傳 orgId=A 的 schedules |

---

## V2.4 協議影響

**M4 無需任何程式碼變更。** M4 的所有資料來源（`asset_hourly_metrics`、`asset_5min_metrics`、`tariff_schedules`、`dispatch_records`、`gateways`）均由 M1 上游寫入或由 BFF/管理操作維護。V2.4 的時間戳格式變更和數值縮放修正均在 M1 的 ingestion 層完成，M4 讀取的欄位名稱和語義不變。`revenue_daily` 的 UPSERT 邏輯與 `shared/tarifa.ts` 純函式均不受影響。

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
| v5.16 | 2026-03-07 | PS 節省歸因：runDailyPsSavings + runMonthlyTrueUp |
| v5.22 | 2026-03-13 | Schema 依賴備註（homes→gateways）；已知 SQL 別名問題 |
| v5.24 | 2026-03-13 | P3 Savings 即時計算公式對齊；即時 vs 預聚合邊界定義 |
| **v6.6** | **2026-03-31** | **完整模組參考文件（Git HEAD: 4ec191a）。修正 runDailyPsSavings SQL 別名（h.→g.contracted_demand_kw）。首次完整記錄：get-tariff-schedule handler（RLS 事務模式）、calculate-profit handler（AppConfig 動態規則 + 三段費率加權）、shared/tarifa.ts 全部純函式（classifyHour / getRateForHour / calculateBaselineCost / calculateActualCost / calculateBestTouCost / calculateSelfConsumption / calculateSelfSufficiency）、revenue_daily 完整 schema（22 欄位）、收入模型三層歸因（SC + TOU + PS）。納入 v5.24 P3 即時 savings 公式。** |
| **v6.7** | **2026-04-02** | **版本升級配合 V2.4 協議對齊。M4 無程式碼變更 — 上游時間戳處理與數值縮放對計費邏輯透明。** |
