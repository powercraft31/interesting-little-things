# SOLFACIL VPP — Master Architecture Blueprint

> **模組版本**: v5.13
> **最後更新**: 2026-03-05
> **說明**: 系統總控藍圖 — 文件索引、系統定位、8大模組邊界、事件流、架構決策
> **核心主題**: Data Pipeline & Deterministic Math — Block 1 MQTT subscriber (M1) + Block 2 Tarifa Branca C-side savings (M4/M5)

---

## 文件索引表

| # | 文件名 | 路徑 | 說明 |
|---|--------|------|------|
| 00 | **MASTER_ARCHITECTURE** | `00_MASTER_ARCHITECTURE_v5.13.md` | 系統總控藍圖（本文件） |
| M1 | **IOT_HUB_MODULE** | [01_IOT_HUB_MODULE_v5.13.md](./01_IOT_HUB_MODULE_v5.13.md) | **v5.13: MQTT subscriber + XuhengAdapter + aggregator expansion** |
| M2 | **OPTIMIZATION_ENGINE_MODULE** | [02_OPTIMIZATION_ENGINE_MODULE_v5.11.md](./02_OPTIMIZATION_ENGINE_MODULE_v5.11.md) | Optimization Engine — v5.11: Service Pool (unchanged) |
| M3 | **DR_DISPATCHER_MODULE** | [03_DR_DISPATCHER_MODULE_v5.11.md](./03_DR_DISPATCHER_MODULE_v5.11.md) | DR Dispatcher — v5.11: Service Pool (unchanged) |
| M4 | **MARKET_BILLING_MODULE** | [04_MARKET_BILLING_MODULE_v5.13.md](./04_MARKET_BILLING_MODULE_v5.13.md) | **v5.13: Tarifa Branca C-side savings + Optimization Alpha** |
| M5 | **BFF_MODULE** | [05_BFF_MODULE_v5.13.md](./05_BFF_MODULE_v5.13.md) | **v5.13: Scorecard + Dashboard de-hardcoding with real SQL** |
| M6 | **IDENTITY_MODULE** | [06_IDENTITY_MODULE_v5.2.md](./06_IDENTITY_MODULE_v5.2.md) | Identity — Cognito、Multi-tenant、RBAC、SSO Federation |
| M7 | **OPEN_API_MODULE** | [07_OPEN_API_MODULE_v5.7.md](./07_OPEN_API_MODULE_v5.7.md) | Open API — M2M Gateway、Webhook、WAF、Rate Limiting |
| M8 | **ADMIN_CONTROL_MODULE** | [08_ADMIN_CONTROL_MODULE_v5.10.md](./08_ADMIN_CONTROL_MODULE_v5.10.md) | Admin Control Plane — 全局控制面、Data Dictionary、AppConfig |
| 09 | **SHARED_LAYER** | [09_SHARED_LAYER_v5.13.md](./09_SHARED_LAYER_v5.13.md) | **v5.13: Telemetry types + Tarifa Branca pure functions** |
| 10 | **DATABASE_SCHEMA** | [10_DATABASE_SCHEMA_v5.13.md](./10_DATABASE_SCHEMA_v5.13.md) | **v5.13: asset_hourly_metrics +6 columns + ems_health table** |
| 11 | **INTEGRATION_PLAN (v5.10)** | [11_v5.10_INTEGRATION_PLAN.md](./11_v5.10_INTEGRATION_PLAN.md) | v5.10 具體實施任務清單 |
| 12 | **DUAL_POOL_PLAN (v5.11)** | [12_v5.11_DUAL_POOL_PLAN.md](./12_v5.11_DUAL_POOL_PLAN.md) | v5.11 具體實施任務清單 |

---

## 1. 系統定位

（與 v5.12 相同，不重複。參見 `00_MASTER_ARCHITECTURE_v5.12.md` §1。）

