# Shared Layer — 公共型別定義與 API 契約

> **模組版本**: v5.10
> **變更**: v5.10 — 新增 `src/shared/middleware/tenant-context.ts`，提供純函數 `verifyTenantToken`、`requireRole`（零框架依賴）。
> `extractTenantContext`（HTTP 適配器）和 `apiError`（HTTP 回應建構器）保留在 BFF 層。
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.10.md](./00_MASTER_ARCHITECTURE_v5.10.md)
> **最後更新**: 2026-03-05
> **說明**: 公共 TypeScript 型別定義、API 契約、EventSchema、目錄結構、全局資料隔離策略、**Shared Middleware（純函數，零框架依賴）**

---

## 1. Global Data Isolation Strategy

### First Principle: `org_id` Is a First-Class Citizen

Every data record carries an `org_id` field. This is the **#1 architectural invariant**.

```
org_id = Organization ID (e.g., "ORG_ENERGIA_001")
         Assigned at user creation time (Cognito custom:org_id)
         Immutable per user
         Mandatory in every:
           ├─ PostgreSQL row (RLS-enforced)
           ├─ MQTT topic path segment
           ├─ EventBridge event detail
           └─ Lambda handler context (TenantContext)
```

### PostgreSQL RLS Pattern

```sql
-- BFF handlers (solfacil_app role): middleware sets org_id
-- SET app.current_org_id = 'ORG_ENERGIA_001'
CREATE POLICY tenant_isolation ON {table}
  USING (org_id = current_setting('app.current_org_id', true));

-- v5.10: Cron jobs use solfacil_service role (BYPASSRLS attribute)
-- No admin bypass policy needed — PostgreSQL BYPASSRLS is explicit and auditable.
-- See 10_DATABASE_SCHEMA_v5.10.md §RLS.1 for role definitions.
```

---

## 2. Shared Middleware (v5.10 新增)

### 2.0 背景與動機

v5.9 代碼中，`extractTenantContext`、`requireRole`、`apiError` 三個函數位於 `src/bff/middleware/tenant-context.ts`。
M4 Market & Billing 和 M8 Admin Control 均跨界 import 了 BFF 的 middleware，違反限界上下文原則。

**v5.10 設計原則：Shared Layer 必須是純域邏輯，零框架依賴。**

`extractTenantContext(event: APIGatewayProxyEventV2)` 直接依賴 `aws-lambda` 類型（HTTP/雲框架概念），
`apiError()` 構建 HTTP 回應物件 — 兩者都不應進入 Shared Layer。

v5.10 採用**兩層模式**：
- **Shared Layer**：導出純函數 `verifyTenantToken(token: string)` 和 `requireRole(ctx, roles)` — 零框架 import
- **BFF Layer**：保留 HTTP 適配器 `extractTenantContext(event)` 和 `apiError()` — 從 HTTP event 提取 token，調用 Shared Layer 純函數

### 2.1 模組路徑

```
src/shared/middleware/tenant-context.ts    ← v5.10 新增（純函數，零框架依賴）
src/bff/middleware/auth.ts                 ← v5.10 重構（HTTP 適配器，調用 Shared Layer）
```

### 2.2 Shared Layer 導出契約（純函數）

```typescript
// src/shared/middleware/tenant-context.ts
// ⚠️ 注意：此文件不得 import 任何 HTTP/雲框架類型
//    （不可 import APIGatewayProxyEventV2、Request、Response 等）

import { Role, type TenantContext } from '../types/auth';

const VALID_ROLES = new Set<string>(Object.values(Role));

/**
 * 驗證租戶 token 並返回 TenantContext。
 * 純函數：接受原始 token 字串，不涉及 HTTP 概念。
 *
 * 支援兩種格式：
 *   1. 原始 JSON 字串：{"userId":"u1","orgId":"ORG_ENERGIA_001","role":"ORG_MANAGER"}
 *   2. JWT 風格令牌：header.payload.signature（payload 為 Base64 編碼的 JSON）
 *
 * 失敗時拋出 { statusCode, message }。
 */
export function verifyTenantToken(token: string): TenantContext {
  if (!token) {
    throw { statusCode: 401, message: 'Unauthorized' };
  }

  let claims: Record<string, unknown>;

  try {
    if (token.trim().startsWith('{')) {
      claims = JSON.parse(token);
    } else {
      const parts = token.replace(/^Bearer\s+/i, '').split('.');
      if (parts.length < 2) {
        throw new Error('malformed token');
      }
      const payload = Buffer.from(parts[1], 'base64').toString('utf-8');
      claims = JSON.parse(payload);
    }
  } catch {
    throw { statusCode: 401, message: 'Invalid token' };
  }

  const { userId, orgId, role } = claims as { userId?: string; orgId?: string; role?: string };

  if (!userId || !orgId || !role || !VALID_ROLES.has(role)) {
    throw { statusCode: 401, message: 'Invalid token' };
  }

  return { userId, orgId, role: role as Role };
}

/**
 * 強制執行 RBAC 角色檢查。
 * SOLFACIL_ADMIN 跳過所有角色檢查。
 * 失敗時拋出 { statusCode: 403, message: "Forbidden" }。
 */
export function requireRole(ctx: TenantContext, allowedRoles: Role[]): void {
  if (ctx.role === Role.SOLFACIL_ADMIN) return;
  if (!allowedRoles.includes(ctx.role)) {
    throw { statusCode: 403, message: 'Forbidden' };
  }
}
```

