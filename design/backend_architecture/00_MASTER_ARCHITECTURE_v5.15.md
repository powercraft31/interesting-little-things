# SOLFACIL VPP -- Master Architecture Blueprint

> **Module Version**: v5.15
> **Last Updated**: 2026-03-07
> **Description**: System master blueprint -- document index, system positioning, 8 module boundaries, event flow, architecture decisions
> **Core Theme**: SC/TOU Attribution & 5-min Telemetry -- real savings attribution from dispatch mode tracking + 5-min partitioned telemetry

---

## Document Index

| # | Document | Path | Description |
|---|----------|------|-------------|
| 00 | **MASTER_ARCHITECTURE** | `00_MASTER_ARCHITECTURE_v5.15.md` | System master blueprint (this document) |
| M1 | **IOT_HUB_MODULE** | [01_IOT_HUB_MODULE_v5.15.md](./01_IOT_HUB_MODULE_v5.15.md) | **v5.15: 5-min aggregator + hourly aggregator source change + factor fix** |
| M2 | **OPTIMIZATION_ENGINE_MODULE** | [02_OPTIMIZATION_ENGINE_MODULE_v5.11.md](./02_OPTIMIZATION_ENGINE_MODULE_v5.11.md) | Optimization Engine -- v5.11: Service Pool (unchanged) |
| M3 | **DR_DISPATCHER_MODULE** | [03_DR_DISPATCHER_MODULE_v5.11.md](./03_DR_DISPATCHER_MODULE_v5.11.md) | DR Dispatcher -- v5.11: Service Pool (unchanged in doc, but dispatch_records.target_mode added) |
| M4 | **MARKET_BILLING_MODULE** | [04_MARKET_BILLING_MODULE_v5.15.md](./04_MARKET_BILLING_MODULE_v5.15.md) | **v5.15: 5-min JOIN dispatch_records for SC/TOU attribution** |
| M5 | **BFF_MODULE** | [05_BFF_MODULE_v5.15.md](./05_BFF_MODULE_v5.15.md) | **v5.15: get-performance-savings removes fake ratios, reads real SC/TOU** |
| M6 | **IDENTITY_MODULE** | [06_IDENTITY_MODULE_v5.2.md](./06_IDENTITY_MODULE_v5.2.md) | Identity -- Cognito, Multi-tenant, RBAC, SSO Federation |
| M7 | **OPEN_API_MODULE** | [07_OPEN_API_MODULE_v5.7.md](./07_OPEN_API_MODULE_v5.7.md) | Open API -- M2M Gateway, Webhook, WAF, Rate Limiting |
| M8 | **ADMIN_CONTROL_MODULE** | [08_ADMIN_CONTROL_MODULE_v5.10.md](./08_ADMIN_CONTROL_MODULE_v5.10.md) | Admin Control Plane |
| 09 | **SHARED_LAYER** | [09_SHARED_LAYER_v5.14.md](./09_SHARED_LAYER_v5.14.md) | Shared Layer -- v5.14 (unchanged in v5.15) |
| 10 | **DATABASE_SCHEMA** | [10_DATABASE_SCHEMA_v5.15.md](./10_DATABASE_SCHEMA_v5.15.md) | **v5.15: 1 new partitioned table + 4 tables altered** |

---

## 1. System Positioning

(Same as v5.14. See `00_MASTER_ARCHITECTURE_v5.14.md` S1.)

