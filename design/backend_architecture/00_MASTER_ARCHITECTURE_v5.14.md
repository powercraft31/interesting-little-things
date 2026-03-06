# SOLFACIL VPP — Master Architecture Blueprint

> **模組版本**: v5.14
> **最後更新**: 2026-03-06
> **說明**: 系統總控藍圖 — 文件索引、系統定位、8大模組邊界、事件流、架構決策
> **核心主題**: Formula Overhaul & Deep Telemetry — 公式大修 (DP 最佳 TOU) + 9 新遙測欄位 + KPI 替換

---

## 文件索引表

| # | 文件名 | 路徑 | 說明 |
|---|--------|------|------|
| 00 | **MASTER_ARCHITECTURE** | `00_MASTER_ARCHITECTURE_v5.14.md` | 系統總控藍圖（本文件） |
| M1 | **IOT_HUB_MODULE** | [01_IOT_HUB_MODULE_v5.14.md](./01_IOT_HUB_MODULE_v5.14.md) | **v5.14: XuhengAdapter +9 battery fields + aggregator rollup expansion** |
| M2 | **OPTIMIZATION_ENGINE_MODULE** | [02_OPTIMIZATION_ENGINE_MODULE_v5.11.md](./02_OPTIMIZATION_ENGINE_MODULE_v5.11.md) | Optimization Engine — v5.11: Service Pool (unchanged) |
| M3 | **DR_DISPATCHER_MODULE** | [03_DR_DISPATCHER_MODULE_v5.11.md](./03_DR_DISPATCHER_MODULE_v5.11.md) | DR Dispatcher — v5.11: Service Pool (unchanged) |
| M4 | **MARKET_BILLING_MODULE** | [04_MARKET_BILLING_MODULE_v5.14.md](./04_MARKET_BILLING_MODULE_v5.14.md) | **v5.14: Post-hoc DP optimal TOU cost + baseline/actual/bestTou billing** |
| M5 | **BFF_MODULE** | [05_BFF_MODULE_v5.14.md](./05_BFF_MODULE_v5.14.md) | **v5.14: Savings Alpha → Actual Savings + Optimization Efficiency + Self-Sufficiency** |
| M6 | **IDENTITY_MODULE** | [06_IDENTITY_MODULE_v5.2.md](./06_IDENTITY_MODULE_v5.2.md) | Identity — Cognito、Multi-tenant、RBAC、SSO Federation |
| M7 | **OPEN_API_MODULE** | [07_OPEN_API_MODULE_v5.7.md](./07_OPEN_API_MODULE_v5.7.md) | Open API — M2M Gateway、Webhook、WAF、Rate Limiting |
| M8 | **ADMIN_CONTROL_MODULE** | [08_ADMIN_CONTROL_MODULE_v5.10.md](./08_ADMIN_CONTROL_MODULE_v5.10.md) | Admin Control Plane — 全局控制面、Data Dictionary、AppConfig |
| 09 | **SHARED_LAYER** | [09_SHARED_LAYER_v5.14.md](./09_SHARED_LAYER_v5.14.md) | **v5.14: DP calculateBestTouCost + formula overhaul (delete 2, add 4)** |
| 10 | **DATABASE_SCHEMA** | [10_DATABASE_SCHEMA_v5.14.md](./10_DATABASE_SCHEMA_v5.14.md) | **v5.14: 4 tables altered (telemetry_history, asset_hourly_metrics, revenue_daily, assets)** |
| 11 | **INTEGRATION_PLAN (v5.10)** | [11_v5.10_INTEGRATION_PLAN.md](./11_v5.10_INTEGRATION_PLAN.md) | v5.10 具體實施任務清單 |
| 12 | **DUAL_POOL_PLAN (v5.11)** | [12_v5.11_DUAL_POOL_PLAN.md](./12_v5.11_DUAL_POOL_PLAN.md) | v5.11 具體實施任務清單 |

---

## 1. 系統定位

（與 v5.13 相同，不重複。參見 `00_MASTER_ARCHITECTURE_v5.13.md` §1。）

