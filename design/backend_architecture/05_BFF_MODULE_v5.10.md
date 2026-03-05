# Module 5: Frontend BFF (Backend-for-Frontend)

> **模組版本**: v5.10
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.10.md](./00_MASTER_ARCHITECTURE_v5.10.md)
> **最後更新**: 2026-03-05
> **說明**: 聚合後端數據，為前端 Admin UI 提供統一 REST API（Cognito 授權、租戶隔離）、De-hardcoding、
> **v5.10: middleware 遷移至 Shared Layer、dispatch KPI de-hardcoding、API Gap Analysis**

---

## 1. 模組職責

M5 BFF 是前端 Dashboard 的唯一 API 入口。職責：

- 聚合 M1（遙測）、M2（策略）、M3（調度）、M4（計費）的數據為統一 REST 回應
- Cognito JWT 認證 + RBAC 角色鑑權
- `extractTenantContext()` 中間件確保所有查詢都帶 `org_id` 過濾（**v5.10: 從 Shared Layer import**）
- 發佈 `DRCommandIssued` 事件觸發 M3 調度

---

## § v5.10 變更一：Middleware 遷移至 Shared Layer

### 問題陳述

`src/bff/middleware/tenant-context.ts` 包含 `extractTenantContext`、`requireRole`、`apiError` 三個函數。
M4 和 M8 跨界 import 了此文件，違反 DDD 邊界。

### 修正

1. **移動**：將 `src/bff/middleware/tenant-context.ts` 的內容遷移至 `src/shared/middleware/tenant-context.ts`
2. **刪除**：刪除 `src/bff/middleware/tenant-context.ts`
3. **更新 BFF import**：BFF 所有 handler 改為從 `../../shared/middleware/tenant-context` import

### BFF Handler Import 變更

| Handler 文件 | 舊 import (v5.9) | 新 import (v5.10) |
|-------------|------------------|-------------------|
| `get-dashboard.ts` | `../middleware/tenant-context` | `../../shared/middleware/tenant-context` |
| `get-assets.ts` | `../middleware/tenant-context` | `../../shared/middleware/tenant-context` |
| `get-trades.ts` | `../middleware/tenant-context` | `../../shared/middleware/tenant-context` |
| `get-revenue-trend.ts` | `../middleware/tenant-context` | `../../shared/middleware/tenant-context` |
| `post-dispatch.ts` | `../middleware/tenant-context` | `../../shared/middleware/tenant-context` |
| `post-dr-test.ts` | `../middleware/tenant-context` | `../../shared/middleware/tenant-context` |
| `get-dispatch-status.ts` | `../middleware/tenant-context` | `../../shared/middleware/tenant-context` |

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
│   ├── cors.ts                   # CORS headers
│   └── rate-limit.ts             # API throttling
│   # NOTE: tenant-context.ts DELETED in v5.10 (moved to src/shared/middleware/)
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
| **v5.10** | **2026-03-05** | **(1) middleware/tenant-context.ts 遷移至 Shared Layer，BFF 原檔刪除; (2) get-dashboard.ts dispatch KPIs (156/160) de-hardcoding 完成; (3) API Gap Analysis: frontend-v2 完全使用 mock 數據，與後端 API 零整合** |

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
| **依賴** | Shared Layer | **v5.10: import `shared/middleware/tenant-context`（原在本模組內部）** |
| **被依賴** | Frontend Dashboard | 唯一 API 消費者 |