> **v5.15 Version Notes (2026-03-07)**
>
> **Core Theme: SC/TOU Attribution & 5-min Telemetry**
>
> v5.15 replaces fabricated SC/TOU/PS savings percentages (hardcoded 0.55/0.30/0.15
> multipliers in `get-performance-savings.ts`) with physically attributed savings
> based on 5-minute telemetry and dispatch mode tracking.
>
> **Block 1 -- 5-min Telemetry Pipeline (M1 IoT Hub):**
> New `telemetry-5min-aggregator.ts` runs every 5 minutes, reads `telemetry_history`
> and writes to `asset_5min_metrics` (daily-partitioned, 30-day retention).
> Existing `telemetry-aggregator.ts` changes source from `telemetry_history` to
> `asset_5min_metrics`, fixing the 3x energy inflation bug (factor 1/4 -> correct).
>
> **Block 2 -- SC/TOU Attribution (M3/M4/M5):**
> `dispatch_records` gains `target_mode` column. M3 writes the mode when dispatching.
> M4 billing job JOINs `asset_5min_metrics` with `dispatch_records` by time window,
> accumulates SC and TOU savings separately, writes to `revenue_daily`.
> M5 BFF reads real values instead of applying fake multipliers.
>
> **Block 3 -- Pre-work Columns (additive, for v5.16):**
> `assets.allow_export` (grid export permission), `homes.contracted_demand_kw`
> (demand contract for PS mode). Columns only -- no logic changes.
>
> **Block 4 -- Aggregator Bug Fix (P0):**
> Factor `1.0/4` in telemetry-aggregator.ts assumes 15-min intervals but actual
> Xuheng reporting is 5-minute. All energy values in asset_hourly_metrics have been
> inflated by 3x. The new 5-min aggregator uses correct factor `1.0/12`.
>
> **v5.15 Scope:**
> - M1 IoT Hub: v5.14 -> v5.15 (new 5-min aggregator, hourly aggregator fix)
> - M4 Market & Billing: v5.14 -> v5.15 (SC/TOU attribution from 5-min + dispatch)
> - M5 BFF: v5.14 -> v5.15 (get-performance-savings real values)
> - Database Schema: v5.14 -> v5.15 (1 new table, 4 altered)
> - Shared Layer: unchanged (v5.14)
>
> **v5.15 Out of Scope:**
> - Peak Shaving savings calculation (v5.16)
> - M2 allow_export enforcement in schedule generation (v5.16+)
> - Demand charge rate in tariffs table (v5.16)
> - Forward-looking optimization (v6.0)
> - Frontend code changes

### Technology Stack

(Same as v5.14.)

### Core Design Principles

(Same as v5.14.)

---

## 2. API Contract Governance

(Same as v5.14. See `00_MASTER_ARCHITECTURE_v5.14.md` S2.)

---

## 3. 8 Module Boundaries & Responsibilities

### Module Version Matrix

| Module ID | Module Name | Current Version | Document | Key Technology |
|-----------|------------|----------------|----------|---------------|
| Shared | Shared Layer | v5.14 | [09_SHARED_LAYER](./09_SHARED_LAYER_v5.14.md) | DP BestTouCost + formula overhaul (unchanged in v5.15) |
| Shared | Database Schema | **v5.15** | [10_DATABASE_SCHEMA](./10_DATABASE_SCHEMA_v5.15.md) | PostgreSQL -- **25 tables**, +asset_5min_metrics (partitioned), +4 altered |
| M1 | IoT Hub | **v5.15** | [01_IOT_HUB](./01_IOT_HUB_MODULE_v5.15.md) | Lambda + IoT Core + MQTT + **5-min aggregator** + hourly aggregator fix |
| M2 | Optimization Engine | v5.11 | [02_OPTIMIZATION_ENGINE](./02_OPTIMIZATION_ENGINE_MODULE_v5.11.md) | Lambda + AppConfig + Service Pool |
| M3 | DR Dispatcher | v5.11 | [03_DR_DISPATCHER](./03_DR_DISPATCHER_MODULE_v5.11.md) | Lambda + EventBridge + MQTT + Service Pool (dispatch_records.target_mode added) |
| M4 | Market & Billing | **v5.15** | [04_MARKET_BILLING](./04_MARKET_BILLING_MODULE_v5.15.md) | Lambda + **5-min SC/TOU attribution** + Service Pool |
| M5 | BFF | **v5.15** | [05_BFF](./05_BFF_MODULE_v5.15.md) | Lambda + API Gateway -- **real SC/TOU savings** |
| M6 | Identity | v5.2 | [06_IDENTITY](./06_IDENTITY_MODULE_v5.2.md) | Lambda + Cognito |
| M7 | Open API | v5.7 | [07_OPEN_API](./07_OPEN_API_MODULE_v5.7.md) | Lambda + API Gateway |
| M8 | Admin Control | v5.10 | [08_ADMIN_CONTROL](./08_ADMIN_CONTROL_MODULE_v5.10.md) | Lambda + DynamoDB + AppConfig |

