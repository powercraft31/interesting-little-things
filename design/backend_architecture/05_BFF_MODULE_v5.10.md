# Module 5: Frontend BFF (Backend-for-Frontend)

> **模組版本**: v5.10
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.10.md](./00_MASTER_ARCHITECTURE_v5.10.md)
> **最後更新**: 2026-03-05
> **說明**: 聚合後端數據，為前端 Admin UI 提供統一 REST API（Cognito 授權、租戶隔離）、De-hardcoding、
> **v5.10: HTTP 適配器模式（extractTenantContext 保留在 BFF，調用 Shared Layer 的 verifyTenantToken 純函數）、dispatch KPI de-hardcoding、API Gap Analysis**

---

## 1. 模組職責

M5 BFF 是前端 Dashboard 的唯一 API 入口。職責：

- 聚合 M1（遙測）、M2（策略）、M3（調度）、M4（計費）的數據為統一 REST 回應
- Cognito JWT 認證 + RBAC 角色鑑權
- `extractTenantContext()` 中間件確保所有查詢都帶 `org_id` 過濾（**v5.10: BFF 內部 HTTP 適配器，調用 Shared Layer 的 `verifyTenantToken` 純函數**）
- 發佈 `DRCommandIssued` 事件觸發 M3 調度

---

## § v5.10 變更一：HTTP 適配器模式（Shared Layer / BFF 責任分離）

### 問題陳述

`src/bff/middleware/tenant-context.ts` 包含 `extractTenantContext`、`requireRole`、`apiError` 三個函數。
M4 和 M8 跨界 import 了此文件，違反 DDD 邊界。

**更深層的問題**：直接將 `extractTenantContext(event: APIGatewayProxyEventV2)` 移入 Shared Layer
會引入 `aws-lambda` 類型依賴，污染 Shared Layer 的框架中立性。

### 修正：兩層模式

| 層 | 函數 | 職責 | 框架依賴 |
|---|------|------|---------|
| **Shared Layer** | `verifyTenantToken(token: string)` | 純域邏輯：解析 token → TenantContext | **無** |
| **Shared Layer** | `requireRole(ctx, roles)` | 純域邏輯：RBAC 角色檢查 | **無** |
| **BFF Layer** | `extractTenantContext(event)` | HTTP 適配器：從 event.headers 提取 token，調用 `verifyTenantToken` | `aws-lambda` |
| **BFF Layer** | `apiError(statusCode, message)` | HTTP 回應建構器：構建 API Gateway 錯誤回應 | `aws-lambda` |

### BFF HTTP 適配器設計

```typescript
// src/bff/middleware/auth.ts (BFF 內部，不在 Shared Layer)
// 這是 HTTP 適配器，調用 Shared Layer 的純函數

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { verifyTenantToken } from '../../shared/middleware/tenant-context';
import type { TenantContext } from '../../shared/types/auth';
import { fail } from '../../shared/types/api';

/**
 * HTTP 適配器：從 API Gateway event 提取 Authorization header，
 * 委託給 Shared Layer 的 verifyTenantToken 純函數。
 */
export function extractTenantContext(event: APIGatewayProxyEventV2): TenantContext {
  const token = event.headers?.['authorization'] ?? event.headers?.['Authorization'] ?? '';
  return verifyTenantToken(token);  // ← 調用 Shared Layer 純函數
}

/**
 * 構建標準 API Gateway 錯誤回應。
 * 僅在 BFF 使用 — 不進入 Shared Layer。
 */
export function apiError(statusCode: number, message: string): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fail(message)),
  };
}
```

### 設計決策摘要

| 決策 | 說明 |
|------|------|
| `verifyTenantToken()` 在 Shared Layer | 純函數，可測試，零框架依賴。M4、M8 直接調用。 |
| `extractTenantContext()` 在 BFF | HTTP 適配器，從 headers 提取 token。BFF handlers 調用。 |
| `apiError()` 在 BFF | 構建 HTTP 回應物件，僅 BFF 需要。 |
| M4、M8 調用 `verifyTenantToken()` | 從 Shared Layer import，不依賴 BFF。各模組自行從 event 提取 token。 |
| `requireRole()` 在 Shared Layer | 純域邏輯，所有模組均可使用。 |