> **v5.13 升版說明（2026-03-05）**
>
> **核心主題：Data Pipeline & Deterministic Math**
>
> v5.13 has two independent blocks:
>
> **Block 1 — Data Pipeline (M1 MQTT Adapter):**
> Xuheng EMS hardware sends energy telemetry via MQTT (topic `xuheng/+/+/data` on EMQX broker).
> A new `mqtt-subscriber.ts` in M1 IoT Hub subscribes, parses MSG#4 via XuhengAdapter,
> and writes to `telemetry_history` + `device_state` + `ems_health` using Service Pool.
> Patterns ported from Phase 1 MQTT Bridge (commit `00a6133`): XuhengAdapter, DeviceAssetCache,
> MessageBuffer (2s debounce).
>
> **Block 2 — Deterministic Math (M4/M5 Tarifa Branca):**
> Replace hardcoded/placeholder revenue calculations with deterministic Tarifa Branca C-side
> savings formulas. The aggregator is expanded to compute PV, grid, load, and SOC metrics.
> M4 billing uses hour-level tariff rates. M5 BFF de-hardcodes Savings Alpha,
> Self-Consumption, and gateway uptime.
>
> **Critical business distinction:**
> Today's "arbitrage" = Tarifa Branca C-side electricity bill savings (ANEEL retail rates),
> NOT CCEE PLD wholesale market arbitrage. PLD is kept as future-proofing (2028+).
>
> **v5.13 Scope:**
> - M1 IoT Hub: v5.11 → v5.13 (MQTT subscriber + XuhengAdapter + aggregator expansion)
> - M4 Market & Billing: v5.11 → v5.13 (Tarifa Branca savings formulas)
> - M5 BFF: v5.12 → v5.13 (scorecard + dashboard de-hardcoding)
> - Shared Layer: v5.11 → v5.13 (telemetry types + tarifa pure functions)
> - Database Schema: v5.11 → v5.13 (asset_hourly_metrics ALTER + ems_health CREATE)
>
> **v5.13 Out of Scope（明確排除）：**
> - Actual live MQTT subscription to production broker (v6.0 — this version designs + implements the code, but live connection is v6.0)
> - CCEE PLD wholesale arbitrage profit (regulation not ready, 2028+)
> - PV/Load forecast engine (M2 v6.0)
> - DR subsidy revenue (ANEEL DR framework not finalized)
> - Schedule Optimization Score (needs real M2 greedy algorithm)
> - AWS IoT migration (future — `ingest-telemetry.ts` stays untouched)
> - Frontend code changes (zero-change — BFF response format identical to v5.12)

### Technology Stack

（與 v5.12 相同，不重複。）

### Core Design Principles

（與 v5.12 相同，不重複。）

---

## 2. 最高架構憲法：接口契約鎖定與變更法則 (API Contract Governance)

（與 v5.12 相同，不重複。參見 `00_MASTER_ARCHITECTURE_v5.12.md` §2。）

---

## 3. 8 大模組邊界與職責

### Module Responsibility Matrix

（與 v5.12 相同，不重複。）

### 模組版本號矩陣

| 模組 ID | 模組名稱 | 當前版本 | 文件 | 主要技術 |
|---------|---------|---------|------|---------|
| Shared | Shared Layer | **v5.13** | [09_SHARED_LAYER](./09_SHARED_LAYER_v5.13.md) | 公共型別、Dual Pool Factory、**XuhengTelemetry types + Tarifa Branca pure functions** |
| Shared | Database Schema | **v5.13** | [10_DATABASE_SCHEMA](./10_DATABASE_SCHEMA_v5.13.md) | PostgreSQL — **24 張表**、asset_hourly_metrics +6 cols、ems_health NEW |
| M1 | IoT Hub | **v5.13** | [01_IOT_HUB](./01_IOT_HUB_MODULE_v5.13.md) | Lambda + IoT Core + **MQTT Subscriber + XuhengAdapter** + Service Pool |
| M2 | Optimization Engine | v5.11 | [02_OPTIMIZATION_ENGINE](./02_OPTIMIZATION_ENGINE_MODULE_v5.11.md) | Lambda + AppConfig + Service Pool |
| M3 | DR Dispatcher | v5.11 | [03_DR_DISPATCHER](./03_DR_DISPATCHER_MODULE_v5.11.md) | Lambda + EventBridge + MQTT + Service Pool |
| M4 | Market & Billing | **v5.13** | [04_MARKET_BILLING](./04_MARKET_BILLING_MODULE_v5.13.md) | Lambda + **Tarifa Branca C-side savings + Optimization Alpha** + Service Pool |
| M5 | BFF | **v5.13** | [05_BFF](./05_BFF_MODULE_v5.13.md) | Lambda + API Gateway — **Scorecard + Dashboard de-hardcoding** |
| M6 | Identity | v5.2 | [06_IDENTITY](./06_IDENTITY_MODULE_v5.2.md) | Lambda + Cognito |
| M7 | Open API | v5.7 | [07_OPEN_API](./07_OPEN_API_MODULE_v5.7.md) | Lambda + API Gateway |
| M8 | Admin Control | v5.10 | [08_ADMIN_CONTROL](./08_ADMIN_CONTROL_MODULE_v5.10.md) | Lambda + DynamoDB + AppConfig |

> **v5.13 升版說明（2026-03-05）**
> 觸發原因：Two blocks — (1) MQTT data pipeline for Xuheng EMS, (2) Deterministic Tarifa Branca savings replacing placeholder calculations.
> 依據 §2「最高架構憲法」：
> - M1 v5.11 → v5.13, M4 v5.11 → v5.13, M5 v5.12 → v5.13
> - Shared Layer v5.11 → v5.13, Database Schema v5.11 → v5.13
> - M2, M3, M6, M7, M8 版本不變（不受此變更影響）

