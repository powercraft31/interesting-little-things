# SOLFACIL VPP — Master Architecture Blueprint

> **模組版本**: v5.11
> **最後更新**: 2026-03-05
> **說明**: 系統總控藍圖 — 文件索引、系統定位、8大模組邊界、事件流、架構決策
> **核心主題**: Dual Connection Pool — 代碼層實現 v5.10 設計的雙角色 DB 架構

---

## 文件索引表

| # | 文件名 | 路徑 | 說明 |
|---|--------|------|------|
| 00 | **MASTER_ARCHITECTURE** | `00_MASTER_ARCHITECTURE_v5.11.md` | 系統總控藍圖（本文件） |
| M1 | **IOT_HUB_MODULE** | [01_IOT_HUB_MODULE_v5.8.md](./01_IOT_HUB_MODULE_v5.8.md) | IoT Hub — MQTT 接入、動態解析器、Asset Shadow、Telemetry Ingestion、Hourly Aggregator Job |
| M2 | **OPTIMIZATION_ENGINE_MODULE** | [02_OPTIMIZATION_ENGINE_MODULE_v5.11.md](./02_OPTIMIZATION_ENGINE_MODULE_v5.11.md) | Optimization Engine — **v5.11: Service Pool for cross-tenant schedule generation** |
| M3 | **DR_DISPATCHER_MODULE** | [03_DR_DISPATCHER_MODULE_v5.11.md](./03_DR_DISPATCHER_MODULE_v5.11.md) | DR Dispatcher — **v5.11: Service Pool for command dispatcher + timeout checker** |
| M4 | **MARKET_BILLING_MODULE** | [04_MARKET_BILLING_MODULE_v5.11.md](./04_MARKET_BILLING_MODULE_v5.11.md) | Market & Billing — **v5.11: Service Pool for daily billing batch job** |
| M5 | **BFF_MODULE** | [05_BFF_MODULE_v5.10.md](./05_BFF_MODULE_v5.10.md) | Frontend BFF — 聚合 API、BFF 淨化行動、Cognito 授權、De-hardcoding |
| M6 | **IDENTITY_MODULE** | [06_IDENTITY_MODULE_v5.2.md](./06_IDENTITY_MODULE_v5.2.md) | Identity — Cognito、Multi-tenant、RBAC、SSO Federation |
| M7 | **OPEN_API_MODULE** | [07_OPEN_API_MODULE_v5.7.md](./07_OPEN_API_MODULE_v5.7.md) | Open API — M2M Gateway、Webhook、WAF、Rate Limiting、Inbound Webhook Receivers |
| M8 | **ADMIN_CONTROL_MODULE** | [08_ADMIN_CONTROL_MODULE_v5.10.md](./08_ADMIN_CONTROL_MODULE_v5.10.md) | Admin Control Plane — 全局控制面、Data Dictionary、AppConfig |
| 09 | **SHARED_LAYER** | [09_SHARED_LAYER_v5.11.md](./09_SHARED_LAYER_v5.11.md) | **v5.11: Dual Pool Factory — getAppPool() + getServicePool()** |
| 10 | **DATABASE_SCHEMA** | [10_DATABASE_SCHEMA_v5.11.md](./10_DATABASE_SCHEMA_v5.11.md) | **v5.11: DDL Fix — formalize RLS scope for tables missing org_id** |
| 11 | **INTEGRATION_PLAN (v5.10)** | [11_v5.10_INTEGRATION_PLAN.md](./11_v5.10_INTEGRATION_PLAN.md) | v5.10 具體實施任務清單 |
| 12 | **DUAL_POOL_PLAN (v5.11)** | [12_v5.11_DUAL_POOL_PLAN.md](./12_v5.11_DUAL_POOL_PLAN.md) | **v5.11 具體實施任務清單** |

---

## 1. 系統定位

（與 v5.10 相同，不重複。參見 `00_MASTER_ARCHITECTURE_v5.10.md` §1。）