### BFF Handler Import 變更

| Handler 文件 | 舊 import (v5.9) | 新 import (v5.10) |
|-------------|------------------|-------------------|
| `get-dashboard.ts` | `../middleware/tenant-context` | `../middleware/auth` |
| `get-assets.ts` | `../middleware/tenant-context` | `../middleware/auth` |
| `get-trades.ts` | `../middleware/tenant-context` | `../middleware/auth` |
| `get-revenue-trend.ts` | `../middleware/tenant-context` | `../middleware/auth` |
| `post-dispatch.ts` | `../middleware/tenant-context` | `../middleware/auth` |
| `post-dr-test.ts` | `../middleware/tenant-context` | `../middleware/auth` |
| `get-dispatch-status.ts` | `../middleware/tenant-context` | `../middleware/auth` |

### M4 / M8 Handler Import 變更

| Handler 文件 | 舊 import (v5.9) | 新 import (v5.10) |
|-------------|------------------|-------------------|
| M4 `get-tariff-schedule.ts` | `../../bff/middleware/tenant-context` | `../../shared/middleware/tenant-context` (import `verifyTenantToken`) |
| M8 `get-parser-rules.ts` | `../../bff/middleware/tenant-context` | `../../shared/middleware/tenant-context` (import `verifyTenantToken`) |
| M8 `create-parser-rule.ts` | `../../bff/middleware/tenant-context` | `../../shared/middleware/tenant-context` (import `verifyTenantToken`) |
| M8 `get-vpp-strategies.ts` | `../../bff/middleware/tenant-context` | `../../shared/middleware/tenant-context` (import `verifyTenantToken`) |
| M8 `update-vpp-strategy.ts` | `../../bff/middleware/tenant-context` | `../../shared/middleware/tenant-context` (import `verifyTenantToken`) |

---

## § v5.10 變更二：get-dashboard.ts Dispatch KPI De-hardcoding

### 問題陳述

v5.9 設計要求 `get-dashboard.ts` 的 `dispatchSuccessCount`、`dispatchTotalCount`、`dispatchSuccessRate`
從 `dispatch_commands` 表查詢，但代碼仍保留硬編碼值：

```typescript
// ❌ 仍然硬編碼（v5.9 未完成的 de-hardcoding）
dispatchSuccessCount: 156,
dispatchTotalCount: 160,
dispatchSuccessRate: "156/160",
```

### 修正 — DB-sourced Dispatch KPIs

**SQL 查詢（單一查詢取得成功/總數）：**

```sql
-- v5.10: 從 dispatch_commands 計算調度成功率
SELECT
  COUNT(*) FILTER (WHERE status = 'completed') AS success_count,
  COUNT(*) AS total_count
FROM dispatch_commands
WHERE dispatched_at >= CURRENT_DATE;
```

**TypeScript 實作：**

```typescript
// v5.10: DB-sourced dispatch KPIs (was hardcoded 156/160)
const dispatchResult = await pool.query(`
  SELECT
    COUNT(*) FILTER (WHERE status = 'completed') AS success_count,
    COUNT(*) AS total_count
  FROM dispatch_commands
  WHERE dispatched_at >= CURRENT_DATE
`);
const dispatchSuccessCount = Number(dispatchResult.rows[0]?.success_count ?? 0);
const dispatchTotalCount = Number(dispatchResult.rows[0]?.total_count ?? 0);
const dispatchSuccessRate = `${dispatchSuccessCount}/${dispatchTotalCount}`;
```

---

## § v5.10 變更三：API Gap Analysis (Frontend-v2)

### 分析方法

