# Module 1: IoT & Telemetry Hub

> **模組版本**: v5.11
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.11.md](./00_MASTER_ARCHITECTURE_v5.11.md)
> **前版文件**: [01_IOT_HUB_MODULE_v5.8.md](./01_IOT_HUB_MODULE_v5.8.md)
> **最後更新**: 2026-03-05
> **說明**: v5.8 全部內容不變（MQTT 接入、動態解析器、Asset Shadow、Telemetry Ingestion、Hourly Aggregator）。v5.11 新增：Dual Pool 切換 — telemetry-webhook + telemetry-aggregator 改用 Service Pool。

---

## v5.11 升版說明

### 問題陳述

v5.10 設計了雙角色 DB 架構（`solfacil_app` + `solfacil_service` BYPASSRLS），但 M1 的兩個 DB-facing 組件仍使用單一 `getPool()` 連線池（`solfacil_app` 角色）：

1. **`telemetry-webhook.ts`** — 接收硬體遙測數據，寫入 `telemetry_history` + UPSERT `device_state`
2. **`telemetry-aggregator.ts`** — 定時讀取 `telemetry_history`，寫入 `asset_hourly_metrics`

**問題：M1 沒有 user JWT token。** 遙測數據來自硬體設備（MQTT / REST webhook），不經過使用者認證流程。若 M1 使用 `solfacil_app` 角色（RLS enforced），所有對 `telemetry_history`、`device_state`、`assets` 等表的讀寫都會被 RLS 阻擋——因為沒有設定 `app.current_org_id`。

### 受影響的組件

| 組件 | 文件 | DB 操作 | 需要 Service Pool 的原因 |
|------|------|---------|------------------------|
| **Telemetry Webhook** | `src/iot-hub/handlers/telemetry-webhook.ts` | `INSERT telemetry_history` + `UPSERT device_state` | 硬體數據無 JWT，無法設定 RLS org context |
| **Telemetry Aggregator** | `src/iot-hub/services/telemetry-aggregator.ts` | `SELECT telemetry_history` + `UPSERT asset_hourly_metrics` | Cron job 需跨租戶聚合所有 assets 的遙測數據 |

### 不受影響的組件

| 組件 | 文件 | 說明 |
|------|------|------|
| `ingest-telemetry.ts` | `src/iot-hub/handlers/ingest-telemetry.ts` | Lambda handler，使用 Timestream + EventBridge（無 PostgreSQL 存取） |
| `schedule-to-shadow.ts` | `src/iot-hub/handlers/schedule-to-shadow.ts` | 骨架代碼，無 DB 操作 |
| `parsers/*` | `src/iot-hub/parsers/*.ts` | 純函數解析器，無 DB 操作 |

---

## 1. Pool 切換設計

### 1.1 telemetry-webhook.ts — Service Pool

```typescript
// v5.10 (current code):
export function createTelemetryWebhookHandler(pool: Pool) { ... }
// ↑ pool = getPool() = solfacil_app → RLS blocks writes without org context

// v5.11 (no code change needed in this file):
// The function signature already accepts pool injection.
// Change is in local-server.ts:
//   BEFORE: createTelemetryWebhookHandler(pool)        // pool = getPool()
//   AFTER:  createTelemetryWebhookHandler(servicePool)  // servicePool = getServicePool()
```

**DB 操作分析：**

| 操作 | 表 | 有 RLS？ | 有 `org_id`？ | Service Pool 影響 |
|------|-----|----------|-------------|-----------------|
| `INSERT INTO telemetry_history` | `telemetry_history` | 有 | 有（透過 asset_id FK） | BYPASSRLS：直接寫入，不需設定 org context |
| `UPSERT device_state` | `device_state` | 有 | 有（透過 asset_id FK） | BYPASSRLS：直接寫入 |

### 1.2 telemetry-aggregator.ts — Service Pool

```typescript
// v5.10 (current code):
export function startTelemetryAggregator(pool: Pool): void { ... }
export async function runHourlyAggregation(pool: Pool): Promise<void> { ... }
// ↑ pool = getPool() = solfacil_app → RLS filters SELECT to empty result (no org context)

// v5.11 (no code change needed in this file):
// Change is in local-server.ts:
//   BEFORE: startTelemetryAggregator(pool)
//   AFTER:  startTelemetryAggregator(servicePool)
```

**DB 操作分析：**