> **v5.11 升版說明（2026-03-05）**
>
> **核心主題：Dual Connection Pool — 代碼層實現雙角色 DB 架構**
>
> v5.10 設計了雙角色 DB 架構（`solfacil_app` + `solfacil_service` BYPASSRLS），
> 但代碼層仍使用單一 `getPool()` 連線池（連線為 `solfacil_app`）。這導致：
>
> **問題一：Cron Jobs 跨租戶讀取失敗**
> - M2 Schedule Generator 讀取所有 active assets → RLS 要求 `app.current_org_id` → 未設定 → 返回空結果
> - M3 Command Dispatcher 讀取 trade_schedules → 同上
> - M4 Daily Billing Job 讀取 asset_hourly_metrics → 同上
>
> **問題二：20 項測試失敗**
> - Cron job 測試使用 `getPool()` 取得 `solfacil_app` 連線，直接 `pool.query()` 未設定 `app.current_org_id`
> - RLS 策略返回空結果 → 測試斷言失敗
>
> **問題三：DDL 與設計文件不一致**
> - v5.10 設計文件 §RLS.3 為 `trades`、`revenue_daily`、`dispatch_records` 定義了 RLS 策略
> - 但這三張表缺少 `org_id` 欄位，無法套用 RLS
> - `ddl_base.sql` 已正確跳過這三張表的 RLS，但設計文件未同步
>
> **v5.11 解決方案：**
>
> 1. **DDL Fix** — 正式文件化哪些表有 RLS、哪些表無 org_id 因此無 RLS
> 2. **Shared Layer Dual Pool** — 在 `src/shared/db.ts` 實現 `getAppPool()` + `getServicePool()` + `closeAllPools()`
> 3. **M2/M3/M4 Pool Switch** — 所有 cron job 從 `getPool()` 切換到 `getServicePool()`
> 4. **Test Environment Repair** — Cron job 測試注入 service pool；BFF 測試確保 org_id 正確設定
>
> **連鎖升版模組：** Shared Layer (v5.10→v5.11)、Database Schema (v5.10→v5.11)、
>                   M2 (v5.9→v5.11)、M3 (v5.9→v5.11)、M4 (v5.10→v5.11)
>
> **v5.11 Out of Scope（明確排除）：**
> - 不新增 `org_id` 欄位到 `trades`/`revenue_daily`/`dispatch_records`（Breaking DDL change, 留待 v6.0）
> - 不接通真實 MQTT Broker（仍使用 Mock）
> - 不整合 frontend-v2 與後端 API（留待 v6.0）
> - 不實作 Event Bus（15 個領域事件仍為零實現）

### Technology Stack

（與 v5.10 相同，不重複。）

### Core Design Principles

（與 v5.10 相同，不重複。）

---

## 2. 最高架構憲法：接口契約鎖定與變更法則 (API Contract Governance)

（與 v5.10 相同，不重複。參見 `00_MASTER_ARCHITECTURE_v5.10.md` §2。）

---

## 3. 8 大模組邊界與職責

### Module Responsibility Matrix

（與 v5.10 相同，不重複。）

### 模組版本號矩陣