掃描 `frontend-v2/js/` 目錄下所有 11 個 JavaScript 文件，搜尋 `fetch()`、API URL、
endpoint 引用等模式。

### 分析結果

**frontend-v2 目前使用純 Mock 數據，不包含任何 API 調用。** 所有數據來源為：

- `mock-data.js` 中的靜態物件（DEVICES、HOMES、FLEET、VPP_CAPACITY 等）
- `app.js` 中的 `DemoStore`（sessionStorage 本地狀態管理）

### 前端數據結構 → 對應 BFF API 需求

根據 frontend-v2 各頁面使用的 Mock 數據結構，以下為未來 API 化所需的端點清單：

| 前端頁面 | Mock 數據物件 | 對應 BFF API（待建） | 當前後端狀態 |
|---------|-------------|---------------------|-------------|
| P1 Fleet (p1-fleet.js) | `FLEET`, `DEVICES` | `GET /fleet/overview` | **不存在** |
| P1 Fleet (p1-fleet.js) | `INTEGRADORES` | `GET /integrators` | **不存在** |
| P2 Devices (p2-devices.js) | `DEVICES`, `UNASSIGNED_DEVICES` | `GET /devices`, `GET /devices/unassigned` | **不存在** |
| P2 Devices (p2-devices.js) | `COMMISSIONING_HISTORY` | `GET /devices/commissioning-history` | **不存在** |
| P3 Energy (p3-energy.js) | `HOMES` | `GET /homes`, `GET /homes/:id/energy` | **不存在** |
| P4 HEMS (p4-hems.js) | `HOMES`, `SAVINGS_BY_HOME` | `GET /hems/optimization`, `GET /hems/savings` | **不存在** |
| P5 VPP (p5-vpp.js) | `VPP_CAPACITY`, `DR_EVENTS`, `LATENCY_TIERS` | `GET /vpp/capacity`, `GET /vpp/dr-events`, `GET /vpp/latency` | **不存在** |
| P6 Performance (p6-performance.js) | `SCORECARD` | `GET /performance/scorecard` | **不存在** |

### 現有後端 BFF API（4 個 GET 端點）

| Method | Path | 來源 | 前端使用者 |
|--------|------|------|-----------|
| GET | `/dashboard` | get-dashboard.ts | 無（frontend-v2 未調用） |
| GET | `/assets` | get-assets.ts | 無（frontend-v2 未調用） |
| GET | `/revenue-trend` | get-revenue-trend.ts | 無（frontend-v2 未調用） |
| GET | `/trades` | get-trades.ts | 無（frontend-v2 未調用） |

### 差距總結

- **後端現有**: 4 個 BFF API 端點
- **前端 Mock 使用**: 8+ 個資料物件跨 6 個頁面
- **Gap**: frontend-v2 與後端 BFF API 之間**零整合**。前端完全依賴 mock 數據，後端 API 未被前端調用。
- **建議**: v6.0 應優先整合 P1 Fleet + P2 Devices 頁面，因為數據結構最接近現有 `GET /assets` 端點。

---

## 4. API Routes

| Method | Path | Min Role | Tenant Scoping |
|--------|------|----------|----------------|
| `GET` | `/dashboard` | ORG_VIEWER | Scoped to `org_id` |
| `GET` | `/assets` | ORG_VIEWER | Scoped to `org_id` |
| `GET` | `/assets/{id}` | ORG_VIEWER | Verify asset belongs to `org_id` |
| `GET` | `/assets/{id}/analytics` | ORG_VIEWER | Verify asset belongs to `org_id` |
| `GET` | `/trades` | ORG_VIEWER | Scoped to `org_id` |
| `GET` | `/revenue/trend` | ORG_VIEWER | Scoped to `org_id` |
| `GET` | `/revenue/breakdown` | ORG_VIEWER | Scoped to `org_id` |
| `POST` | `/dispatch` | ORG_OPERATOR | Verify all `assetIds` belong to `org_id` |
| `POST` | `/dr-test` | ORG_OPERATOR | Scoped to `org_id` assets |
| `GET` | `/dispatch/{id}` | ORG_OPERATOR | Verify dispatch belongs to `org_id` |
| `GET` | `/algorithm/kpis` | ORG_VIEWER | Scoped to `org_id` |
| `GET` | `/tariffs/current` | ORG_VIEWER | Scoped to `org_id` |
| `PUT` | `/tariffs/{id}` | ORG_MANAGER | Verify tariff belongs to `org_id` |
| `GET` | `/organizations` | SOLFACIL_ADMIN | No scoping (admin only) |
| `POST` | `/organizations` | SOLFACIL_ADMIN | No scoping (admin only) |
| `GET` | `/users` | ORG_MANAGER | Scoped to `org_id` |
| `POST` | `/users` | ORG_MANAGER | User created in caller's `org_id` |