> **v5.14 升版說明（2026-03-06）**
>
> **核心主題：Formula Overhaul & Deep Telemetry**
>
> v5.14 addresses formula defects discovered in v5.13 audit and fills telemetry gaps:
>
> **Block 1 — Deep Telemetry (M1 XuhengAdapter):**
> XuhengAdapter currently parses only 4 `bat.properties` fields. 9 additional fields
> (SoH, voltage, current, temperature, charge/discharge limits, cumulative energy)
> are available from the BMS but ignored. v5.14 parses all 9 and writes them to
> `telemetry_history` / `asset_hourly_metrics`.
>
> **Block 2 — Formula Overhaul (M4/M5/Shared):**
> v5.13's `calculateDailySavings` and `calculateOptimizationAlpha` have structural defects:
> - `calculateDailySavings` assumes all charging costs off-peak, regardless of actual source
> - `calculateOptimizationAlpha`'s theoretical max (1 cycle/day) is arbitrary
>
> These are replaced with three deterministic, physically correct metrics:
> - **Baseline Cost**: what electricity would cost with no PV + no battery
> - **Actual Cost**: what grid import actually cost
> - **Best TOU Cost**: post-hoc DP-optimal battery schedule (provably minimal grid cost)
>
> From these three numbers, two clean percentages derive:
> - Actual Savings % = (baseline - actual) / baseline
> - Optimization Efficiency % = (baseline - actual) / (baseline - bestTou)
>
> Plus Self-Sufficiency % = (load - gridImport) / load, a new KPI.
>
> **v5.14 Scope:**
> - M1 IoT Hub: v5.13 → v5.14 (XuhengAdapter +9 fields, aggregator new rollup rules)
> - M4 Market & Billing: v5.13 → v5.14 (DP algorithm, baseline/actual/bestTou billing)
> - M5 BFF: v5.13 → v5.14 (Scorecard KPI replacement, Dashboard self-sufficiency)
> - Shared Layer: v5.13 → v5.14 (delete 2 functions, add 4 functions incl. DP)
> - Database Schema: v5.13 → v5.14 (4 tables altered, 0 new tables)
>
> **v5.14 Out of Scope（明確排除）：**
> - Load/PV forecasting (v6.0)
> - Forward-looking schedule optimization (v6.0 — same DP, predicted inputs)
> - ROI calculation (needs `installation_cost_reais` populated)
> - SoH trend analysis (needs sustained data collection)
> - Battery internal resistance analysis (needs voltage + current history)
> - Frontend code changes (zero-change — BFF response envelope identical)

### Technology Stack

（與 v5.13 相同，不重複。）

### Core Design Principles

（與 v5.13 相同，不重複。）

---

## 2. 最高架構憲法：接口契約鎖定與變更法則 (API Contract Governance)

（與 v5.13 相同，不重複。參見 `00_MASTER_ARCHITECTURE_v5.13.md` §2。）

---

## 3. 8 大模組邊界與職責

### Module Responsibility Matrix

（與 v5.13 相同，不重複。）

### 模組版本號矩陣

| 模組 ID | 模組名稱 | 當前版本 | 文件 | 主要技術 |
|---------|---------|---------|------|---------|
| Shared | Shared Layer | **v5.14** | [09_SHARED_LAYER](./09_SHARED_LAYER_v5.14.md) | 公共型別、Dual Pool Factory、**DP BestTouCost + formula overhaul** |
| Shared | Database Schema | **v5.14** | [10_DATABASE_SCHEMA](./10_DATABASE_SCHEMA_v5.14.md) | PostgreSQL — **24 張表**、telemetry_history +4 cols、asset_hourly_metrics +3 cols、revenue_daily +4 cols、assets +4 cols |
| M1 | IoT Hub | **v5.14** | [01_IOT_HUB](./01_IOT_HUB_MODULE_v5.14.md) | Lambda + IoT Core + MQTT Subscriber + **XuhengAdapter +9 bat.properties** + Service Pool |
| M2 | Optimization Engine | v5.11 | [02_OPTIMIZATION_ENGINE](./02_OPTIMIZATION_ENGINE_MODULE_v5.11.md) | Lambda + AppConfig + Service Pool |
| M3 | DR Dispatcher | v5.11 | [03_DR_DISPATCHER](./03_DR_DISPATCHER_MODULE_v5.11.md) | Lambda + EventBridge + MQTT + Service Pool |
| M4 | Market & Billing | **v5.14** | [04_MARKET_BILLING](./04_MARKET_BILLING_MODULE_v5.14.md) | Lambda + **DP optimal TOU + baseline/actual/bestTou** + Service Pool |
| M5 | BFF | **v5.14** | [05_BFF](./05_BFF_MODULE_v5.14.md) | Lambda + API Gateway — **Actual Savings + Optimization Efficiency + Self-Sufficiency** |
| M6 | Identity | v5.2 | [06_IDENTITY](./06_IDENTITY_MODULE_v5.2.md) | Lambda + Cognito |
| M7 | Open API | v5.7 | [07_OPEN_API](./07_OPEN_API_MODULE_v5.7.md) | Lambda + API Gateway |
| M8 | Admin Control | v5.10 | [08_ADMIN_CONTROL](./08_ADMIN_CONTROL_MODULE_v5.10.md) | Lambda + DynamoDB + AppConfig |