---

## 4. EventBus 核心事件流

（與 v5.12 相同，不重複。參見 `00_MASTER_ARCHITECTURE_v5.12.md` §4。）

---

## 5. 跨模組通訊機制

### Inter-Module Communication Flow（v5.13 更新）

```
M1 (IoT Hub)          --publishes-->  TelemetryReceived, DeviceStatusChanged, AlertTriggered
                       --writes   -->  asset_hourly_metrics (Data Contract, v5.8 + v5.13 expansion)
                       --writes   -->  telemetry_history, device_state (existing)
                       --writes   -->  ems_health (v5.13 NEW)
                       --subscribes->  MQTT xuheng/+/+/data (v5.13 NEW)
                       --uses     -->  service pool (mqtt-subscriber + telemetry-aggregator, v5.11)
M2 (Algorithm Engine)  --publishes-->  ScheduleGenerated, ForecastUpdated
                       --reads    -->  device_state, vpp_strategies
                       --uses     -->  service pool (v5.11)
M3 (DR Dispatcher)     --publishes-->  DRDispatchCompleted, AssetModeChanged
                       --uses     -->  service pool + app pool (v5.11)
M4 (Market & Billing)  --publishes-->  ProfitCalculated, InvoiceGenerated, TariffUpdated
                       --reads    -->  asset_hourly_metrics (v5.13: +6 columns)
                       --reads    -->  tariff_schedules (v5.13: Tarifa Branca rates)
                       --reads    -->  assets (capacity_kwh for Alpha)
                       --computes -->  shared/tarifa.ts pure functions (v5.13 NEW)
                       --uses     -->  service pool (v5.11)
M5 (BFF)               --publishes-->  DRCommandIssued
                       --reads    -->  revenue_daily (v5.13: client_savings + self_consumption)
                       --reads    -->  daily_uptime_snapshots (v5.13: gateway uptime)
                       --reads    -->  tariff_schedules (v5.13: for Savings Alpha)
                       --computes -->  shared/tarifa.ts (v5.13: calculateOptimizationAlpha)
                       --uses     -->  app pool + queryWithOrg (v5.11: unchanged)
                       --exposes  -->  19 GET/POST endpoints (unchanged from v5.12)
M6 (IAM)               --publishes-->  OrgProvisioned, UserCreated
M7 (Open API)          --consumes -->  DRDispatchCompleted, InvoiceGenerated -> webhook delivery
M8 (Admin Control)     --publishes-->  ConfigUpdated, SchemaEvolved
```

### v5.13 Data Flow Diagram

```
                      MQTT Broker (EMQX)
                           │
                           │ xuheng/+/+/data
                           ▼
                  ┌─────────────────────┐
                  │  M1: mqtt-subscriber │ ← NEW (Block 1)
                  │   └─ XuhengAdapter   │
                  │   └─ MessageBuffer   │
                  │   └─ DeviceAssetCache│
                  └──────┬──────────────┘
                         │ Service Pool
           ┌─────────────┼─────────────┐
           ▼             ▼             ▼
    telemetry_history  device_state  ems_health
           │                           (NEW)
           │ hourly cron (:05)
           ▼
  ┌───────────────────────────┐
  │  M1: telemetry-aggregator │ ← ENHANCED (Block 1)
  │   +6 columns: PV, grid,  │
  │    load, SOC, peak_power  │
  └──────────┬────────────────┘
             │ Service Pool
             ▼
    asset_hourly_metrics (expanded)
             │
    ┌────────┴────────────┐
    │                     │
    ▼                     ▼
┌──────────────┐  ┌──────────────────────┐
│ M4: billing  │  │ M5: BFF (19 endpoints)│
│ Tarifa Branca│  │  App Pool + RLS       │
│ savings calc │  │  queryWithOrg()       │
└──────┬───────┘  └──────────┬────────────┘
       │ Service Pool        │ App Pool
       ▼                     ▼
  revenue_daily ──────── frontend-v2
  (fully populated)     (zero change)
```

### Pool Assignment Rule (unchanged from v5.11)

| Pool | Role | RLS | Used By |
|------|------|-----|---------|
| **App Pool** (`getAppPool()`) | `solfacil_app` | Enforced — must set `app.current_org_id` | BFF handlers (via `queryWithOrg`), ACK endpoint |
| **Service Pool** (`getServicePool()`) | `solfacil_service` | Bypassed (`BYPASSRLS`) | M1 mqtt-subscriber, M1 aggregator, M2/M3/M4 cron jobs |