### 2.3 依賴的 Shared Types

```typescript
// src/shared/types/auth.ts — 已存在，不變
export enum Role {
  SOLFACIL_ADMIN = 'SOLFACIL_ADMIN',
  ORG_MANAGER = 'ORG_MANAGER',
  ORG_OPERATOR = 'ORG_OPERATOR',
  ORG_VIEWER = 'ORG_VIEWER',
}

export interface TenantContext {
  readonly userId: string;
  readonly orgId: string;
  readonly role: Role;
}
```

```typescript
// src/shared/types/api.ts — 已存在，不變
export function fail(message: string): { success: false; error: string };
```

### 2.4 消費模組 Import 路徑對照

| 消費模組 | 需要的函數 | import 來源 (v5.10) |
|---------|-----------|-------------------|
| M4 Market & Billing | `verifyTenantToken`, `requireRole` | `../../shared/middleware/tenant-context` |
| M5 BFF handlers | `extractTenantContext`, `apiError` | `../middleware/auth`（BFF 內部 HTTP 適配器） |
| M8 Admin Control | `verifyTenantToken`, `requireRole` | `../../shared/middleware/tenant-context` |

> **關鍵區別**：
> - M4、M8 直接調用 Shared Layer 的 `verifyTenantToken(token)` — 從各自的 HTTP event/request 中提取 token 後傳入
> - M5 BFF 使用自己的 HTTP 適配器 `extractTenantContext(event)` — 內部調用 `verifyTenantToken`
> - `apiError()` 構建 HTTP 回應物件，僅在 BFF 層使用，不進入 Shared Layer

### 2.5 BFF 原檔案處置

`src/bff/middleware/tenant-context.ts` 在 v5.10 中**重構為** `src/bff/middleware/auth.ts`。
新文件是 HTTP 適配器，調用 Shared Layer 的 `verifyTenantToken` 純函數。
詳見 `05_BFF_MODULE_v5.10.md` 的 HTTP 適配器設計。

---

## 3. Core TypeScript Interfaces

### 3.1 StandardTelemetry (v5.2 — Dynamic Schema Envelope)

```typescript
// src/iot-hub/contracts/standard-telemetry.ts
export interface StandardTelemetry {
  readonly deviceId: string;
  readonly orgId: string;
  readonly timestamp: string;
  readonly traceId: string;
  readonly metering: Record<string, number>;
  readonly status:   Record<string, string | number | boolean>;
  readonly config:   Record<string, string | number | boolean>;
}
```

### 3.2 VppEvent — EventBridge Event Envelope

```typescript
// src/shared/types/events.ts
export interface VppEvent<T> {
  readonly source: string;
  readonly detailType: string;
  readonly detail: T & { readonly org_id: string };
  readonly timestamp: string;
}
```

### 3.3 TenantContext — Auth / Middleware

```typescript
// src/shared/types/auth.ts (unchanged)
// src/shared/middleware/tenant-context.ts (v5.10: pure functions — verifyTenantToken, requireRole)
// See §2 above for full contract
```

### 3.4 AssetRecord (v5.3)

```typescript
// src/shared/types/asset.ts — unchanged from v5.5
export interface AssetRecord {
  readonly assetId: string;
  readonly orgId: string;
  readonly region: string;
  readonly capacidade_kw: number;
  readonly capacity_kwh: number;
  readonly operationalStatus: string;
  readonly metering: { /* ... */ };
  readonly status: { /* ... */ };
  readonly config: { /* ... */ };
}
```

### 3.5 TradeRecord (v5.5)

```typescript
// src/shared/types/trade.ts — unchanged
export interface TradeRecord {
  id: string;
  assetId: string;
  orgId: string;
  plannedTime: string;
  action: 'charge' | 'discharge' | 'idle';
  expectedVolumeKwh: number;
  targetPldPrice: number | null;
  createdAt: string;
}
```

### 3.6 DashboardKPI (v5.5 — 雙層結構)

```typescript
// src/shared/types/dashboard-kpi.ts — unchanged
export interface DashboardKPI {
  vppArbitrageProfit: number;
  vppArbitrageProfitMonthly: number;
  clientBillSavings: number;
  clientBillSavingsMonthly: number;
  selfConsumptionPct: number;
  totalAssetsOnline: number;
  totalAssetsOffline: number;
  totalEnergyDispatched: number;
}
```

