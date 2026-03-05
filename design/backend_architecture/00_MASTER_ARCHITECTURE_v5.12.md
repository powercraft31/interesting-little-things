# SOLFACIL VPP — Master Architecture Blueprint

> **模組版本**: v5.12
> **最後更新**: 2026-03-05
> **說明**: 系統總控藍圖 — 文件索引、系統定位、8大模組邊界、事件流、架構決策
> **核心主題**: API Contract Alignment & BFF Expansion — 前端數據盤點、Gap Analysis、15 個新 BFF 端點、5 個新 DB 表

---

## 文件索引表

| # | 文件名 | 路徑 | 說明 |
|---|--------|------|------|
| 00 | **MASTER_ARCHITECTURE** | `00_MASTER_ARCHITECTURE_v5.12.md` | 系統總控藍圖（本文件） |
| M1 | **IOT_HUB_MODULE** | [01_IOT_HUB_MODULE_v5.11.md](./01_IOT_HUB_MODULE_v5.11.md) | IoT Hub — v5.11: Service Pool for telemetry-webhook + telemetry-aggregator |
| M2 | **OPTIMIZATION_ENGINE_MODULE** | [02_OPTIMIZATION_ENGINE_MODULE_v5.11.md](./02_OPTIMIZATION_ENGINE_MODULE_v5.11.md) | Optimization Engine — v5.11: Service Pool for cross-tenant schedule generation |
| M3 | **DR_DISPATCHER_MODULE** | [03_DR_DISPATCHER_MODULE_v5.11.md](./03_DR_DISPATCHER_MODULE_v5.11.md) | DR Dispatcher — v5.11: Service Pool for command dispatcher + timeout checker |
| M4 | **MARKET_BILLING_MODULE** | [04_MARKET_BILLING_MODULE_v5.11.md](./04_MARKET_BILLING_MODULE_v5.11.md) | Market & Billing — v5.11: Service Pool for daily billing batch job |
| M5 | **BFF_MODULE** | [05_BFF_MODULE_v5.12.md](./05_BFF_MODULE_v5.12.md) | **v5.12: API Contract Alignment — 15 新端點、Gap Analysis、Frontend 漸進整合** |
| M6 | **IDENTITY_MODULE** | [06_IDENTITY_MODULE_v5.2.md](./06_IDENTITY_MODULE_v5.2.md) | Identity — Cognito、Multi-tenant、RBAC、SSO Federation |
| M7 | **OPEN_API_MODULE** | [07_OPEN_API_MODULE_v5.7.md](./07_OPEN_API_MODULE_v5.7.md) | Open API — M2M Gateway、Webhook、WAF、Rate Limiting、Inbound Webhook Receivers |
| M8 | **ADMIN_CONTROL_MODULE** | [08_ADMIN_CONTROL_MODULE_v5.10.md](./08_ADMIN_CONTROL_MODULE_v5.10.md) | Admin Control Plane — 全局控制面、Data Dictionary、AppConfig |
| 09 | **SHARED_LAYER** | [09_SHARED_LAYER_v5.11.md](./09_SHARED_LAYER_v5.11.md) | v5.11: Dual Pool Factory — getAppPool() + getServicePool() |
| 10 | **DATABASE_SCHEMA** | [10_DATABASE_SCHEMA_v5.11.md](./10_DATABASE_SCHEMA_v5.11.md) | v5.11: DDL Fix — formalize RLS scope for tables missing org_id |
| 11 | **INTEGRATION_PLAN (v5.10)** | [11_v5.10_INTEGRATION_PLAN.md](./11_v5.10_INTEGRATION_PLAN.md) | v5.10 具體實施任務清單 |
| 12 | **DUAL_POOL_PLAN (v5.11)** | [12_v5.11_DUAL_POOL_PLAN.md](./12_v5.11_DUAL_POOL_PLAN.md) | v5.11 具體實施任務清單 |

---

## 1. 系統定位

（與 v5.11 相同，不重複。參見 `00_MASTER_ARCHITECTURE_v5.11.md` §1。）

