# M5: BFF Module — De-hardcoding & Real SQL Integration

> **模組版本**: v5.13
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.13.md](./00_MASTER_ARCHITECTURE_v5.13.md)
> **最後更新**: 2026-03-05
> **說明**: Block 2 — Switch BFF endpoints from hardcoded values to real SQL queries using Tarifa Branca data
> **核心主題**: get-performance-scorecard 4 metrics de-hardcoded; get-dashboard Tarifa Branca savings; App Pool isolation preserved

---

## v5.13 升版說明

### 問題陳述

After v5.12's BFF expansion (19 endpoints), several handlers still return hardcoded values:

1. **`get-performance-scorecard.ts`** — 9 of 12 metrics are hardcoded (only uptime, dispatch accuracy, and offline resilience are DB-backed)
2. **`get-dashboard.ts`** — `gatewayUptime` still hardcoded as `99.9`; revenue calculations use PLD-based arbitrage which is not yet applicable
3. **`get-home-energy.ts`** — `acPower` and `evCharge` arrays are placeholders

v5.13 de-hardcodes the metrics that are **deterministically computable** from existing data + Tarifa Branca formulas. Metrics requiring prediction models or external data stay hardcoded.

### 解決方案

- De-hardcode 4 metrics in `get-performance-scorecard.ts` (Savings Alpha, Self-Consumption, Backfill Rate detail, Online Rate)
- Enhance `get-dashboard.ts` to show Tarifa Branca savings as primary revenue
- All queries MUST use App Pool + `queryWithOrg` (RLS isolation enforced)
- **Response envelope format unchanged** — frontend zero-change

### 🛡 查詢分流紅線（Gemini 審查 R1 補強）

BFF 所有讀取查詢必須遵守以下分流規則，**嚴禁違反**：

| 查詢類型 | 允許的數據源 | 禁止的數據源 | 原因 |
|----------|-------------|-------------|------|
| **長天期聚合指標**（Scorecard、Revenue Trend、Dashboard KPI） | `asset_hourly_metrics`、`revenue_daily`、`device_state` | ~~`telemetry_history`~~ | Raw 時序表在設備數量增長後，長天期 SUM/GROUP BY 會打爆 App Pool CPU |
| **近 24h 高解析度能源流**（P3 Energy Behavior） | `telemetry_history`（唯一例外） | — | 24h 窗口 + v5.12 複合索引，查詢量可控 |
| **即時設備狀態**（Online/Offline） | `device_state` | ~~`telemetry_history`~~ | device_state 是 UPSERT 單行快照，O(1) |

**實作約束：** Claude Code 在編寫 BFF handler 時，如果需要跨天聚合數據，**必須且只能**從 `asset_hourly_metrics` 或 `revenue_daily` 讀取。任何試圖直接 `SELECT ... FROM telemetry_history WHERE recorded_at > NOW() - INTERVAL '7 days'` 的寫法，視為 P0 缺陷。

---

## 1. Endpoint De-hardcoding Matrix

### get-performance-scorecard.ts — 12 Metrics

| # | Metric | Category | v5.12 Status | v5.13 Status | Data Source |
|---|--------|----------|-------------|-------------|-------------|
| 1 | Commissioning Time | Hardware | Hardcoded (45min) | **Hardcoded** | Needs commissioning workflow |
| 2 | Offline Resilience | Hardware | DB | DB (unchanged) | `offline_events.backfill` |
| 3 | Uptime (4 weeks) | Hardware | DB | DB (unchanged) | `daily_uptime_snapshots` |
| 4 | First Telemetry | Hardware | Hardcoded (5min) | **Hardcoded** | Needs commissioning workflow |
| 5 | **Savings Alpha** | Optimization | **Hardcoded (12.5%)** | **DB** | `revenue_daily` + `assets.capacity_kwh` + `tariff_schedules` |
| 6 | **Self-Consumption** | Optimization | **Hardcoded (87%)** | **DB** | `revenue_daily.actual_self_consumption_pct` |
| 7 | PV Forecast MAPE | Optimization | Hardcoded (8.2%) | **Hardcoded** | Needs forecast-engine (v6.0) |
| 8 | Load Forecast Adapt | Optimization | Hardcoded (92%) | **Hardcoded** | Needs forecast-engine (v6.0) |
| 9 | Dispatch Accuracy | Operations | DB | DB (unchanged) | `dispatch_records` |
| 10 | Training Time | Operations | Hardcoded (2hrs) | **Hardcoded** | Operational metric |
| 11 | Manual Interventions | Operations | Hardcoded (0) | **Hardcoded** | Operational metric |
| 12 | App Uptime | Operations | Hardcoded (99.9%) | **Hardcoded** | Needs health monitoring |