> **v5.14 升版說明（2026-03-06）**
> 觸發原因：Formula audit revealed structural defects in savings/alpha calculations; telemetry audit found 9 unparsed BMS fields.
> 依據 §2「最高架構憲法」：
> - M1 v5.13 → v5.14, M4 v5.13 → v5.14, M5 v5.13 → v5.14
> - Shared Layer v5.13 → v5.14, Database Schema v5.13 → v5.14
> - M2, M3, M6, M7, M8 版本不變（不受此變更影響）

---

## 4. EventBus 核心事件流

（與 v5.13 相同，不重複。參見 `00_MASTER_ARCHITECTURE_v5.13.md` §4。）

---

## 5. 跨模組通訊機制

### Inter-Module Communication Flow（v5.14 更新）

```
M1 (IoT Hub)          --publishes-->  TelemetryReceived, DeviceStatusChanged, AlertTriggered
                       --writes   -->  asset_hourly_metrics (v5.14: +3 avg battery cols)
                       --writes   -->  telemetry_history (v5.14: +4 battery cols)
                       --writes   -->  device_state, ems_health (unchanged)
                       --subscribes->  MQTT xuheng/+/+/data (v5.13 — unchanged)
                       --uses     -->  service pool (unchanged)
M2 (Algorithm Engine)  --publishes-->  ScheduleGenerated, ForecastUpdated
                       --reads    -->  device_state, vpp_strategies
                       --uses     -->  service pool (v5.11)
M3 (DR Dispatcher)     --publishes-->  DRDispatchCompleted, AssetModeChanged
                       --uses     -->  service pool + app pool (v5.11)
M4 (Market & Billing)  --publishes-->  ProfitCalculated, InvoiceGenerated, TariffUpdated
                       --reads    -->  asset_hourly_metrics (v5.14: load + PV + grid for DP)
                       --reads    -->  tariff_schedules (Tarifa Branca rates)
                       --reads    -->  assets (v5.14: capacity + soc_min_pct + charge/discharge rates)
                       --computes -->  shared/tarifa.ts (v5.14: calculateBaselineCost, calculateActualCost, calculateBestTouCost, calculateSelfSufficiency)
                       --uses     -->  service pool (v5.11)
M5 (BFF)               --publishes-->  DRCommandIssued
                       --reads    -->  revenue_daily (v5.14: baseline_cost + actual_cost + best_tou_cost + self_sufficiency_pct)
                       --reads    -->  daily_uptime_snapshots (unchanged)
                       --computes -->  percentage formulas from revenue_daily columns
                       --uses     -->  app pool + queryWithOrg (unchanged)
                       --exposes  -->  19 GET/POST endpoints (unchanged from v5.12)
M6 (IAM)               --publishes-->  OrgProvisioned, UserCreated
M7 (Open API)          --consumes -->  DRDispatchCompleted, InvoiceGenerated -> webhook delivery
M8 (Admin Control)     --publishes-->  ConfigUpdated, SchemaEvolved
```

### v5.14 Data Flow Diagram

