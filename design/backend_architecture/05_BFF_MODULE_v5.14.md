# M5: BFF Module — KPI Replacement & Self-Sufficiency

> **模組版本**: v5.14
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.14.md](./00_MASTER_ARCHITECTURE_v5.14.md)
> **最後更新**: 2026-03-06
> **說明**: Block 2 — Replace Savings Alpha with Actual Savings + Optimization Efficiency; add Self-Sufficiency KPI
> **核心主題**: Scorecard metric replacement + Dashboard self-sufficiency + query routing red line

---

## Changes from v5.13

| Aspect | v5.13 | v5.14 |
|--------|-------|-------|
| Scorecard: "Savings Alpha" | Single % from calculateOptimizationAlpha | **REMOVED** — replaced by 2 metrics |
| Scorecard: "Actual Savings" | N/A | **NEW** — (baseline - actual) / baseline * 100 |
| Scorecard: "Optimization Efficiency" | N/A | **NEW** — (baseline - actual) / (baseline - bestTou) * 100 |
| Scorecard: "Self-Sufficiency" | N/A | **NEW** — (load - gridImport) / load * 100 |
| Scorecard: "Self-Consumption" | Kept | **Kept** (unchanged) |
| Dashboard: selfSufficiency | N/A | **NEW** — alongside selfConsumption |
| Query sources | revenue_daily (client_savings, actual_self_consumption_pct) | revenue_daily (+baseline_cost, +actual_cost, +best_tou_cost, +self_sufficiency_pct) |
| Import: calculateOptimizationAlpha | Used in scorecard | **DELETED** — no longer imported |

---

## v5.14 升版說明

### 問題陳述

v5.13's scorecard presents "Savings Alpha" — a metric derived from `calculateOptimizationAlpha`. This function uses a flawed theoretical maximum (1 cycle/day * rate spread) that doesn't account for PV, load patterns, or multi-cycle operation. The resulting percentage is misleading.

### 解決方案

Replace the single "Savings Alpha" metric with three self-explanatory KPIs:

1. **Actual Savings %** — how much the customer saves vs. no PV + no battery
2. **Optimization Efficiency %** — how close actual scheduling is to theoretical optimum
3. **Self-Sufficiency %** — what fraction of load is met without grid import

All three derive from pre-computed `revenue_daily` columns (populated by M4 billing job). **No formula computation happens in the BFF** — only SQL reads + simple division.

---

## 1. Endpoint Changes

### §1.1 GET `/api/v1/performance/scorecard` — Metric Replacement

#### REMOVE (1 metric)

```json
{ "name": "Savings Alpha", "value": 12.5, "unit": "%", "target": 10, "status": "pass" }
```

#### ADD (3 metrics)

```json
{
  "name": "Actual Savings",
  "value": 75.2,
  "unit": "%",
  "target": ">60%",
  "status": "pass"
}
```
**Formula:** `(baseline_cost - actual_cost) / baseline_cost * 100`
**Interpretation:** 75.2% means the customer's electricity bill is 75.2% lower than it would be without PV + battery.

```json
{
  "name": "Optimization Efficiency",
  "value": 91.5,
  "unit": "%",
  "target": ">80%",
  "status": "pass"
}
```
**Formula:** `(baseline_cost - actual_cost) / (baseline_cost - best_tou_cost) * 100`
**Interpretation:** 91.5% means actual scheduling captures 91.5% of the theoretically possible savings. 100% = perfect.

> ⚠️ **除零防禦（Gemini R1 防禦）**：若 `baseline_cost == best_tou_cost`（分母為零，例如設備剛上線無數據、整天關機、或 baseline 本身已是最優），此指標**必須回傳 `null`**。前端 JSON 型別定義為 `number | null`。BFF 不得回傳 `NaN`、`Infinity` 或 `0`。前端收到 `null` 時顯示 `"—"` 或 `"N/A"`。同樣規則適用於所有分母可能為零的 KPI（包括 Self-Consumption 的 pvGen=0、Self-Sufficiency 的 load=0）。