> **v5.12 升版說明（2026-03-05）**
>
> **核心主題：API Contract Alignment & BFF Expansion**
>
> frontend-v2 目前使用 100% mock/static 數據（hardcoded JSON in JS files）。
> 在進行真正的前後端整合之前，需要：
>
> 1. **前端數據盤點** — 完整掃描 6 個頁面的數據依賴（26 個 mock 物件、7 個圖表、6 個表格）
> 2. **Gap Analysis** — 交叉比對前端需求 vs 後端提供（20 項差距）
> 3. **BFF 擴展** — 設計 15 個新端點覆蓋所有前端頁面
> 4. **DB Schema 擴展** — 5 個新表 + 1 個 ALTER（homes, devices, offline_events, daily_uptime_snapshots, device_telemetry_state, tariff_schedules ALTER）
> 5. **Dashboard De-hardcoding** — 清理 GET /dashboard 剩餘 5 個硬編碼欄位
> 6. **Frontend 漸進整合策略** — Dual-Source Adapter Pattern，逐頁從 mock 切換到 live API
>
> **Gap Analysis 核心發現：**
>
> | Gap 類型 | 數量 | 說明 |
> |----------|------|------|
> | 缺失端點 | 12 | 無 BFF handler |
> | 格式不符 | 3 | 端點存在但 payload 與前端預期不同 |
> | 缺失 DB 表/欄位 | 5 | 數據不存在任何 DB 表 |
> | 數據可推導 | 4 | 數據可從現有表計算 |
> | 缺失計算邏輯 | 2 | 需要伺服器端計算 |
>
> **v5.12 Scope：**
> - M5 BFF: v5.10 → v5.12（15 新端點 + 5 hardcoded 欄位去硬編碼）
> - Database Schema: 需更新（5 新表 + 1 ALTER，但不升版 Schema 文件 — 留待實施時同步）
> - 其餘模組版本不變
>
> **v5.12 Out of Scope（明確排除）：**
> - 不修改任何 `src/` 代碼（本版本僅為設計文件）
> - 不修改現有 DB schema 文件版本號（實施時同步升版）
> - 不實施前端代碼變更（adapter 層為設計，待實施階段執行）
> - 不新增 `org_id` 到 `trades`/`revenue_daily`/`dispatch_records`（與 v5.11 Out of Scope 一致，留待 v6.0）
> - 不接通真實 MQTT Broker（仍使用 Mock）
> - 不實作 Event Bus（15 個領域事件仍為零實現）

### Technology Stack

（與 v5.11 相同，不重複。）

### Core Design Principles

（與 v5.11 相同，不重複。）

---

## 2. 最高架構憲法：接口契約鎖定與變更法則 (API Contract Governance)

（與 v5.11 相同，不重複。參見 `00_MASTER_ARCHITECTURE_v5.11.md` §2。）

---

## 3. 8 大模組邊界與職責

### Module Responsibility Matrix

（與 v5.11 相同，不重複。）

### 模組版本號矩陣

| 模組 ID | 模組名稱 | 當前版本 | 文件 | 主要技術 |
|---------|---------|---------|------|---------|
| Shared | Shared Layer | v5.11 | [09_SHARED_LAYER](./09_SHARED_LAYER_v5.11.md) | 公共型別、Dual Pool Factory、雙層 KPI、Shared Middleware |
| Shared | Database Schema | v5.11 | [10_DATABASE_SCHEMA](./10_DATABASE_SCHEMA_v5.11.md) | PostgreSQL — 19 張表、RLS Scope Formalization |
| M1 | IoT Hub | v5.11 | [01_IOT_HUB](./01_IOT_HUB_MODULE_v5.11.md) | Lambda + IoT Core + DynamoDB + Service Pool |
| M2 | Optimization Engine | v5.11 | [02_OPTIMIZATION_ENGINE](./02_OPTIMIZATION_ENGINE_MODULE_v5.11.md) | Lambda + AppConfig + Service Pool |
| M3 | DR Dispatcher | v5.11 | [03_DR_DISPATCHER](./03_DR_DISPATCHER_MODULE_v5.11.md) | Lambda + EventBridge + MQTT + Service Pool |
| M4 | Market & Billing | v5.11 | [04_MARKET_BILLING](./04_MARKET_BILLING_MODULE_v5.11.md) | Lambda + DynamoDB + Service Pool |
| M5 | BFF | **v5.12** | [05_BFF](./05_BFF_MODULE_v5.12.md) | Lambda + API Gateway — **15 新端點、Frontend 整合** |
| M6 | Identity | v5.2 | [06_IDENTITY](./06_IDENTITY_MODULE_v5.2.md) | Lambda + Cognito |
| M7 | Open API | v5.7 | [07_OPEN_API](./07_OPEN_API_MODULE_v5.7.md) | Lambda + API Gateway |
| M8 | Admin Control | v5.10 | [08_ADMIN_CONTROL](./08_ADMIN_CONTROL_MODULE_v5.10.md) | Lambda + DynamoDB + AppConfig |