---

## 4. API Contract — v5.5 雙層經濟模型說明

> **v5.5 雙層經濟模型說明**：所有財務數字嚴格區分 B端（SOLFACIL 批發市場收益，單位 R$/MWh）和 C端（客戶零售電費節省，單位 R$/kWh）。不得混用單位。

| 面向 | 單位 | 數據來源 | 說明 |
|------|------|---------|------|
| B端 SOLFACIL | R$/MWh | `pld_horario` | 批發市場套利收益，進 SOLFACIL 口袋 |
| C端 客戶 | R$/kWh | `assets.retail_buy_rate_kwh` | 零售電費節省，客戶看到的數字 |

---

## 5. Backend Directory Structure (v5.10 更新)

```
backend/
├── src/
│   ├── shared/
│   │   ├── db/
│   │   │   └── pool.ts                  # v5.4 PostgreSQL Connection Pool
│   │   ├── middleware/                    # v5.10 新增目錄
│   │   │   └── tenant-context.ts         # v5.10: 純函數（verifyTenantToken, requireRole）— 零框架依賴
│   │   ├── event-bridge-client.ts
│   │   ├── logger.ts
│   │   ├── middleware.ts
│   │   ├── errors.ts
│   │   └── types/
│   │       ├── asset.ts
│   │       ├── tariff.ts
│   │       ├── telemetry.ts
│   │       ├── events.ts
│   │       ├── trade.ts
│   │       ├── dashboard-kpi.ts
│   │       ├── auth.ts                   # TenantContext, Role enum
│   │       └── api.ts                    # ok(), fail() helpers
│   ├── iot-hub/                          # Module 1
│   ├── optimization-engine/              # Module 2
│   ├── dr-dispatcher/                    # Module 3
│   ├── market-billing/                   # Module 4 — v5.10: import verifyTenantToken from shared/middleware
│   ├── bff/                              # Module 5 — v5.10: middleware/auth.ts (HTTP adapter → shared verifyTenantToken)
│   ├── auth/                             # Module 6
│   ├── open-api/                         # Module 7
│   └── admin-control-plane/              # Module 8 — v5.10: import verifyTenantToken from shared/middleware
```

---

## 6. Database Connection Pool（v5.4 新增）

### 使用方式（v5.10: 雙連線池）

```typescript
// src/shared/db/pool.ts — v5.10 雙角色連線池
import { Pool } from 'pg';

// BFF handlers 使用 — solfacil_app 角色，強制 RLS
export const appPool = new Pool({
  connectionString: process.env.APP_DATABASE_URL,  // user=solfacil_app
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Cron Jobs (M2/M3/M4) 使用 — solfacil_service 角色，BYPASSRLS
export const servicePool = new Pool({
  connectionString: process.env.SERVICE_DATABASE_URL,  // user=solfacil_service
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// 向下相容：原有 pool export 指向 appPool
export const pool = appPool;

// BFF handler 使用方式
import { pool } from '../../shared/db/pool';
const result = await pool.query('SELECT * FROM assets WHERE org_id = $1', [orgId]);

// Cron Job 使用方式
import { servicePool } from '../../shared/db/pool';
const allOrgs = await servicePool.query('SELECT * FROM organizations');
```

### 鐵律：跨模組邊界

> ⚠️ **嚴禁跨模組直接 SQL JOIN**
>
> 每個業務模組只能查詢自己擁有的表（見 §10_DATABASE_SCHEMA 所有權清單）。
> 跨模組數據必須透過對方模組暴露的 Service function 或 API 呼叫取得。

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.3 | 2026-02-27 | 移除 unidades，新增 capacity_kwh，對齊 HEMS 單戶場景 |
| v5.4 | 2026-02-27 | 新增 Database Connection Pool 章節；PostgreSQL 取代 DynamoDB/Timestream |
| v5.5 | 2026-02-28 | TradeRecord 單位 R$/MWh 標示、DashboardKPI 雙層結構、雙層經濟模型 API 契約說明 |
| **v5.10** | **2026-03-05** | **新增 `src/shared/middleware/tenant-context.ts`：純函數 verifyTenantToken（零框架依賴）+ requireRole。extractTenantContext（HTTP 適配器）和 apiError（HTTP 回應）保留在 BFF 層。消除 Shared Layer 對 aws-lambda 類型的污染。** |

---

## 模組依賴關係

| 依賴方向 | 說明 |
|---------|------|
| **被依賴** | 所有模組文件引用本 Shared Layer 的型別定義 |
| **被依賴 (v5.10)** | M4、M8 import `shared/middleware/tenant-context` 的 `verifyTenantToken`；M5 BFF 透過 `bff/middleware/auth.ts` 間接調用 |
| **依賴** | [00_MASTER_ARCHITECTURE](./00_MASTER_ARCHITECTURE_v5.10.md)（上層文件） |