```json
{
  "name": "Self-Sufficiency",
  "value": 62.3,
  "unit": "%",
  "target": ">50%",
  "status": "pass"
}
```
**Formula:** `(load - grid_import) / load * 100`
**Interpretation:** 62.3% of load is met by PV + battery, without grid import.

#### Updated Optimization Category (full)

```typescript
const optimization: Metric[] = [
  {
    name: "Actual Savings",
    value: actualSavingsPct,         // v5.14: replaces savingsAlpha
    unit: "%",
    target: ">60%",
    status: evalStatus(actualSavingsPct, 60, 40),
  },
  {
    name: "Optimization Efficiency",
    value: optimizationEfficiency,   // v5.14: NEW
    unit: "%",
    target: ">80%",
    status: evalStatus(optimizationEfficiency, 80, 60),
  },
  {
    name: "Self-Consumption",
    value: selfConsumptionPct,       // unchanged from v5.13
    unit: "%",
    target: 80,
    status: evalStatus(selfConsumptionPct, 80, 60),
  },
  {
    name: "Self-Sufficiency",
    value: selfSufficiencyPct,       // v5.14: NEW
    unit: "%",
    target: ">50%",
    status: evalStatus(selfSufficiencyPct, 50, 30),
  },
  // PV Forecast MAPE and Load Forecast Adapt stay hardcoded
  { name: "PV Forecast MAPE", value: 8.2, unit: "%", target: 15, status: "pass" },
  { name: "Load Forecast Adapt", value: 92, unit: "%", target: 85, status: "pass" },
];
```

**Note:** Optimization category grows from 4 to 6 metrics. Response envelope format `{ success, data: { hardware, optimization, operations } }` is unchanged.

### §1.2 GET `/api/v1/dashboard` — Add Self-Sufficiency

#### ADD

```typescript
selfSufficiency: {
  value: selfSufficiencyPct,   // v5.14: NEW
  delta: selfSufficiencyDelta,
},
```

Alongside existing `selfConsumption: { value, delta }`.

---

## 2. Query Changes

### §2.1 Scorecard — Replace Savings Alpha Query

**v5.13 (DELETE):**
```typescript
// REMOVE: Savings Alpha query + calculateOptimizationAlpha import
queryWithOrg(
  `SELECT COALESCE(SUM(rd.client_savings_reais), 0) AS total_savings,
          COALESCE(SUM(a.capacity_kwh), 0) AS total_capacity
   FROM revenue_daily rd JOIN assets a ON ...`,
  [], rlsOrgId,
),
```

**v5.14 (REPLACE WITH):**
```typescript
// v5.14: Read pre-computed baseline/actual/bestTou from revenue_daily (last 30 days)
queryWithOrg(
  `SELECT
     COALESCE(SUM(baseline_cost_reais), 0) AS total_baseline,
     COALESCE(SUM(actual_cost_reais), 0)   AS total_actual,
     COALESCE(SUM(best_tou_cost_reais), 0) AS total_best_tou
   FROM revenue_daily
   WHERE date >= CURRENT_DATE - 30
     AND baseline_cost_reais IS NOT NULL`,
  [],
  rlsOrgId,
),
```

**v5.14: Self-Sufficiency query (last 7 days):**
```typescript
queryWithOrg(
  `SELECT ROUND(AVG(self_sufficiency_pct), 1) AS avg_ss
   FROM revenue_daily
   WHERE date >= CURRENT_DATE - 7
     AND self_sufficiency_pct IS NOT NULL`,
  [],
  rlsOrgId,
),
```

### §2.2 Scorecard — Calculation (after Promise.all)

