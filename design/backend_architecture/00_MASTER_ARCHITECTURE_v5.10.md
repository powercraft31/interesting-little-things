# SOLFACIL VPP — Master Architecture Blueprint

> **模組版本**: v5.10
> **最後更新**: 2026-03-05
> **說明**: 系統總控藍圖 — 文件索引、系統定位、8大模組邊界、事件流、架構決策
> **核心主題**: DB Bootstrap Fix, Architecture Boundary Fix, BFF De-hardcoding（DB 建置修復、架構邊界修復、BFF 去硬編碼）

---

## 文件索引表

| # | 文件名 | 路徑 | 說明 |
|---|--------|------|------|
| 00 | **MASTER_ARCHITECTURE** | `00_MASTER_ARCHITECTURE_v5.10.md` | 系統總控藍圖（本文件） |
| M1 | **IOT_HUB_MODULE** | [01_IOT_HUB_MODULE_v5.8.md](./01_IOT_HUB_MODULE_v5.8.md) | IoT Hub — MQTT 接入、動態解析器、Asset Shadow、Telemetry Ingestion、Hourly Aggregator Job |
| M2 | **OPTIMIZATION_ENGINE_MODULE** | [02_OPTIMIZATION_ENGINE_MODULE_v5.9.md](./02_OPTIMIZATION_ENGINE_MODULE_v5.9.md) | Optimization Engine — 4 種策略演算法、排程最佳化、雙目標框架、Schedule Generator Cron Job、動態電價優先策略、**SoC-Aware Scheduling** |
| M3 | **DR_DISPATCHER_MODULE** | [03_DR_DISPATCHER_MODULE_v5.9.md](./03_DR_DISPATCHER_MODULE_v5.9.md) | DR Dispatcher — 調度指令、SQS 逾時、狀態追蹤、Command Dispatcher Worker、**Real Async ACK Handshake** |
| M4 | **MARKET_BILLING_MODULE** | [04_MARKET_BILLING_MODULE_v5.10.md](./04_MARKET_BILLING_MODULE_v5.10.md) | Market & Billing — 電價計費、雙軌收益計算、Daily Billing Batch Job、**v5.10: 架構邊界修復** |
| M5 | **BFF_MODULE** | [05_BFF_MODULE_v5.10.md](./05_BFF_MODULE_v5.10.md) | Frontend BFF — 聚合 API、BFF 淨化行動、Cognito 授權、De-hardcoding、**v5.10: Middleware 遷移 + Dispatch KPI Fix + API Gap Analysis** |
| M6 | **IDENTITY_MODULE** | [06_IDENTITY_MODULE_v5.2.md](./06_IDENTITY_MODULE_v5.2.md) | Identity — Cognito、Multi-tenant、RBAC、SSO Federation |
| M7 | **OPEN_API_MODULE** | [07_OPEN_API_MODULE_v5.7.md](./07_OPEN_API_MODULE_v5.7.md) | Open API — M2M Gateway、Webhook、WAF、Rate Limiting、Inbound Webhook Receivers |
| M8 | **ADMIN_CONTROL_MODULE** | [08_ADMIN_CONTROL_MODULE_v5.10.md](./08_ADMIN_CONTROL_MODULE_v5.10.md) | Admin Control Plane — 全局控制面、Data Dictionary、AppConfig、**v5.10: 架構邊界修復** |
| 09 | **SHARED_LAYER** | [09_SHARED_LAYER_v5.10.md](./09_SHARED_LAYER_v5.10.md) | 公共型別定義、API 契約、雙層經濟模型型別、**v5.10: Shared Middleware** |
| 10 | **DATABASE_SCHEMA** | [10_DATABASE_SCHEMA_v5.10.md](./10_DATABASE_SCHEMA_v5.10.md) | PostgreSQL 完整 DDL — 19 張表、ER 圖、Migration 管理、**v5.10: Bootstrap Fix + RLS Admin Bypass** |
| 11 | **INTEGRATION_PLAN** | [11_v5.10_INTEGRATION_PLAN.md](./11_v5.10_INTEGRATION_PLAN.md) | v5.10 具體實施任務清單 |

---

## 1. 系統定位

SOLFACIL is building a **B2B SaaS Virtual Power Plant (VPP)** platform that aggregates distributed battery energy storage systems (BESS) across Brazil. The platform enables:

- **B端批發套利 (VPP Aggregator)** — SOLFACIL 作為 CCEE 市場參與者，
  依據 pld_horario 電價調度艦隊充放電，賺取 PLD 差價（R$/MWh）
- **C端自發自用優化 (HEMS)** — 同時確保 self_consumption_pct >= 目標門檻，
  計算並回報客戶省下的零售電費（R$/kWh）
- **Demand Response (DR)** — 協調 50,000+ 設備參與電網平衡事件
- **Multi-tenant 管理** — 多租戶嚴格資料隔離

> **v5.10 升版說明（2026-03-05）**
>
> **核心主題：三維修正（DB Bootstrap Fix + Architecture Boundary Fix + BFF De-hardcoding）**
>
> v5.10 解決 v5.9 Status Report 中識別的三類問題：
>
> **維度一：DB Bootstrap Fix（數據庫建置修復）**
> - `feature_flags` 表 UNIQUE 約束語法錯誤修復（`UNIQUE (flag_name, COALESCE(...))` → `CREATE UNIQUE INDEX`）
> - Seed 腳本移除對不存在欄位（`organizations.metadata`、`assets.metadata`）的引用
> - 所有 RLS 啟用表新增 Admin Bypass 策略（解決 Cron Job 無法讀取全量數據問題）
> - `dispatch_commands` 表啟用 RLS + 租戶隔離 + Admin Bypass
> - 設計統一 `bootstrap.sh` 腳本（一鍵 DB 重建）
>
> **維度二：Architecture Boundary Fix（架構邊界修復）**
> - `extractTenantContext`、`requireRole`、`apiError` 從 BFF 遷移至 Shared Layer（`src/shared/middleware/tenant-context.ts`）
> - M4 `get-tariff-schedule.ts` import 路徑修正（1 個文件）
> - M8 4 個 handler 文件 import 路徑修正（`get-parser-rules.ts`、`create-parser-rule.ts`、`get-vpp-strategies.ts`、`update-vpp-strategy.ts`）
> - BFF 原 `middleware/tenant-context.ts` 刪除
>
> **維度三：BFF De-hardcoding 完成**
> - `get-dashboard.ts` 的 `dispatchSuccessCount`/`dispatchTotalCount`/`dispatchSuccessRate` 改為 `dispatch_commands` 表查詢
> - API Gap Analysis：frontend-v2 完全使用 mock 數據，與後端 BFF API 零整合
>
> **連鎖升版模組：** Shared Layer (v5.5→v5.10)、Database Schema (v5.8→v5.10)、
>                   M4 (v5.8→v5.10)、M5 BFF (v5.9→v5.10)、M8 (v5.3→v5.10)
>
> **v5.10 Out of Scope（明確排除）：**
> - 不接通真實 MQTT Broker（仍使用 Mock）
> - 不實作 eslint-plugin-boundaries（架構邊界 lint 規則）
> - 不整合 frontend-v2 與後端 API（留待 v6.0）
> - 不實作 Event Bus（15 個領域事件仍為零實現）

### Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| IaC | AWS CDK (TypeScript) | v2.x |
| Compute | AWS Lambda | Node.js 20 / Python 3.12 (M2 only) |
| API | API Gateway v2 (HTTP API) | — |
| Auth | Amazon Cognito | User Pool + Identity Providers |
| Messaging | Amazon EventBridge | Custom bus |
| IoT | AWS IoT Core | MQTT v4.1.1 over TLS |
| RDBMS | PostgreSQL (Aurora Serverless v2) | v5.4 — 全面取代 DynamoDB/Timestream |
| Config | AWS AppConfig + Lambda Extension | Sidecar pattern |
| Security | AWS WAF v2, Secrets Manager | — |
| Observability | Lambda Powertools, X-Ray, CloudWatch | — |

### Core Design Principles