> **v5.12 升版說明（2026-03-05）**
> 觸發原因：frontend-v2 使用 100% mock 數據，與後端 BFF API 零整合。需要完整的 API 契約對齊。
> 依據 §2「最高架構憲法」：
> - M5 BFF v5.10 → v5.12（跳過 v5.11，因 v5.11 為 Dual Pool 主題，M5 未受影響）
> - 其餘模組版本維持不變（不受此變更影響）
> - Database Schema 需在實施時更新（5 新表 + 1 ALTER），但設計文件版本號留待實施階段

---

## 4. EventBus 核心事件流

（與 v5.11 相同，不重複。參見 `00_MASTER_ARCHITECTURE_v5.11.md` §4。）

---

## 5. 跨模組通訊機制

### Inter-Module Communication Flow（v5.12 更新）

```
M1 (IoT Hub)          --publishes-->  TelemetryReceived, DeviceStatusChanged, AlertTriggered
                       --writes   -->  asset_hourly_metrics (Data Contract, v5.8)
                       --uses     -->  service pool (telemetry-aggregator cron, v5.11)
M2 (Algorithm Engine)  --publishes-->  ScheduleGenerated, ForecastUpdated
                       --reads    -->  device_state (battery_soc), vpp_strategies (min/max_soc)
                       --uses     -->  service pool (schedule-generator cron, v5.11)
M3 (DR Dispatcher)     --publishes-->  DRDispatchCompleted, AssetModeChanged
                       --exposes  -->  POST /api/dispatch/ack (v5.9)
                       --uses     -->  service pool (command-dispatcher + timeout-checker crons, v5.11)
                       --uses     -->  app pool (collect-response ACK endpoint, v5.11)
M4 (Market & Billing)  --publishes-->  ProfitCalculated, InvoiceGenerated, TariffUpdated
                       --reads    -->  asset_hourly_metrics (Data Contract, v5.8)
                       --uses     -->  service pool (daily-billing-job cron, v5.11)
M5 (BFF)               --publishes-->  DRCommandIssued (user-initiated dispatch)
                       --reads    -->  dispatch_commands, dispatch_records, vpp_strategies,
                                      tariff_schedules, revenue_daily, algorithm_metrics,
                                      telemetry_history, assets, device_state, organizations
                       --reads    -->  homes, devices, offline_events, daily_uptime_snapshots (v5.12 NEW)
                       --uses     -->  app pool + queryWithOrg (v5.11: unchanged)
                       --exposes  -->  19 GET/POST endpoints (4 existing + 15 new in v5.12)
M6 (IAM)               --publishes-->  OrgProvisioned, UserCreated
M7 (Open API)          --consumes -->  DRDispatchCompleted, InvoiceGenerated -> webhook delivery
M8 (Admin Control)     --publishes-->  ConfigUpdated, SchemaEvolved
```

### BFF Endpoint Coverage (v5.12)