```typescript
// v5.14: Actual Savings % — simple division from pre-computed columns
const costsRow = costsResult.rows[0] as Record<string, unknown>;
const totalBaseline = parseFloat(String(costsRow?.total_baseline ?? 0));
const totalActual = parseFloat(String(costsRow?.total_actual ?? 0));
const totalBestTou = parseFloat(String(costsRow?.total_best_tou ?? 0));

const actualSavingsPct = totalBaseline > 0
  ? Math.round(((totalBaseline - totalActual) / totalBaseline) * 1000) / 10
  : 0;

// v5.14: Optimization Efficiency %
const savingsGap = totalBaseline - totalBestTou;
const optimizationEfficiency = savingsGap > 0
  ? Math.round(((totalBaseline - totalActual) / savingsGap) * 1000) / 10
  : 0;

// v5.14: Self-Sufficiency from query
const ssRow = ssResult.rows[0] as Record<string, unknown>;
const selfSufficiencyPct = parseFloat(String(ssRow?.avg_ss ?? 0));
```

### §2.3 Dashboard — Self-Sufficiency Query

```typescript
// v5.14 NEW: Self-Sufficiency value + delta
queryWithOrg(
  `SELECT ROUND(AVG(self_sufficiency_pct), 1) AS avg_ss
   FROM revenue_daily
   WHERE date >= CURRENT_DATE - 7
     AND self_sufficiency_pct IS NOT NULL`,
  [],
  rlsOrgId,
),
queryWithOrg(
  `SELECT
     (SELECT ROUND(AVG(self_sufficiency_pct), 1) FROM revenue_daily
      WHERE date = CURRENT_DATE AND self_sufficiency_pct IS NOT NULL) -
     (SELECT ROUND(AVG(self_sufficiency_pct), 1) FROM revenue_daily
      WHERE date = CURRENT_DATE - 1 AND self_sufficiency_pct IS NOT NULL) AS delta`,
  [],
  rlsOrgId,
),
```

---

## 3. Query Routing Red Line (from v5.13 — UNCHANGED)

BFF 所有讀取查詢必須遵守以下分流規則，**嚴禁違反**：

| 查詢類型 | 允許的數據源 | 禁止的數據源 | 原因 |
|----------|-------------|-------------|------|
| **長天期聚合指標**（Scorecard、Revenue Trend、Dashboard KPI） | `asset_hourly_metrics`、`revenue_daily`、`device_state` | ~~`telemetry_history`~~ | Raw 時序表在設備數量增長後，長天期 SUM/GROUP BY 會打爆 App Pool CPU |
| **近 24h 高解析度能源流**（P3 Energy Behavior） | `telemetry_history`（唯一例外） | — | 24h 窗口 + v5.12 複合索引，查詢量可控 |
| **即時設備狀態**（Online/Offline） | `device_state` | ~~`telemetry_history`~~ | device_state 是 UPSERT 單行快照，O(1) |

**v5.14 Compliance:** All new queries read from `revenue_daily` (pre-computed by M4). No `telemetry_history` access. **COMPLIANT.**

---

## 4. App Pool Isolation Constraints (unchanged from v5.13)

```
+----------------------------------------------------+
|                     BFF HANDLER                     |
|                                                     |
|  1. extractTenantContext(event)  -> ctx.orgId        |
|  2. rlsOrgId = isAdmin ? null : ctx.orgId           |
|  3. queryWithOrg(sql, params, rlsOrgId)              |
|       |                                              |
|       +-- orgId provided -> App Pool                 |
|       |     SET LOCAL app.current_org_id = orgId      |
|       |     RLS ENFORCED                              |
|       |                                              |
|       +-- orgId null (ADMIN) -> Service Pool         |
|             BYPASSRLS -> sees all tenants            |
|                                                     |
|  4. NEVER import getServicePool() in BFF handlers   |
|  5. NEVER direct pool.query() -- always queryWithOrg|
+----------------------------------------------------+
```

### v5.14 Violation Check

| Handler | Pool Usage | Status |
|---------|-----------|--------|
| get-dashboard.ts | queryWithOrg() x10 (was x8) | COMPLIANT |
| get-performance-scorecard.ts | queryWithOrg() x7 (was x6) | COMPLIANT |
| get-revenue-trend.ts | queryWithOrg() x1 | COMPLIANT (unchanged) |
| get-home-energy.ts | queryWithOrg() x1 | COMPLIANT (unchanged) |
| get-performance-savings.ts | queryWithOrg() x1 | COMPLIANT (unchanged) |