---

## 9. Lambda Handlers (v5.10 更新)

```
src/bff/
├── handlers/
│   ├── get-dashboard.ts          # GET /dashboard — v5.10: dispatch KPIs from DB (was hardcoded)
│   ├── get-assets.ts             # GET /assets — v5.9: vpp_strategies JOIN
│   ├── get-asset-detail.ts       # GET /assets/:id
│   ├── get-trades.ts             # GET /trades — v5.5: from trade_schedules
│   ├── post-dispatch.ts          # POST /dispatch
│   ├── post-dr-test.ts           # POST /dr-test
│   ├── get-dispatch-status.ts    # GET /dispatch/:id
│   └── get-revenue-trend.ts      # GET /revenue/trend — v5.5: dual-track
├── middleware/
│   ├── auth.ts                   # v5.10: HTTP adapter (extractTenantContext → verifyTenantToken, apiError)
│   ├── cors.ts                   # CORS headers
│   └── rate-limit.ts             # API throttling
│   # NOTE: tenant-context.ts REPLACED by auth.ts in v5.10
└── __tests__/
    ├── get-dashboard.test.ts     # v5.10: dispatch KPI tests updated
    ├── get-assets.test.ts
    └── post-dispatch.test.ts
```

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | 初始版本 |
| v5.3 | 2026-02-27 | HEMS 單戶場景對齊，capacity_kwh |
| v5.5 | 2026-02-28 | BFF 淨化行動：移除 hardcode，改為 SQL 讀取 trade_schedules / revenue_daily / algorithm_metrics |
| v5.9 | 2026-03-02 | De-hardcoding: vpp_strategies JOIN, dashboard KPI from DB |
| **v5.10** | **2026-03-05** | **(1) HTTP 適配器模式：extractTenantContext + apiError 保留在 BFF (auth.ts)，調用 Shared Layer 的 verifyTenantToken 純函數；M4/M8 直接 import verifyTenantToken; (2) get-dashboard.ts dispatch KPIs (156/160) de-hardcoding 完成; (3) API Gap Analysis: frontend-v2 完全使用 mock 數據，與後端 API 零整合** |

---

## 模組依賴關係

| 方向 | 模組 | 說明 |
|------|------|------|
| **依賴** | M1 (IoT Hub) | Timestream 查詢遙測數據 |
| **依賴** | M2 (Optimization Engine) | 讀取策略 KPI |
| **依賴** | M3 (DR Dispatcher) | 發佈 DRCommandIssued、查詢調度結果；**v5.10: 讀取 dispatch_commands 計算 KPI** |
| **依賴** | M4 (Market & Billing) | PostgreSQL 查詢收益/電價 |
| **依賴** | M6 (Identity) | Cognito Authorizer、JWT 驗證 |
| **依賴** | M8 (Admin Control) | AppConfig feature-flags 讀取；vpp_strategies JOIN |
| **依賴** | Shared Layer | **v5.10: BFF `auth.ts` 調用 `shared/middleware/tenant-context` 的 `verifyTenantToken` 純函數** |
| **被依賴** | Frontend Dashboard | 唯一 API 消費者 |
