# M4: 市場與計費模組 — P3 Savings 即時計算公式對齊

> **模組版本**: v5.24
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.24.md](./00_MASTER_ARCHITECTURE_v5.24.md)
> **前版**: [04_MARKET_BILLING_MODULE_v5.22.md](./04_MARKET_BILLING_MODULE_v5.22.md)
> **最後更新**: 2026-03-13
> **說明**: 補充 P3 Summary 節省金額即時計算公式，與 M4 每日批次計算保持一致
> **核心主題**: 即時計算 vs 預聚合的邊界定義

---

## 與 v5.22 的差異

**v5.22 → v5.24：無程式碼變更。純文檔補充。**

| 面向 | v5.22 | v5.24 |
|------|-------|-------|
| PS 節省計算 | 已實作（runDailyPsSavings） | 不變 |
| 月度調整 | 已實作（runMonthlyTrueUp） | 不變 |
| **P3 即時 savings** | N/A | **新增文檔**：定義 P3 Summary 節省金額的即時計算公式，與 M4 batch 公式對齊 |
| **即時 vs 預聚合邊界** | 未明確定義 | **新增文檔**：明確兩者的計算範圍和精度差異 |

---

## 1. 更新後的計費邏輯

### v5.22 管線（v5.24 不變）

(Same as v5.22 §1. 見 `04_MARKET_BILLING_MODULE_v5.22.md`.)

---

## 2. P3 Summary Savings 即時計算公式（v5.24 NEW）

### 2.1 即時計算 vs 預聚合的邊界

| 面向 | M4 每日批次（revenue_daily） | P3 即時計算（BFF handler） |
|------|----------------------------|--------------------------|
| **觸發時機** | Cron `"5 0 * * *"` 每日 00:05 UTC | 使用者請求 P3 頁面時 |
| **數據源** | `asset_hourly_metrics`（baseline/actual/bestTou）；`asset_5min_metrics`（SC/TOU/PS） | `telemetry_history`（原始 5 分鐘遙測） |
| **計算範圍** | 前一完整 BRT 日 | 使用者選定的任意日期範圍（from → to） |
| **節省類型** | baseline_cost - actual_cost（3 段費率）+ PS 節省（需量費） | 假設帳單 - 實際帳單（3 段費率，不含 PS 需量費） |
| **寫入** | UPSERT → `revenue_daily` | 無（純讀計算，不持久化） |
| **精度** | 小時級（baseline/actual）+ 5 分鐘級（SC/TOU/PS） | 5 分鐘級（全部） |

### 2.2 P3 Savings 公式（與 M4 對齊）

P3 的節省金額計算採用與 M4 `calculateBaselineCost` / `calculateActualCost` 相同的 Tarifa Branca 三段費率邏輯：

```
假設帳單 (hypothetical_bill):
  = Σ (load_power_kw / 12) × rate(hour)
  其中 rate(hour) = peak_rate    if hour ∈ [peak_start, peak_end)
                  = inter_rate   if hour ∈ [inter_start, inter_end)
                  = offpeak_rate otherwise

實際帳單 (actual_bill):
  = Σ grid_import_kwh × rate(hour) - Σ grid_export_kwh × feed_in_rate

P3 savings = hypothetical_bill - actual_bill
```

**公式對齊驗證：**

| 公式組件 | M4 `calculateBaselineCost` | P3 即時計算 | 一致？ |
|----------|--------------------------|------------|--------|
| 負載能量 | `load_kwh` from `asset_hourly_metrics` | `load_power / 12` from `telemetry_history` | ✅ 同義（小時 vs 5 分鐘粒度） |
| 電價分段 | `classifyHour()` → peak/inter/offpeak | 相同三段分類邏輯 | ✅ |
| 費率來源 | `tariff_schedules` (org-level, effective_to IS NULL) | 相同查詢 | ✅ |
| 進口計算 | `actual_grid_import_kwh × rate` | 相同 | ✅ |
| 出口計算 | M4 `calculateActualCost` **不含**出口扣減 | P3 **包含** `grid_export_kwh × feed_in_rate` 扣減 | ⚠️ 差異 — P3 依 REQ 扣出口，M4 batch 另行處理 |
| PS 需量費 | 包含（`runDailyPsSavings`） | **不包含**（P3 僅計算能量費節省） | ⚠️ 已知差異 |

### 2.3 已知精度差異

1. **PS 需量費不含**：P3 即時計算僅包含能量費（kWh 基礎），不含 PS 需量費節省（kVA 基礎）。原因：PS 需量費需要整月數據計算月度尖峰，不適合即時計算。

2. **粒度差異**：M4 使用 `asset_hourly_metrics`（小時粒度），P3 使用 `telemetry_history`（5 分鐘粒度）。5 分鐘粒度的計算結果略精確，但差異 < 1%。

3. **月度調整不含**：P3 即時計算不包含 `true_up_adjustment_reais`。使用者如需查看經過月度調整的精確值，應參考 P6 Performance 頁面（讀取 `revenue_daily`）。

### 2.4 前端顯示建議

P3 Summary 的節省金額卡片應標註「估算」字樣：
- 顯示格式：`R$ 8.50 (估算)`
- Tooltip：「基於 Tarifa Branca 三段費率即時計算，不含需量費調整。精確值見績效頁面。」

---

## 3-8. 其餘章節

(Same as v5.22 §2-8. 見 `04_MARKET_BILLING_MODULE_v5.22.md`.)

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
| v5.16 | 2026-03-07 | PS 節省歸因 |
| v5.22 | 2026-03-13 | Schema 依賴備註（homes→gateways） |
| **v5.24** | **2026-03-13** | **P3 Savings 即時計算公式對齊：定義假設帳單/實際帳單/節省公式，與 M4 batch calculateBaselineCost/calculateActualCost 一致；明確即時 vs 預聚合邊界（P3 不含 PS 需量費、不含月度調整）；前端顯示建議（估算標註）** |