---

## 6. v5.13 Database Changes Summary

### New Tables (1)

| Table | Purpose | RLS | Module |
|-------|---------|-----|--------|
| `ems_health` | EMS hardware status (firmware, WiFi, uptime, errors) | No (scoped via asset_id FK) | M1 |

### Altered Tables (1)

| Table | Change | Purpose |
|-------|--------|---------|
| `asset_hourly_metrics` | +6 columns: `pv_generation_kwh`, `grid_import_kwh`, `grid_export_kwh`, `load_consumption_kwh`, `avg_battery_soc`, `peak_battery_power_kw` | Full energy aggregation for Tarifa Branca savings + self-consumption |

### New Partition (1)

| Table | Partition | Range |
|-------|-----------|-------|
| `telemetry_history` | `telemetry_history_2026_04` | 2026-04-01 to 2026-05-01 |

### Total Table Count: 23 existing + 1 new = **24 tables**

Full DDL documented in [10_DATABASE_SCHEMA_v5.13.md](./10_DATABASE_SCHEMA_v5.13.md).

---

## 7. v5.13 Module Impact Map

| Module | Block | Files Changed | Impact Level |
|--------|-------|--------------|-------------|
| **Shared Layer** | Both | +2 new files (`types/telemetry.ts`, `tarifa.ts`) | Foundation |
| **Database** | Both | `migration_v5.13.sql` + `seed_v5.13.sql` | Foundation |
| **M1 IoT Hub** | Block 1 | +4 new files, 1 modified (`mqtt-subscriber`, `XuhengAdapter`, `DeviceAssetCache`, `MessageBuffer`, `telemetry-aggregator`) | Primary |
| **M4 Market & Billing** | Block 2 | 1 modified (`daily-billing-job.ts`) | Primary |
| **M5 BFF** | Block 2 | 2 modified (`get-performance-scorecard.ts`, `get-dashboard.ts`) | Secondary |
| M2 Optimization | — | 0 | None |
| M3 DR Dispatcher | — | 0 | None |
| M6 Identity | — | 0 | None |
| M7 Open API | — | 0 | None |
| M8 Admin Control | — | 0 | None |
| Frontend | — | 0 | **Zero change** |

### Implementation Order

```
Phase 0 (Foundation):  migration_v5.13.sql → seed_v5.13.sql → shared/types/telemetry.ts → shared/tarifa.ts
Phase 1 (Block 1):    XuhengAdapter → DeviceAssetCache → MessageBuffer → mqtt-subscriber → telemetry-aggregator expansion
Phase 2 (Block 2):    daily-billing-job.ts → get-performance-scorecard.ts → get-dashboard.ts
Phase 3 (Validation): Run full test suite → verify 225+ existing tests still pass → add new tests
```

---

## 8. Version Delta Summary: v5.12 → v5.13

| Aspect | v5.12 | v5.13 |
|--------|-------|-------|
| MQTT ingestion | None (HTTP webhook only) | MQTT subscriber + XuhengAdapter |
| Aggregator columns | 2 (charge, discharge) | 8 (+PV, grid_import, grid_export, load, avg_soc, peak_power) |
| Revenue calculation | PLD wholesale × discharge | Tarifa Branca hour-level C-side savings |
| Savings Alpha | Hardcoded 12.5% | Calculated from revenue_daily + assets + tariff_schedules |
| Self-Consumption | Hardcoded 87% (scorecard) / algorithm_metrics (dashboard) | Calculated from PV − grid_export |
| Gateway Uptime | Hardcoded 99.9% | daily_uptime_snapshots AVG |
| ems_health tracking | None | New table, UPSERT from MSG#0 |
| DB tables | 23 | 24 (+ems_health) |
| DB columns (asset_hourly_metrics) | 7 | 13 (+6) |
| BFF endpoints | 19 | 19 (unchanged count, upgraded data sources) |
| Frontend changes | 0 | 0 |
| Shared pure functions | 0 | 5 (classifyHour, getRateForHour, calculateDailySavings, calculateOptimizationAlpha, calculateSelfConsumption) |

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
| **v5.13** | **2026-03-05** | **Data Pipeline & Deterministic Math: Block 1 — MQTT subscriber (XuhengAdapter, DeviceAssetCache, MessageBuffer ported from Phase 1 commit 00a6133) + aggregator +6 columns + ems_health table; Block 2 — Tarifa Branca C-side savings formulas (shared/tarifa.ts pure functions) + M4 billing upgrade (hour-level rates from tariff_schedules) + M5 BFF de-hardcoding (Savings Alpha, Self-Consumption, gateway uptime); DB 23→24 tables; frontend zero-change** |