| # | Principle | Rationale |
|---|-----------|-----------|
| 1 | **Multi-tenant by design** | `org_id` is a mandatory dimension in every data store, event payload, MQTT topic, and API response |
| 2 | **Event-driven decoupling** | All inter-module communication flows through a single Amazon EventBridge bus (`solfacil-vpp-events`). No direct Lambda-to-Lambda invocations |
| 3 | **Bounded contexts** | Each module owns its data store. No shared databases. Cross-module data access mediated by events or BFF aggregation |
| 4 | **Serverless-first** | Zero server management. Lambda + DynamoDB/Timestream/RDS Serverless. Pay-per-invocation |
| 5 | **API-first** | BFF (M5) for dashboard, Open API (M7) for external integrations. Both documented and versioned independently |
| 6 | **Zero-trust security** | Every request authenticated. Every query tenant-scoped. Every write role-checked |
| 7 | **Immutability** | All state changes produce events. Lambda handlers return new objects, never mutate in place |
| 8 | **Data Contract (v5.8)** | Cross-module data flows via explicit Shared Contract tables (e.g., `asset_hourly_metrics`). No direct cross-module table reads. |

---

## 2. 最高架構憲法：接口契約鎖定與變更法則 (API Contract Governance)

> **本章節具有最高優先級。所有模組開發者在動任何接口定義之前，必須先閱讀並遵守以下兩條鐵律。**

（與 v5.9 相同，不重複。參見 `00_MASTER_ARCHITECTURE_v5.9.md` §2。）

---

## 3. 8 大模組邊界與職責

### Module Responsibility Matrix

| Plane | Module ID | Name | Responsibility | Primary Data Store | Key Technology |
|-------|-----------|------|----------------|--------------------|----------------|
| **Control** | M8 | Admin Control Plane | Dynamic configuration, business rules, feature flags, Global Data Dictionary | DynamoDB + AppConfig | Lambda + DynamoDB + AppConfig |
| Data | M1 | IoT & Telemetry Hub | MQTT ingestion, dynamic parser, Device Shadow, telemetry storage, **Hourly Aggregator Job (Data Contract Publisher)** | Amazon Timestream | Lambda + IoT Core + DynamoDB |
| Data | M2 | Optimization Engine | Schedule optimization, forecast, dual-objective optimization, **SoC-aware guardrails (v5.9)** | SSM Parameter Store | Lambda + AppConfig |
| Data | M3 | DR Dispatcher | Demand-response commands, SQS timeout, status tracking, **real async ACK handshake (v5.9)** | DynamoDB | Lambda + EventBridge + MQTT |
| Data | M4 | Market & Billing | Tarifa Branca rules, PLD arbitrage, dual-track billing (v5.8: actual metered data), invoicing | RDS PostgreSQL | Lambda + DynamoDB |
| Data | M5 | Frontend BFF | Dashboard REST API (Cognito-protected, tenant-scoped), **de-hardcoded KPIs (v5.10: dispatch complete)** | Aggregates from M1-M4 | Lambda + API Gateway |
| Data | M6 | Identity & Tenant (IAM) | Cognito User Pool, SSO/SAML, org provisioning, RBAC | Cognito + DynamoDB | Lambda + Cognito |
| Data | M7 | Open API & Integration | M2M API Gateway, WAF, rate limiting, webhook subscriptions, **inbound webhook receivers** | DynamoDB + Secrets Manager | Lambda + API Gateway |

### 模組版本號矩陣

| 模組 ID | 模組名稱 | 當前版本 | 文件 | 主要技術 |
|---------|---------|---------|------|---------|
| Shared | Shared Layer | **v5.10** | [09_SHARED_LAYER](./09_SHARED_LAYER_v5.10.md) | 公共型別、Connection Pool、雙層 KPI、**Shared Middleware** |
| Shared | Database Schema | **v5.10** | [10_DATABASE_SCHEMA](./10_DATABASE_SCHEMA_v5.10.md) | PostgreSQL — 19 張表、**Bootstrap Fix + RLS Admin Bypass** |
| M1 | IoT Hub | **v5.8** | [01_IOT_HUB](./01_IOT_HUB_MODULE_v5.8.md) | Lambda + IoT Core + DynamoDB |
| M2 | Optimization Engine | **v5.9** | [02_OPTIMIZATION_ENGINE](./02_OPTIMIZATION_ENGINE_MODULE_v5.9.md) | Lambda + AppConfig |
| M3 | DR Dispatcher | **v5.9** | [03_DR_DISPATCHER](./03_DR_DISPATCHER_MODULE_v5.9.md) | Lambda + EventBridge + MQTT |
| M4 | Market & Billing | **v5.10** | [04_MARKET_BILLING](./04_MARKET_BILLING_MODULE_v5.10.md) | Lambda + DynamoDB |
| M5 | BFF | **v5.10** | [05_BFF](./05_BFF_MODULE_v5.10.md) | Lambda + API Gateway |
| M6 | Identity | v5.2 | [06_IDENTITY](./06_IDENTITY_MODULE_v5.2.md) | Lambda + Cognito |
| M7 | Open API | **v5.7** | [07_OPEN_API](./07_OPEN_API_MODULE_v5.7.md) | Lambda + API Gateway |
| M8 | Admin Control | **v5.10** | [08_ADMIN_CONTROL](./08_ADMIN_CONTROL_MODULE_v5.10.md) | Lambda + DynamoDB + AppConfig |