All 19 BFF endpoints remain App Pool compliant.

---

## 5. Endpoint De-hardcoding Matrix (v5.14 Update)

### get-performance-scorecard.ts — Metrics

| # | Metric | v5.13 Status | v5.14 Status | Data Source |
|---|--------|-------------|-------------|-------------|
| 1 | Commissioning Time | Hardcoded (45min) | **Hardcoded** | Needs commissioning workflow |
| 2 | Offline Resilience | DB | DB (unchanged) | `offline_events.backfill` |
| 3 | Uptime (4 weeks) | DB | DB (unchanged) | `daily_uptime_snapshots` |
| 4 | First Telemetry | Hardcoded (5min) | **Hardcoded** | Needs commissioning workflow |
| 5 | ~~Savings Alpha~~ | DB (calculateOptimizationAlpha) | **DELETED** | Replaced by #5a + #5b |
| 5a | **Actual Savings** | N/A | **DB (NEW)** | `revenue_daily.baseline_cost - actual_cost` |
| 5b | **Optimization Efficiency** | N/A | **DB (NEW)** | `revenue_daily.baseline_cost / actual_cost / best_tou_cost` |
| 6 | Self-Consumption | DB | DB (unchanged) | `revenue_daily.actual_self_consumption_pct` |
| 6a | **Self-Sufficiency** | N/A | **DB (NEW)** | `revenue_daily.self_sufficiency_pct` |
| 7 | PV Forecast MAPE | Hardcoded (8.2%) | **Hardcoded** | Needs forecast-engine (v6.0) |
| 8 | Load Forecast Adapt | Hardcoded (92%) | **Hardcoded** | Needs forecast-engine (v6.0) |
| 9 | Dispatch Accuracy | DB | DB (unchanged) | `dispatch_records` |
| 10 | Training Time | Hardcoded (2hrs) | **Hardcoded** | Operational metric |
| 11 | Manual Interventions | Hardcoded (0) | **Hardcoded** | Operational metric |
| 12 | App Uptime | Hardcoded (99.9%) | **Hardcoded** | Needs health monitoring |

**v5.14 net change:** -1 metric (Savings Alpha), +3 metrics (Actual Savings, Optimization Efficiency, Self-Sufficiency). Scorecard grows from 12 to 14 metrics.

### get-dashboard.ts — KPI Cards

| KPI | v5.13 Status | v5.14 Status | Data Source |
|-----|-------------|-------------|-------------|
| totalAssets | DB | DB (unchanged) | `assets + device_state` |
| onlineAssets | DB | DB (unchanged) | `device_state.is_online` |
| avgSoc | DB | DB (unchanged) | `device_state.battery_soc` |
| totalPowerKw | DB | DB (unchanged) | `device_state.load_power` |
| dailyRevenueReais | DB (client_savings) | DB (unchanged) | `revenue_daily.client_savings_reais` |
| monthlyRevenueReais | DB (SUM client_savings) | DB (unchanged) | `revenue_daily.client_savings_reais` |
| selfConsumption | DB | DB (unchanged) | `revenue_daily.actual_self_consumption_pct` |
| **selfSufficiency** | N/A | **DB (NEW)** | `revenue_daily.self_sufficiency_pct` |
| gatewayUptime | DB | DB (unchanged) | `daily_uptime_snapshots.uptime_pct` |
| vppDispatchAccuracy | DB | DB (unchanged) | `dispatch_records` |
| drResponseLatency | DB | DB (unchanged) | `dispatch_records` |

---

## 6. What Stays Hardcoded (v5.14 Out of Scope)