```
                      MQTT Broker (EMQX)
                           |
                           | xuheng/+/+/data
                           v
                  +---------------------+
                  |  M1: mqtt-subscriber | (v5.13 — unchanged)
                  |   +- XuhengAdapter   | <-- v5.14: +9 bat.properties parsed
                  |   +- MessageBuffer   | <-- v5.14: writes 4 new columns
                  |   +- DeviceAssetCache|
                  +------+----------+----+
                         | Service Pool
           +-------------+-------------+
           v             v             v
    telemetry_history  device_state  ems_health
    (+4 new cols)                     (unchanged)
           |
           | hourly cron (:05)
           v
  +---------------------------+
  |  M1: telemetry-aggregator | <-- v5.14: +3 avg battery cols
  |   existing 8 + 3 new cols |
  +----------+----------------+
             | Service Pool
             v
    asset_hourly_metrics (expanded)
             |
    +--------+-------------------+
    |                            |
    v                            v
+----------------+  +---------------------+
| M4: billing    |  | M5: BFF (19 endpts) |
| DP bestTouCost |  | App Pool + RLS      |
| baseline/actual|  | queryWithOrg()      |
+------+---------+  +----------+----------+
       | Service Pool          | App Pool
       v                       v
  revenue_daily ---------> frontend-v2
  (+4 new cols)            (zero change)
```

### Pool Assignment Rule (unchanged from v5.11)

| Pool | Role | RLS | Used By |
|------|------|-----|---------|
| **App Pool** (`getAppPool()`) | `solfacil_app` | Enforced — must set `app.current_org_id` | BFF handlers (via `queryWithOrg`), ACK endpoint |
| **Service Pool** (`getServicePool()`) | `solfacil_service` | Bypassed (`BYPASSRLS`) | M1 mqtt-subscriber, M1 aggregator, M2/M3/M4 cron jobs |

---

## 6. v5.14 Database Changes Summary

### New Tables (0)

No new tables in v5.14. Total remains **24 tables**.

### Altered Tables (4)

| Table | Change | Purpose |
|-------|--------|---------|
| `telemetry_history` | +4 columns: `battery_soh`, `battery_voltage`, `battery_current`, `battery_temperature` | Deep BMS telemetry capture |
| `asset_hourly_metrics` | +3 columns: `avg_battery_soh`, `avg_battery_voltage`, `avg_battery_temperature` | Hourly rollup of BMS physical state |
| `revenue_daily` | +4 columns: `baseline_cost_reais`, `actual_cost_reais`, `best_tou_cost_reais`, `self_sufficiency_pct` | DP billing output + new KPI |
| `assets` | +4 columns: `installation_cost_reais`, `soc_min_pct`, `max_charge_rate_kw`, `max_discharge_rate_kw` | DP parameters + ROI readiness |

### Total Table Count: **24 tables** (unchanged)

Full DDL documented in [10_DATABASE_SCHEMA_v5.14.md](./10_DATABASE_SCHEMA_v5.14.md).

---

## 7. v5.14 Module Impact Map

| Module | Block | Files Changed | Impact Level |
|--------|-------|--------------|-------------|
| **Shared Layer** | Block 2 | 2 modified (`tarifa.ts` — delete 2 + add 4 functions; `types/telemetry.ts` — +9 fields) | Foundation |
| **Database** | Both | `migration_v5.14.sql` + `seed_v5.14.sql` | Foundation |
| **M1 IoT Hub** | Block 1 | 2 modified (`XuhengAdapter.ts` +9 fields, `telemetry-aggregator.ts` +3 rollup cols) | Primary |
| **M4 Market & Billing** | Block 2 | 1 modified (`daily-billing-job.ts` — DP + baseline/actual/bestTou) | Primary |
| **M5 BFF** | Block 2 | 2 modified (`get-performance-scorecard.ts`, `get-dashboard.ts` — KPI replacement) | Secondary |
| M2 Optimization | — | 0 | None |
| M3 DR Dispatcher | — | 0 | None |
| M6 Identity | — | 0 | None |
| M7 Open API | — | 0 | None |
| M8 Admin Control | — | 0 | None |
| Frontend | — | 0 | **Zero change** |

### Implementation Order

```
Phase 0 (Foundation):  migration_v5.14.sql -> seed_v5.14.sql -> shared/types/telemetry.ts (expand) -> shared/tarifa.ts (overhaul)
Phase 1 (Block 1):    XuhengAdapter (+9 fields) -> message-buffer.ts (write new cols) -> telemetry-aggregator (+3 rollup cols)
Phase 2 (Block 2):    daily-billing-job.ts (DP + new columns) -> get-performance-scorecard.ts -> get-dashboard.ts
Phase 3 (Validation): Run full test suite -> verify 266+ existing tests still pass -> add new tests
```