| 模組 ID | 模組名稱 | 當前版本 | 文件 | 主要技術 |
|---------|---------|---------|------|---------|
| Shared | Shared Layer | **v5.11** | [09_SHARED_LAYER](./09_SHARED_LAYER_v5.11.md) | 公共型別、**Dual Pool Factory**、雙層 KPI、Shared Middleware |
| Shared | Database Schema | **v5.11** | [10_DATABASE_SCHEMA](./10_DATABASE_SCHEMA_v5.11.md) | PostgreSQL — 19 張表、**RLS Scope Formalization** |
| M1 | IoT Hub | **v5.8** | [01_IOT_HUB](./01_IOT_HUB_MODULE_v5.8.md) | Lambda + IoT Core + DynamoDB |
| M2 | Optimization Engine | **v5.11** | [02_OPTIMIZATION_ENGINE](./02_OPTIMIZATION_ENGINE_MODULE_v5.11.md) | Lambda + AppConfig + **Service Pool** |
| M3 | DR Dispatcher | **v5.11** | [03_DR_DISPATCHER](./03_DR_DISPATCHER_MODULE_v5.11.md) | Lambda + EventBridge + MQTT + **Service Pool** |
| M4 | Market & Billing | **v5.11** | [04_MARKET_BILLING](./04_MARKET_BILLING_MODULE_v5.11.md) | Lambda + DynamoDB + **Service Pool** |
| M5 | BFF | **v5.10** | [05_BFF](./05_BFF_MODULE_v5.10.md) | Lambda + API Gateway |
| M6 | Identity | v5.2 | [06_IDENTITY](./06_IDENTITY_MODULE_v5.2.md) | Lambda + Cognito |
| M7 | Open API | **v5.7** | [07_OPEN_API](./07_OPEN_API_MODULE_v5.7.md) | Lambda + API Gateway |
| M8 | Admin Control | **v5.10** | [08_ADMIN_CONTROL](./08_ADMIN_CONTROL_MODULE_v5.10.md) | Lambda + DynamoDB + AppConfig |

> **v5.11 升版說明（2026-03-05）**
> 觸發原因：v5.10 設計了雙角色 DB 架構，但代碼層仍使用單一連線池，導致 cron jobs 跨租戶讀取失敗 + 20 項測試失敗。
> 依據 §2「最高架構憲法：連鎖升級法」：
> - Shared Layer v5.10 → v5.11（新增 `getAppPool()` + `getServicePool()` dual pool factory）
> - Database Schema v5.10 → v5.11（formalize RLS scope for tables missing `org_id`）
> - M2 Optimization Engine v5.9 → v5.11（schedule-generator 切換到 service pool）
> - M3 DR Dispatcher v5.9 → v5.11（command-dispatcher + timeout-checker 切換到 service pool）
> - M4 Market & Billing v5.10 → v5.11（daily-billing-job 切換到 service pool）
> - M1/M5/M6/M7/M8 版本維持不變（不受此變更影響）

---

## 4. EventBus 核心事件流

（與 v5.10 相同，不重複。參見 `00_MASTER_ARCHITECTURE_v5.10.md` §4。）

---

## 5. 跨模組通訊機制

### Inter-Module Communication Flow（v5.11 更新）

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
                       --reads    -->  dispatch_commands (KPIs, v5.10: de-hardcoded)
                       --uses     -->  app pool + queryWithOrg (v5.11: unchanged)
M6 (IAM)               --publishes-->  OrgProvisioned, UserCreated
M7 (Open API)          --consumes -->  DRDispatchCompleted, InvoiceGenerated -> webhook delivery
M8 (Admin Control)     --publishes-->  ConfigUpdated, SchemaEvolved
```

### Pool Assignment Rule (v5.11 新增)

| Pool | Role | RLS | Used By |
|------|------|-----|---------|
| **App Pool** (`getAppPool()`) | `solfacil_app` | Enforced — must set `app.current_org_id` | BFF handlers (via `queryWithOrg`), ACK endpoint (`collect-response.ts`) |
| **Service Pool** (`getServicePool()`) | `solfacil_service` | Bypassed (`BYPASSRLS`) | M2 schedule-generator, M3 command-dispatcher, M3 timeout-checker, M4 daily-billing-job, M1 telemetry-aggregator |

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
| **v5.11** | **2026-03-05** | **Dual Connection Pool: (1) DDL RLS scope formalization — trades/revenue_daily/dispatch_records confirmed no RLS (missing org_id); (2) Shared Layer dual pool factory — getAppPool() + getServicePool() + closeAllPools(); (3) M2/M3/M4 cron jobs switch to service pool (BYPASSRLS); (4) M1 telemetry-aggregator switch to service pool; (5) Test environment repair — 20 failing tests fixed via correct pool injection + org_id setup; (6) local-server.ts dual pool startup** |