> **v5.15 Version Notes (2026-03-07)**
> Trigger: Performance savings page shows fabricated SC/TOU/PS split (0.55/0.30/0.15 hardcoded).
> Per S2 "API Contract Governance":
> - M1 v5.14 -> v5.15, M4 v5.14 -> v5.15, M5 v5.14 -> v5.15
> - Database Schema v5.14 -> v5.15
> - M2, M3 (doc unchanged but dispatch_records column added), M6, M7, M8 unchanged

---

## 4. EventBus Core Event Flow

(Same as v5.14. See `00_MASTER_ARCHITECTURE_v5.14.md` S4.)

---

## 5. Inter-Module Communication

### Inter-Module Communication Flow (v5.15 Update)

```
M1 (IoT Hub)          --publishes-->  TelemetryReceived, DeviceStatusChanged, AlertTriggered
                       --writes   -->  telemetry_history (unchanged)
                       --writes   -->  asset_5min_metrics (v5.15 NEW: 5-min aggregation)
                       --writes   -->  asset_hourly_metrics (v5.15: source changed to 5min)
                       --writes   -->  device_state, ems_health (unchanged)
                       --subscribes->  MQTT xuheng/+/+/data (unchanged)
                       --uses     -->  service pool (unchanged)
M2 (Algorithm Engine)  --publishes-->  ScheduleGenerated, ForecastUpdated
                       --reads    -->  device_state, vpp_strategies, assets.allow_export (future)
                       --uses     -->  service pool (v5.11)
M3 (DR Dispatcher)     --publishes-->  DRDispatchCompleted, AssetModeChanged
                       --writes   -->  dispatch_records.target_mode (v5.15 NEW)
                       --enforces -->  allow_export constraint (v5.15 NEW)
                       --uses     -->  service pool + app pool (v5.11)
M4 (Market & Billing)  --publishes-->  ProfitCalculated, InvoiceGenerated, TariffUpdated
                       --reads    -->  asset_5min_metrics (v5.15 NEW: 5-min data for attribution)
                       --reads    -->  dispatch_records (v5.15: JOIN by time for target_mode)
                       --reads    -->  tariff_schedules (Tarifa Branca rates)
                       --reads    -->  assets (capacity, DP params, allow_export)
                       --reads    -->  asset_hourly_metrics (kept for baseline/actual/bestTou)
                       --computes -->  SC savings, TOU savings (per 5-min window by mode)
                       --uses     -->  service pool (v5.11)
M5 (BFF)               --publishes-->  DRCommandIssued
                       --reads    -->  revenue_daily (v5.15: +sc_savings_reais, +tou_savings_reais)
                       --reads    -->  daily_uptime_snapshots (unchanged)
                       --uses     -->  app pool + queryWithOrg (unchanged)
                       --exposes  -->  19 GET/POST endpoints (unchanged count)
M6 (IAM)               --publishes-->  OrgProvisioned, UserCreated
M7 (Open API)          --consumes -->  DRDispatchCompleted, InvoiceGenerated -> webhook delivery
M8 (Admin Control)     --publishes-->  ConfigUpdated, SchemaEvolved
```

### v5.15 Data Flow Diagram