**v5.13 de-hardcodes 2 metrics** (#5 Savings Alpha, #6 Self-Consumption). The remaining 5 hardcoded metrics require infrastructure not yet built.

### get-dashboard.ts — KPI Cards

| KPI | v5.12 Status | v5.13 Status | Data Source |
|-----|-------------|-------------|-------------|
| totalAssets | DB | DB (unchanged) | `assets + device_state` |
| onlineAssets | DB | DB (unchanged) | `device_state.is_online` |
| avgSoc | DB | DB (unchanged) | `device_state.battery_soc` |
| totalPowerKw | DB | DB (unchanged) | `device_state.load_power` |
| dailyRevenueReais | DB (PLD arbitrage) | **DB (Tarifa Branca savings)** | `revenue_daily.client_savings_reais` |
| monthlyRevenueReais | DB (SUM revenue_reais) | **DB (SUM client_savings)** | `revenue_daily.client_savings_reais` |
| selfConsumption | DB (algorithm_metrics) | **DB (revenue_daily)** | `revenue_daily.actual_self_consumption_pct` |
| gatewayUptime | Hardcoded (99.9) | **DB** | `daily_uptime_snapshots.uptime_pct` |
| vppDispatchAccuracy | DB | DB (unchanged) | `dispatch_records` |
| drResponseLatency | DB | DB (unchanged) | `dispatch_records` |

**v5.13 de-hardcodes 1 KPI** (gatewayUptime) and **upgrades 3 KPI data sources** (revenue → Tarifa Branca, selfConsumption → revenue_daily).

---

## 2. Code Changes — get-performance-scorecard.ts

### 2.1 New Queries (added to Promise.all)

```typescript
// Query 4 (v5.13): Savings Alpha — last 30 days
queryWithOrg(
  `SELECT
     COALESCE(SUM(rd.client_savings_reais), 0) AS total_savings,
     COALESCE(SUM(a.capacity_kwh), 0) AS total_capacity
   FROM revenue_daily rd
   JOIN assets a ON a.asset_id = rd.asset_id AND a.is_active = true
   WHERE rd.date >= CURRENT_DATE - 30`,
  [],
  rlsOrgId,
),

// Query 5 (v5.13): Self-Consumption — latest 7-day average
queryWithOrg(
  `SELECT ROUND(AVG(actual_self_consumption_pct), 1) AS avg_sc
   FROM revenue_daily
   WHERE date >= CURRENT_DATE - 7
     AND actual_self_consumption_pct IS NOT NULL`,
  [],
  rlsOrgId,
),
```

### 2.2 Savings Alpha Calculation

```typescript
import { calculateOptimizationAlpha } from "../../shared/tarifa";

// After Promise.all resolves:
const savingsRow = savingsResult.rows[0] as Record<string, unknown>;
const totalSavings = parseFloat(String(savingsRow?.total_savings ?? 0));
const totalCapacity = parseFloat(String(savingsRow?.total_capacity ?? 0));

// Fetch tariff schedule for org (or use defaults)
const tariffRow = await queryWithOrg(
  `SELECT peak_rate, offpeak_rate FROM tariff_schedules
   WHERE effective_from <= CURRENT_DATE
     AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
   ORDER BY effective_from DESC LIMIT 1`,
  [],
  rlsOrgId,
);
const tariff = tariffRow.rows[0] as Record<string, unknown> | undefined;
const schedule = {
  peakRate: parseFloat(String(tariff?.peak_rate ?? 0.82)),
  offpeakRate: parseFloat(String(tariff?.offpeak_rate ?? 0.25)),
  intermediateRate: null,
};

const savingsAlpha = totalCapacity > 0
  ? calculateOptimizationAlpha(totalSavings, totalCapacity, schedule, 30)
  : 0;

// Self-consumption from query 5
const scRow = scResult.rows[0] as Record<string, unknown>;
const selfConsumptionPct = parseFloat(String(scRow?.avg_sc ?? 0));
```

### 2.3 Updated Metric Objects

```typescript
const optimization: Metric[] = [
  {
    name: "Savings Alpha",
    value: savingsAlpha,  // was: 12.5 (hardcoded)
    unit: "%", target: 10,
    status: evalStatus(savingsAlpha, 10, 5),
  },
  {
    name: "Self-Consumption",
    value: selfConsumptionPct,  // was: 87 (hardcoded)
    unit: "%", target: 80,
    status: evalStatus(selfConsumptionPct, 80, 60),
  },
  // PV Forecast MAPE and Load Forecast Adapt stay hardcoded
  { name: "PV Forecast MAPE", value: 8.2, unit: "%", target: 15, status: "pass" },
  { name: "Load Forecast Adapt", value: 92, unit: "%", target: 85, status: "pass" },
];
```

---

## 3. Code Changes — get-dashboard.ts

### 3.1 Revenue KPI — Switch to Tarifa Branca Savings

```typescript
// Query 2 (v5.13): Today's revenue → use client_savings as primary
queryWithOrg(
  `SELECT
     COALESCE(SUM(vpp_arbitrage_profit_reais), 0) AS vpp_profit,
     COALESCE(SUM(client_savings_reais), 0)        AS client_savings,
     COALESCE(SUM(client_savings_reais), 0)        AS legacy_profit
   FROM revenue_daily
   WHERE date = CURRENT_DATE`,
  [],
  rlsOrgId,
),

// Query 5 (v5.13): Monthly revenue → use client_savings
queryWithOrg(
  `SELECT COALESCE(SUM(client_savings_reais), 0) AS monthly_revenue
   FROM revenue_daily
   WHERE date >= date_trunc('month', CURRENT_DATE)`,
  [],
  rlsOrgId,
),
```

### 3.2 Self-Consumption — Switch to revenue_daily

```typescript
// Query 3 (v5.13): Self-consumption from revenue_daily instead of algorithm_metrics
queryWithOrg(
  `SELECT ROUND(AVG(actual_self_consumption_pct), 1) AS self_consumption_pct
   FROM revenue_daily
   WHERE date >= CURRENT_DATE - 7
     AND actual_self_consumption_pct IS NOT NULL`,
  [],
  rlsOrgId,
),
```

### 3.3 Gateway Uptime — De-hardcode

```typescript
// Query 8 (v5.13 NEW): Gateway uptime from daily_uptime_snapshots
queryWithOrg(
  `SELECT ROUND(AVG(uptime_pct), 1) AS gateway_uptime
   FROM daily_uptime_snapshots
   WHERE date >= CURRENT_DATE - 7`,
  [],
  rlsOrgId,
),

// ... in response body:
gatewayUptime: parseFloat(String(
  (uptimeResult.rows[0] as Record<string, unknown>)?.gateway_uptime ?? 99.9
)),  // was: 99.9 (hardcoded)
```

### 3.4 Revenue Breakdown — Labels Update

```typescript
revenueBreakdown: {
  values: [
    Math.round(Number(rev.client_savings)),  // was: vpp_profit
    Math.round(Number(rev.vpp_profit)),       // kept for transparency
    0,
  ],
  colors: ["#059669", "#3730a3", "#d97706"],
  labels: ["Tarifa Branca Savings", "VPP Arbitrage (Future)", "Other"],
},
```

**Note:** Response envelope `{ success: true, data: {...} }` is unchanged. Field names in `data` are unchanged. Only the values and their source change.

---

## 4. App Pool Isolation Constraints

All BFF handlers MUST follow these rules:

```
┌────────────────────────────────────────────────────┐
│                     BFF HANDLER                     │
│                                                     │
│  1. extractTenantContext(event)  → ctx.orgId         │
│  2. rlsOrgId = isAdmin ? null : ctx.orgId           │
│  3. queryWithOrg(sql, params, rlsOrgId)              │
│       │                                              │
│       ├── orgId provided → App Pool                  │
│       │     SET LOCAL app.current_org_id = orgId     │
│       │     RLS ENFORCED                             │
│       │                                              │
│       └── orgId null (ADMIN) → Service Pool          │
│             BYPASSRLS → sees all tenants             │
│                                                     │
│  4. NEVER import getServicePool() in BFF handlers   │
│  5. NEVER direct pool.query() — always queryWithOrg │
└────────────────────────────────────────────────────┘
```

### v5.13 Violation Check

| Handler | Pool Usage | Status |
|---------|-----------|--------|
| get-dashboard.ts | queryWithOrg() ×8 | COMPLIANT |
| get-performance-scorecard.ts | queryWithOrg() ×6 (was ×3) | COMPLIANT |
| get-revenue-trend.ts | queryWithOrg() ×1 | COMPLIANT (unchanged) |
| get-home-energy.ts | queryWithOrg() ×1 | COMPLIANT (unchanged) |
| get-performance-savings.ts | queryWithOrg() ×1 | COMPLIANT (unchanged) |

All 19 BFF endpoints remain App Pool compliant. No Service Pool imports in BFF handlers.

---

## 5. What Stays Hardcoded (v5.13 Out of Scope)

| Metric | Handler | Current Value | Why Out of Scope |
|--------|---------|--------------|-----------------|
| Commissioning Time | scorecard | 45 min | Needs commissioning workflow tracking |
| First Telemetry | scorecard | 5 min | Needs commissioning workflow tracking |
| PV Forecast MAPE | scorecard | 8.2% | Needs forecast-engine implementation (M2 v6.0) |
| Load Forecast Adapt | scorecard | 92% | Needs forecast-engine implementation (M2 v6.0) |
| Training Time | scorecard | 2 hrs | Operational metric — no data source |
| Manual Interventions | scorecard | 0 /week | Operational metric — no data source |
| App Uptime | scorecard | 99.9% | Needs health monitoring infrastructure |
| acPower, evCharge | home-energy | placeholder arrays | Needs per-device telemetry breakdown (AC/EV not yet telemetered) |

---

## 6. 代碼變更清單

| 檔案 | 動作 | 說明 |
|------|------|------|
| `bff/handlers/get-performance-scorecard.ts` | **MODIFY** | +2 queries (savings alpha, self-consumption); 2 metrics de-hardcoded |
| `bff/handlers/get-dashboard.ts` | **MODIFY** | Revenue KPI → client_savings; self-consumption → revenue_daily; gatewayUptime → daily_uptime_snapshots |
| `bff/handlers/get-revenue-trend.ts` | **unchanged** | Already reads revenue_daily (field values change via M4, not BFF) |
| `bff/handlers/get-home-energy.ts` | **unchanged** | acPower/evCharge stay placeholder (out of scope) |
| `bff/handlers/get-performance-savings.ts` | **unchanged** | Already reads revenue_daily.client_savings_reais |
| All other BFF handlers (14) | **unchanged** | No hardcoded values affected |

---

## 7. Frontend Impact Assessment

| Change | Frontend Impact | Action Required |
|--------|----------------|-----------------|
| Savings Alpha: 12.5 → real value | Value changes, format identical | None |
| Self-Consumption: 87 → real value | Value changes, format identical | None |
| dailyRevenueReais: PLD → Tarifa Branca | Value changes, field name same | None |
| monthlyRevenueReais: PLD → Tarifa Branca | Value changes, field name same | None |
| gatewayUptime: 99.9 → real value | Value changes, format identical | None |
| Revenue breakdown labels | Label text changes | **Minor** — label text rendered from API |
| Response envelope | `{ success, data, error }` unchanged | None |

**Conclusion: Frontend zero-change.** All field names, types, and response envelopes are identical to v5.12. Only the numeric values and label strings change.

---

## 8. 測試策略

| Test | Scope | Technique |
|------|-------|-----------|
| Savings Alpha query | Returns correct value from seeded revenue_daily + assets | Integration test with seed_v5.13.sql |
| Self-Consumption query | AVG of actual_self_consumption_pct | Integration test |
| Gateway uptime query | AVG of daily_uptime_snapshots.uptime_pct (7 days) | Integration test |
| Dashboard revenue | SUM(client_savings_reais) for current month | Integration test |
| App Pool enforcement | All queries go through queryWithOrg | Unit test: mock queryWithOrg, verify no direct pool.query |
| Response format | JSON shape matches v5.12 contract | Snapshot test |

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | 初始版本：BFF Gateway + 4 端點 |
| v5.3 | 2026-02-27 | HEMS 單戶控制端點 |
| v5.5 | 2026-02-28 | 雙層收益 KPI |
| v5.9 | 2026-03-02 | BFF 去硬編碼第一輪 |
| v5.10 | 2026-03-05 | Dashboard 7 queries de-hardcoded |
| v5.12 | 2026-03-05 | API Contract Alignment — 15 新端點、Gap Analysis、Frontend 整合 |
| **v5.13** | **2026-03-05** | **Block 2: Scorecard 2 metrics de-hardcoded (Savings Alpha → revenue_daily + tarifa formula, Self-Consumption → revenue_daily.actual_self_consumption_pct); Dashboard revenue KPI → Tarifa Branca client_savings; gatewayUptime → daily_uptime_snapshots; App Pool isolation verified for all 19 endpoints; frontend zero-change** |