| 操作 | 表 | 有 RLS？ | Service Pool 影響 |
|------|-----|----------|-----------------|
| `SELECT FROM telemetry_history GROUP BY asset_id` | `telemetry_history` | 有 | BYPASSRLS：讀取所有租戶的遙測數據 |
| `UPSERT asset_hourly_metrics` | `asset_hourly_metrics` | 有 | BYPASSRLS：寫入所有租戶的匯總 |

### 1.3 鐵律

> **⚠️ M1 的 DB-facing 組件嚴禁使用 `queryWithOrg()`。**
> M1 處理硬體遙測數據，沒有使用者認證上下文。直接使用 Service Pool 的 `pool.query()` 即可。
> 在 Service Pool（`solfacil_service` BYPASSRLS）上呼叫 `set_config('app.current_org_id', ...)` 是 no-op，會產生安全假象。

---

## 2. local-server.ts 變更（M1 相關部分）

```typescript
// v5.11: M1 handlers use service pool
import { getAppPool, getServicePool } from "../src/shared/db";

const servicePool = getServicePool();

// M1 telemetry webhook — hardware data, no JWT
app.post("/api/telemetry/mock", createTelemetryWebhookHandler(servicePool));

// M1 hourly aggregator cron — cross-tenant aggregation
startTelemetryAggregator(servicePool);
```

---

## 3. 測試影響

| 測試文件 | Pool 變更 | Teardown |
|---------|----------|---------|
| `test/iot-hub/telemetry-webhook.test.ts` | `getPool()` → `getServicePool()` | `closePool()` → `closeAllPools()` |
| `test/iot-hub/telemetry-aggregator.test.ts` | `getPool()` → `getServicePool()` | `closePool()` → `closeAllPools()` |
| `test/iot-hub/ingest-telemetry.test.ts` | 不變（無 PostgreSQL） | 不變 |
| `test/iot-hub/DynamicAdapter.test.ts` | 不變（純函數） | 不變 |

---

## 4. v5.8 內容（不變）

以下章節完整保留自 `01_IOT_HUB_MODULE_v5.8.md`，不重複：

- §1 模組職責
- §2 CDK Stack
- §3 EventBridge Integration
- §4 StandardTelemetry v5.2
- §5 AppConfig Parser Rules
- §6 Translation Executor
- §7 Multi-Device Array Iteration
- §8 Graceful Fallback
- §9 Dual Ingestion Channels
- §10 Device Shadow Schema & Schedule Sync
- § Telemetry Ingestion Handler (v5.8)
- § Hourly Aggregator Job (v5.8)
- §11 Timestream Table Schema
- §12 org_id Integration
- §13 Lambda Handlers

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-25 | 初始版本：MQTT 接入、動態解析器、Multi-Device Array、Asset Shadow |
| v5.3 | 2026-02-27 | HEMS 單戶場景：capacity_kwh 取代 unidades，Device Shadow schema 更新 |
| v5.8 | 2026-03-02 | Telemetry Feedback Loop：新增 Telemetry Ingestion Handler + Hourly Aggregator Job |
| **v5.11** | **2026-03-05** | **Dual Pool Switch: (1) `telemetry-webhook.ts` 改用 service pool — 硬體數據無 JWT，RLS 會阻擋寫入; (2) `telemetry-aggregator.ts` 改用 service pool — cron job 跨租戶聚合; (3) 嚴禁 M1 DB-facing 組件使用 `queryWithOrg()`; (4) 測試 teardown 統一使用 `closeAllPools()`** |

---

## 模組依賴關係

| 方向 | 模組 | 說明 |
|------|------|------|
| **依賴** | Shared Layer (v5.11) | `getServicePool()` — Dual Pool Factory |
| **依賴** | M8 (Admin Control) | AppConfig `vpp-m1-parser-rules` 讀取解析規則 |
| **被依賴** | M2 (Optimization Engine) | 消費 `TelemetryReceived` 事件 |
| **被依賴** | M3 (DR Dispatcher) | Device Shadow 寫入（接收 `ScheduleGenerated`） |
| **被依賴** | M4 (Market & Billing) | **v5.8: 讀取 `asset_hourly_metrics` (Data Contract) 進行財務結算** |
| **被依賴** | M5 (BFF) | Timestream 查詢遙測數據 |
| **被依賴** | M7 (Open API) | 消費 `AlertTriggered` 事件 → webhook |