| Metric | Handler | Current Value | Why Out of Scope |
|--------|---------|--------------|-----------------|
| Commissioning Time | scorecard | 45 min | Needs commissioning workflow tracking |
| First Telemetry | scorecard | 5 min | Needs commissioning workflow tracking |
| PV Forecast MAPE | scorecard | 8.2% | Needs forecast-engine (M2 v6.0) |
| Load Forecast Adapt | scorecard | 92% | Needs forecast-engine (M2 v6.0) |
| Training Time | scorecard | 2 hrs | Operational metric — no data source |
| Manual Interventions | scorecard | 0 /week | Operational metric — no data source |
| App Uptime | scorecard | 99.9% | Needs health monitoring infrastructure |
| acPower, evCharge | home-energy | placeholder arrays | AC/EV not yet telemetered |

---

## 7. Frontend Impact Assessment

| Change | Frontend Impact | Action Required |
|--------|----------------|-----------------|
| "Savings Alpha" removed from scorecard | Metric disappears from optimization list | **Minor** — metric rendered from API array |
| "Actual Savings" added | New metric appears in optimization list | None — rendered from API |
| "Optimization Efficiency" added | New metric appears in optimization list | None — rendered from API |
| "Self-Sufficiency" added to scorecard | New metric appears in optimization list | None — rendered from API |
| selfSufficiency added to dashboard | New KPI card | **Minor** — needs frontend card |
| Response envelope | `{ success, data }` unchanged | None |

**Conclusion: Frontend near-zero-change.** The scorecard optimization array grows by 2 net metrics — if the frontend renders metrics from the API array dynamically, no code change is needed. The dashboard `selfSufficiency` field is additive. Old field names remain intact.

---

## 8. 代碼變更清單

| 檔案 | 動作 | 說明 |
|------|------|------|
| `bff/handlers/get-performance-scorecard.ts` | **MODIFY** | Delete calculateOptimizationAlpha import + Savings Alpha query; add baseline/actual/bestTou query + self-sufficiency query; replace 1 metric with 3 |
| `bff/handlers/get-dashboard.ts` | **MODIFY** | Add selfSufficiency KPI (value + delta); +2 queries |
| All other BFF handlers (17) | **unchanged** | No impact |

---

## 9. 測試策略

| Test | Scope | Technique |
|------|-------|-----------|
| Actual Savings % | Returns correct value from seeded revenue_daily (baseline - actual) | Integration test with seed_v5.14.sql |
| Optimization Efficiency % | Returns correct value from seeded baseline/actual/bestTou | Integration test |
| Self-Sufficiency % | AVG of self_sufficiency_pct from revenue_daily | Integration test |
| Dashboard selfSufficiency | New KPI card with value + delta | Integration test |
| No Savings Alpha | "Savings Alpha" absent from optimization array | Snapshot test |
| Actual Savings/Optimization Efficiency present | Both metrics in optimization array | Snapshot test |
| App Pool enforcement | All queries go through queryWithOrg | Unit test: mock queryWithOrg |
| Response format | JSON shape includes new metrics | Snapshot test |
| Edge case: baseline=0 | No load data | Actual Savings = 0, Optimization Efficiency = 0 |
| Edge case: bestTou=baseline | No possible optimization | Optimization Efficiency = 0 (or N/A) |

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | 初始版本：BFF Gateway + 4 端點 |
| v5.3 | 2026-02-27 | HEMS 單戶控制端點 |
| v5.5 | 2026-02-28 | 雙層收益 KPI |
| v5.9 | 2026-03-02 | BFF 去硬編碼第一輪 |
| v5.10 | 2026-03-05 | Dashboard 7 queries de-hardcoded |
| v5.12 | 2026-03-05 | API Contract Alignment — 15 新端點 |
| v5.13 | 2026-03-05 | Scorecard 2 metrics de-hardcoded (Savings Alpha, Self-Consumption); Dashboard revenue -> Tarifa Branca |
| **v5.14** | **2026-03-06** | **KPI Replacement: delete Savings Alpha; add Actual Savings % (baseline-actual/baseline), Optimization Efficiency % (actual vs DP optimal), Self-Sufficiency % (load-gridImport/load); Dashboard +selfSufficiency KPI; all from pre-computed revenue_daily columns; no calculateOptimizationAlpha import; scorecard 12->14 metrics; App Pool compliant; frontend near-zero-change** |