---

## 8. Version Delta Summary: v5.13 -> v5.14

| Aspect | v5.13 | v5.14 |
|--------|-------|-------|
| XuhengAdapter bat.properties | 4 fields (soc, power, dailyCharge, dailyDischarge) | 13 fields (+soh, voltage, current, temperature, charge/discharge limits, cumulative energy) |
| Aggregator battery rollup | 2 (avg_soc, peak_power) | 5 (+avg_soh, avg_voltage, avg_temperature) |
| Savings formula | `calculateDailySavings` (charge cost assumes off-peak) | `calculateBaselineCost` + `calculateActualCost` (deterministic) |
| Optimization metric | `calculateOptimizationAlpha` (theoretical max = 1 cycle/day) | `calculateBestTouCost` (DP post-hoc optimal) -> Optimization Efficiency % |
| Self-Sufficiency KPI | Not tracked | `calculateSelfSufficiency` = (load - gridImport) / load |
| Scorecard: "Savings Alpha" | Single % (flawed theoretical max) | Replaced by "Actual Savings %" + "Optimization Efficiency %" |
| revenue_daily columns | client_savings_reais, actual_self_consumption_pct | +baseline_cost_reais, +actual_cost_reais, +best_tou_cost_reais, +self_sufficiency_pct |
| assets columns | capacity_kwh | +soc_min_pct, +max_charge_rate_kw, +max_discharge_rate_kw, +installation_cost_reais |
| telemetry_history columns | battery_soc, battery_power | +battery_soh, +battery_voltage, +battery_current, +battery_temperature |
| DB tables | 24 | 24 (unchanged) |
| DB altered tables | 0 | 4 |
| BFF endpoints | 19 | 19 (unchanged count, upgraded KPI payloads) |
| Frontend changes | 0 | 0 |
| Shared pure functions | 5 (classifyHour, getRateForHour, calculateDailySavings, calculateOptimizationAlpha, calculateSelfConsumption) | 7 (classifyHour, getRateForHour, calculateSelfConsumption **kept**; calculateDailySavings, calculateOptimizationAlpha **deleted**; calculateBaselineCost, calculateActualCost, calculateBestTouCost, calculateSelfSufficiency **added**) |

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | 初始版本：8 大模組邊界、EventBus 事件流、架構憲法 |
| v5.3 | 2026-02-27 | HEMS 單戶場景連鎖升版 |
| v5.4 | 2026-02-27 | PostgreSQL 全面取代 DynamoDB/Timestream |
| v5.5 | 2026-02-28 | 雙層經濟模型連鎖升版 |
| v5.6 | 2026-02-28 | 系統心跳與內部管線自動化 |
| v5.7 | 2026-02-28 | 外部感知與 M7 雙向化 |
| v5.8 | 2026-03-02 | 遙測閉環與 Data Contract |
| v5.9 | 2026-03-02 | 邏輯閉環與去硬編碼 |
| v5.10 | 2026-03-05 | 三維修正：DB Bootstrap Fix + Architecture Boundary Fix + BFF De-hardcoding |
| v5.11 | 2026-03-05 | Dual Connection Pool: 代碼層實現雙角色 DB 架構 |
| v5.12 | 2026-03-05 | API Contract Alignment & BFF Expansion: 15 新端點、Gap Analysis、Frontend 整合 |
| v5.13 | 2026-03-05 | Data Pipeline & Deterministic Math: MQTT subscriber + aggregator expansion + Tarifa Branca savings formulas |
| **v5.14** | **2026-03-06** | **Formula Overhaul & Deep Telemetry: Block 1 — XuhengAdapter +9 bat.properties (SoH, voltage, current, temperature, charge/discharge limits, cumulative energy) + aggregator +3 avg battery columns; Block 2 — delete calculateDailySavings/calculateOptimizationAlpha, add calculateBaselineCost/calculateActualCost/calculateBestTouCost(DP)/calculateSelfSufficiency; M4 billing writes baseline_cost + actual_cost + best_tou_cost + self_sufficiency_pct; M5 BFF replaces Savings Alpha with Actual Savings % + Optimization Efficiency % + Self-Sufficiency %; 4 tables altered, 0 new; frontend zero-change** |