```
                      MQTT Broker (EMQX)
                           |
                           | xuheng/+/+/data (every ~5s)
                           v
                  +---------------------+
                  |  M1: mqtt-subscriber | (unchanged)
                  |   +- XuhengAdapter   | (v5.14: 13 fields)
                  |   +- MessageBuffer   |
                  |   +- DeviceAssetCache|
                  +------+----------+----+
                         | Service Pool
                         v
                  telemetry_history
                  (raw, ~5s interval)
                         |
            +------------+------------+
            |                         |
            | 5-min cron              | (v5.15 NEW)
            | (:00,:05,:10,...,:55)    |
            v                         |
    +---------------------------+     |
    | M1: telemetry-5min-agg    |     |
    | factor: 1/12 (CORRECT)   |     |
    +----------+----------------+     |
               | Service Pool         |
               v                      |
    asset_5min_metrics                |
    (PARTITIONED BY DAY)              |
    (30-day retention)                |
               |                      |
    +----------+----------+           |
    |                     |           |
    | hourly cron (:05)   |  daily    |
    | (source: 5min)      |  02:00   |
    v                     v           |
+------------------+  +------------------+    +------------------+
| M1: hourly-agg   |  | M4: billing-job  |    | dispatch_records |
| SUM(5min windows) |  | JOIN 5min + disp |<---| +target_mode     |
+--------+---------+  +--------+---------+    +------------------+
         |                     |
         v                     v
  asset_hourly_metrics    revenue_daily
  (factor fix: correct)   (+sc_savings_reais)
         |                (+tou_savings_reais)
         v                     |
    M5 BFF dashboard           v
    (unchanged queries)   M5 BFF get-perf-savings
                          (real SC/TOU, no fakes)
                               |
                               v
                          frontend-v2
```

### Pool Assignment Rule (unchanged from v5.11)

| Pool | Role | RLS | Used By |
|------|------|-----|---------|
| **App Pool** (`getAppPool()`) | `solfacil_app` | Enforced -- must set `app.current_org_id` | BFF handlers (via `queryWithOrg`), ACK endpoint |
| **Service Pool** (`getServicePool()`) | `solfacil_service` | Bypassed (`BYPASSRLS`) | M1 mqtt-subscriber, M1 5-min aggregator, M1 hourly aggregator, M2/M3/M4 cron jobs |

---

## 6. v5.15 Database Changes Summary

### New Tables (1)

| Table | Type | Purpose |
|-------|------|---------|
| `asset_5min_metrics` | Partitioned (RANGE by day) | 5-minute telemetry aggregation, 30-day retention |

### Altered Tables (4)

| Table | Change | Purpose |
|-------|--------|---------|
| `dispatch_records` | +1 col: `target_mode VARCHAR(50)` | SC/TOU/PS mode tracking per dispatch |
| `assets` | +1 col: `allow_export BOOLEAN DEFAULT false` | Grid export permission |
| `homes` | +1 col: `contracted_demand_kw REAL` | PS pre-work (site demand contract) |
| `revenue_daily` | +2 cols: `sc_savings_reais`, `tou_savings_reais` | Real attribution output |

### Total Table Count: **25 tables** (+1 from v5.14)

Full DDL documented in [10_DATABASE_SCHEMA_v5.15.md](./10_DATABASE_SCHEMA_v5.15.md).

---

## 7. v5.15 Module Impact Map

| Module | Block | Files Changed | Impact Level |
|--------|-------|--------------|-------------|
| **Database** | All | `migration_v5.15.sql` + `seed_v5.15.sql` | Foundation |
| **M1 IoT Hub** | Block 1+4 | 1 new (`telemetry-5min-aggregator.ts`), 1 modified (`telemetry-aggregator.ts`) | Primary |
| **M3 DR Dispatcher** | Block 2 | 1 modified (dispatch command writes target_mode, allow_export enforcement) | Secondary |
| **M4 Market & Billing** | Block 2 | 1 modified (`daily-billing-job.ts` -- SC/TOU attribution) | Primary |
| **M5 BFF** | Block 2 | 1 modified (`get-performance-savings.ts` -- remove fake ratios) | Secondary |
| Shared Layer | -- | 0 | None |
| M2 Optimization | -- | 0 | None |
| M6 Identity | -- | 0 | None |
| M7 Open API | -- | 0 | None |
| M8 Admin Control | -- | 0 | None |
| Frontend | -- | 0 | **Zero change** (response shape additive) |

### Implementation Order