> **v5.10 升版說明（2026-03-05）**
> 觸發原因：(1) DB Bootstrap 腳本缺陷修復, (2) 跨模組依賴邊界修復 (tenant-context 遷移至 Shared Layer), (3) BFF dispatch KPI de-hardcoding 完成。
> 依據 §2「最高架構憲法：連鎖升級法」：
> - Shared Layer v5.5 → v5.10（新增 middleware 模組）
> - Database Schema v5.8 → v5.10（feature_flags fix, RLS admin bypass, dispatch_commands RLS, bootstrap.sh）
> - M4 Market & Billing v5.8 → v5.10（import 路徑修正）
> - M5 BFF v5.9 → v5.10（middleware 遷移 + dispatch KPI de-hardcoding + API gap analysis）
> - M8 Admin Control v5.3 → v5.10（4 個 handler import 路徑修正）
> - M1/M2/M3/M6/M7 版本維持不變（不受此變更影響）

---

## 4. EventBus 核心事件流

（與 v5.9 相同，不重複。參見 `00_MASTER_ARCHITECTURE_v5.9.md` §4。）

---

## 5. 跨模組通訊機制

### Inter-Module Communication Flow（v5.10 更新）

```
M1 (IoT Hub)          --publishes-->  TelemetryReceived, DeviceStatusChanged, AlertTriggered
                       --writes   -->  asset_hourly_metrics (Data Contract, v5.8)
M2 (Algorithm Engine)  --publishes-->  ScheduleGenerated, ForecastUpdated
                       --reads    -->  device_state (battery_soc), vpp_strategies (min/max_soc) (v5.9)
M3 (DR Dispatcher)     --publishes-->  DRDispatchCompleted, AssetModeChanged
                       --exposes  -->  POST /api/dispatch/ack (v5.9)
M4 (Market & Billing)  --publishes-->  ProfitCalculated, InvoiceGenerated, TariffUpdated
                       --reads    -->  asset_hourly_metrics (Data Contract, v5.8)
                       --imports  -->  shared/middleware/tenant-context (v5.10, was bff/)
M5 (BFF)               --publishes-->  DRCommandIssued (user-initiated dispatch)
                       --reads    -->  dispatch_commands (KPIs, v5.10: de-hardcoded)
                       --imports  -->  shared/middleware/tenant-context (v5.10, was local)
M6 (IAM)               --publishes-->  OrgProvisioned, UserCreated
M7 (Open API)          --consumes -->  DRDispatchCompleted, InvoiceGenerated -> webhook delivery
                       --receives -->  Inbound webhooks (CCEE PLD, Weather) -> DB upsert (v5.7)
M8 (Admin Control)     --publishes-->  ConfigUpdated, SchemaEvolved
                       --imports  -->  shared/middleware/tenant-context (v5.10, was bff/)
```

**Rule: No direct Lambda-to-Lambda calls.**

**Rule (v5.8): No direct cross-module table reads.**

**Rule (v5.10): No cross-module middleware imports.** All shared middleware lives in `src/shared/middleware/`. Modules SHALL NOT import from other modules' `middleware/` directories.

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
| **v5.10** | **2026-03-05** | **三維修正：(1) DB Bootstrap Fix — feature_flags UNIQUE 修復, seed 欄位清理, RLS Admin Bypass, dispatch_commands RLS, bootstrap.sh; (2) Architecture Boundary Fix — tenant-context 遷移至 Shared Layer, M4/M8 import 修正; (3) BFF De-hardcoding — dispatch KPIs from DB, API Gap Analysis** |