```
                    ┌──────────────────────────────────────┐
                    │          frontend-v2 (6 pages)        │
                    │  P1 Fleet │ P2 Devices │ P3 Energy    │
                    │  P4 HEMS  │ P5 VPP     │ P6 Perf      │
                    └──────────────┬───────────────────────┘
                                   │ Dual-Source Adapter
                                   │ (mock ↔ live API toggle)
                    ┌──────────────▼───────────────────────┐
                    │           M5 BFF Layer (19 endpoints)  │
                    │                                        │
                    │  Existing (4):                         │
                    │    GET /dashboard                      │
                    │    GET /assets                         │
                    │    GET /trades                         │
                    │    GET /revenue-trend                  │
                    │                                        │
                    │  v5.12 NEW (15):                       │
                    │    Fleet:  /fleet/overview              │
                    │            /fleet/integradores          │
                    │            /fleet/offline-events        │
                    │            /fleet/uptime-trend          │
                    │    Device: /devices                     │
                    │            /homes                       │
                    │    Energy: /homes/:id/energy            │
                    │            /homes/summary               │
                    │    HEMS:   /hems/overview               │
                    │            /hems/dispatch (POST)        │
                    │    VPP:    /vpp/capacity                │
                    │            /vpp/latency                 │
                    │            /vpp/dr-events               │
                    │    Perf:   /performance/scorecard       │
                    │            /performance/savings         │
                    └──────────────┬───────────────────────┘
                                   │ queryWithOrg + getAppPool()
                    ┌──────────────▼───────────────────────┐
                    │        PostgreSQL (24 tables)          │
                    │  19 existing + 5 new (v5.12):          │
                    │    homes, devices, offline_events,     │
                    │    daily_uptime_snapshots,             │
                    │    device_telemetry_state              │
                    └───────────────────────────────────────┘
```

### Pool Assignment Rule (unchanged from v5.11)

| Pool | Role | RLS | Used By |
|------|------|-----|---------|
| **App Pool** (`getAppPool()`) | `solfacil_app` | Enforced — must set `app.current_org_id` | BFF handlers (via `queryWithOrg`), ACK endpoint |
| **Service Pool** (`getServicePool()`) | `solfacil_service` | Bypassed (`BYPASSRLS`) | M2/M3/M4 cron jobs, M1 telemetry |

---

## 6. v5.12 Database Changes Summary

### New Tables (5)

| Table | Purpose | RLS | Rows (seed) |
|-------|---------|-----|-------------|
| `homes` | Residential home registry | Yes (org_id) | 3 |
| `devices` | Individual device registry (granular) | Yes (org_id) | 47 |
| `offline_events` | Device offline event tracking | Yes (org_id) | ~10 |
| `daily_uptime_snapshots` | Daily fleet uptime percentage | Yes (org_id) | 28 per org |
| `device_telemetry_state` | Per-device live telemetry (JSONB) | No (via devices FK) | 47 |

### Altered Tables (1)

| Table | Change | Purpose |
|-------|--------|---------|
| `tariff_schedules` | Add `intermediate_rate`, `intermediate_start`, `intermediate_end`, `disco` columns | Support tarifa branca 3-tier model |

### Total Table Count: 19 existing + 5 new = **24 tables**

Full DDL for new tables is documented in [05_BFF_MODULE_v5.12.md §6](./05_BFF_MODULE_v5.12.md#6-new-db-tables-required-v512-ddl).

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
| **v5.12** | **2026-03-05** | **API Contract Alignment & BFF Expansion: (1) 完整前端數據盤點 — 6 頁面 × 26 mock 物件 × 7 圖表 × 6 表格; (2) 20 項 Gap Analysis (12 缺失端點 + 3 格式不符 + 5 缺失 DB 表); (3) M5 BFF v5.10→v5.12: 15 新端點 (fleet×4 + devices×2 + energy×2 + hems×2 + vpp×3 + perf×2) + GET /dashboard 5 欄位去硬編碼 → 共 19 端點; (4) 5 新 DB 表 (homes, devices, offline_events, daily_uptime_snapshots, device_telemetry_state) + tariff_schedules ALTER; (5) Frontend Dual-Source Adapter Pattern — 逐頁 mock→API 漸進遷移; (6) 9 階段 36 項實施計劃** |