```
Phase 0 (Foundation):  migration_v5.15.sql -> seed_v5.15.sql -> partition creation
Phase 1 (Block 1):    telemetry-5min-aggregator.ts (NEW) -> telemetry-aggregator.ts (source+factor fix)
Phase 2 (Block 2):    M3 dispatch target_mode write -> daily-billing-job.ts (SC/TOU attribution)
Phase 3 (Block 2):    get-performance-savings.ts (remove fakes, read real)
Phase 4 (Validation): Run full test suite -> verify 277+ existing tests still pass -> add new tests
```

---

## 8. Version Delta Summary: v5.14 -> v5.15

| Aspect | v5.14 | v5.15 |
|--------|-------|-------|
| Telemetry pipeline | Raw -> hourly (factor 1/4 BUG) | Raw -> **5-min** -> hourly (factor corrected) |
| 5-min storage | None | `asset_5min_metrics` (partitioned, 30-day retention) |
| Savings attribution | Fake: `total * 0.55 / 0.30 / 0.15` | **Real**: SC/TOU from 5-min + dispatch mode |
| Dispatch mode tracking | Not tracked | `dispatch_records.target_mode` |
| Grid export control | Not modeled | `assets.allow_export` |
| Demand contract | Not modeled | `homes.contracted_demand_kw` (PS pre-work) |
| SC savings column | Not present | `revenue_daily.sc_savings_reais` |
| TOU savings column | Not present | `revenue_daily.tou_savings_reais` |
| Energy value accuracy | 3x inflated (factor 1/4 for 5-min data) | Correct (5-min aggregator uses 1/12) |
| DB tables | 24 | **25** (+asset_5min_metrics) |
| DB altered tables | 0 | 4 (dispatch_records, assets, homes, revenue_daily) |
| Partitioning | None | Daily PARTITION BY RANGE + DROP PARTITION cleanup |
| BFF endpoints | 19 | 19 (unchanged count) |
| Frontend changes | 0 | 0 |

---

## 9. Open Items

### v5.16 (Peak Shaving Implementation)

- PS savings calculation using `contracted_demand_kw` + demand charge rate
- Demand charge rate column in `tariffs` table
- M3 dispatch logic for PS mode
- `get-performance-savings.ts` PS column populated (currently null)

### v5.17+ (Future)

- M2 `allow_export` enforcement in schedule generation
- Forward-looking DP optimization (same DP, predicted inputs)
- Load/PV forecasting engine
- ROI calculation with `installation_cost_reais`
- SoH trend analysis from accumulated battery data

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | Initial: 8 modules, EventBus, architecture governance |
| v5.3 | 2026-02-27 | HEMS single-home scenario |
| v5.4 | 2026-02-27 | PostgreSQL replaces DynamoDB/Timestream |
| v5.5 | 2026-02-28 | Dual-layer economic model |
| v5.6 | 2026-02-28 | System heartbeat + internal pipeline automation |
| v5.7 | 2026-02-28 | External awareness + M7 bidirectional |
| v5.8 | 2026-03-02 | Telemetry closed-loop + Data Contract |
| v5.9 | 2026-03-02 | Logic closed-loop + de-hardcoding |
| v5.10 | 2026-03-05 | 3D fix: DB Bootstrap + Architecture Boundary + BFF De-hardcoding |
| v5.11 | 2026-03-05 | Dual Connection Pool: dual-role DB architecture |
| v5.12 | 2026-03-05 | API Contract Alignment & BFF Expansion: 15 new endpoints |
| v5.13 | 2026-03-05 | Data Pipeline & Deterministic Math: MQTT subscriber + Tarifa Branca |
| v5.14 | 2026-03-06 | Formula Overhaul & Deep Telemetry: DP optimal TOU + 9 telemetry fields |
| **v5.15** | **2026-03-07** | **SC/TOU Attribution & 5-min Telemetry: asset_5min_metrics (PARTITION BY RANGE daily, 30-day retention); dispatch_records.target_mode for mode tracking; real SC/TOU savings from 5-min + dispatch JOIN (replaces fake 0.55/0.30/0.15); aggregator factor fix 1/4->1/12; assets.allow_export; homes.contracted_demand_kw (PS pre-work); 24->25 tables** |
