# Shared Layer — 公共型別定義與 API 契約

> **模組版本**: v5.11
> **變更**: v5.11 — `src/shared/db.ts` 重構為 Dual Pool Factory，導出 `getAppPool()`、`getServicePool()`、`closeAllPools()`。
> `getPool()` 和 `queryWithOrg()` 保留向下相容（指向 app pool）。
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.11.md](./00_MASTER_ARCHITECTURE_v5.11.md)
> **最後更新**: 2026-03-05
> **說明**: 公共 TypeScript 型別定義、API 契約、**Dual Pool Factory**、全局資料隔離策略、Shared Middleware

---

## 1. Dual Pool Factory (v5.11 核心變更)

### 1.0 問題陳述

v5.10 設計了雙 DB 角色（`solfacil_app` + `solfacil_service`），但 `src/shared/db.ts` 只有一個 pool：

```typescript
// v5.10 現況（單一 pool）
const DATABASE_URL = process.env.DATABASE_URL ??
  "postgresql://solfacil_app:solfacil_vpp_2026@localhost:5432/solfacil_vpp";

let _pool: Pool | null = null;
export function getPool(): Pool { ... }
```

所有 cron jobs 都透過 `startXxx(pool)` 接收同一個 `solfacil_app` pool，無法跨租戶讀取數據。

### 1.1 設計方案

```typescript
// src/shared/db.ts — v5.11 Dual Pool Factory

import { Pool, type PoolClient } from "pg";

// ── Environment Variables ──────────────────────────────────────────────
// APP_DATABASE_URL:     user=solfacil_app     (RLS enforced)
// SERVICE_DATABASE_URL: user=solfacil_service  (BYPASSRLS)
//
// Fallback to single DATABASE_URL for backward compatibility.
// In local dev, both can point to the same URL if running as superuser (postgres).

const APP_DATABASE_URL =
  process.env.APP_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://solfacil_app:solfacil_vpp_2026@localhost:5432/solfacil_vpp";

const SERVICE_DATABASE_URL =
  process.env.SERVICE_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://solfacil_service:solfacil_vpp_service_2026@localhost:5432/solfacil_vpp";

// ── Singleton Pools ────────────────────────────────────────────────────

let _appPool: Pool | null = null;
let _servicePool: Pool | null = null;

/**
 * App Pool — connects as solfacil_app (RLS enforced).
 * Used by BFF handlers via queryWithOrg(), and ACK endpoint.
 * Callers MUST set app.current_org_id via SET LOCAL or queryWithOrg().
 */
export function getAppPool(): Pool {
  if (!_appPool) {
    _appPool = new Pool({
      connectionString: APP_DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    _appPool.on("error", (err) => {
      console.error("[DB AppPool] Unexpected error on idle client:", err);
    });
  }
  return _appPool;
}

/**
 * Service Pool — connects as solfacil_service (BYPASSRLS).
 * Used by cron jobs (M2/M3/M4/M1) that need cross-tenant data access.
 * No need to set app.current_org_id — RLS is bypassed.
 */
export function getServicePool(): Pool {
  if (!_servicePool) {
    _servicePool = new Pool({
      connectionString: SERVICE_DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    _servicePool.on("error", (err) => {
      console.error("[DB ServicePool] Unexpected error on idle client:", err);
    });
  }
  return _servicePool;
}

// ── Backward Compatibility ─────────────────────────────────────────────

/** @deprecated Use getAppPool() or getServicePool() explicitly. */
export function getPool(): Pool {
  return getAppPool();
}

// ── queryWithOrg (unchanged) ───────────────────────────────────────────

/**
 * Execute a read query with RLS org context.
 * Uses the app pool (solfacil_app role).
 */
export async function queryWithOrg<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[],
  orgId: string | null,
): Promise<{ rows: T[] }> {
  const pool = getAppPool();
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    if (orgId) {
      await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [orgId]);
    }
    const result = await client.query(sql, params);
    await client.query("COMMIT");
    return { rows: result.rows as T[] };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ── Pool Lifecycle ─────────────────────────────────────────────────────

/** Close all pools. Used for graceful shutdown and test teardown. */
export async function closeAllPools(): Promise<void> {
  const promises: Promise<void>[] = [];
  if (_appPool) {
    promises.push(_appPool.end());
    _appPool = null;
  }
  if (_servicePool) {
    promises.push(_servicePool.end());
    _servicePool = null;
  }
  await Promise.all(promises);
}

/** @deprecated Use closeAllPools(). Kept for backward compatibility. */
export async function closePool(): Promise<void> {
  return closeAllPools();
}
```

### 1.2 連線字串模式

| 環境變數 | 角色 | 用途 |
|---------|------|------|
| `APP_DATABASE_URL` | `solfacil_app` | BFF handlers, ACK endpoint |
| `SERVICE_DATABASE_URL` | `solfacil_service` | Cron jobs (M2/M3/M4/M1) |
| `DATABASE_URL` | Fallback | 向下相容：若專用變數未設定，兩個 pool 都 fallback 到此 |

**Local dev 模式（`scripts/local-server.ts`）：**

開發環境可能沒有獨立的 `solfacil_service` 角色。兩種策略：

1. **推薦**：在 local PostgreSQL 中建立雙角色（`bootstrap.sh` 已包含），設定兩個不同的 URL
2. **快速啟動**：只設定 `DATABASE_URL` 指向 superuser (`postgres`)，兩個 pool 都 fallback 到 superuser（superuser 天生 BYPASSRLS）

### 1.3 哪些模組使用哪個 Pool

| Pool | Module | File | Function |
|------|--------|------|----------|
| **App Pool** | M5 BFF | `src/bff/handlers/*.ts` | 透過 `queryWithOrg()` |
| **App Pool** | M3 ACK | `src/dr-dispatcher/handlers/collect-response.ts` | `createAckHandler(appPool)` |
| **App Pool** | M5 BFF | `src/bff/handlers/get-dashboard.ts` | `queryWithOrg()` |
| **Service Pool** | M2 | `src/optimization-engine/services/schedule-generator.ts` | `startScheduleGenerator(servicePool)` |
| **Service Pool** | M3 | `src/dr-dispatcher/services/command-dispatcher.ts` | `startCommandDispatcher(servicePool)` |
| **Service Pool** | M3 | `src/dr-dispatcher/handlers/timeout-checker.ts` | `startTimeoutChecker(servicePool)` |
| **Service Pool** | M4 | `src/market-billing/services/daily-billing-job.ts` | `startBillingJob(servicePool)` |
| **Service Pool** | M1 | `src/iot-hub/services/telemetry-aggregator.ts` | `startTelemetryAggregator(servicePool)` |

### 1.4 local-server.ts 啟動變更

```typescript
// scripts/local-server.ts — v5.11 dual pool startup

import { getAppPool, getServicePool } from "../src/shared/db";

// ── Dual Pools ─────────────────────────────────────────────────────────
const appPool = getAppPool();
const servicePool = getServicePool();

// ── BFF + HTTP endpoints use app pool ──────────────────────────────────
app.post("/api/telemetry/mock", createTelemetryWebhookHandler(servicePool));
app.post("/api/dispatch/ack", createAckHandler(appPool));

// ── Cron jobs use service pool ─────────────────────────────────────────
startScheduleGenerator(servicePool);    // M2
startCommandDispatcher(servicePool);    // M3
startTimeoutChecker(servicePool);       // M3
startBillingJob(servicePool);           // M4
startTelemetryAggregator(servicePool);  // M1
```

---

## 2. Shared Middleware (v5.10 — unchanged)

（與 v5.10 相同，不重複。參見 `09_SHARED_LAYER_v5.10.md` §2。）

---

## 3. Core TypeScript Interfaces

（與 v5.10 相同，不重複。）

---

## 4. API Contract

（與 v5.10 相同，不重複。）

---

## 5. Backend Directory Structure (v5.11 更新)

```
backend/
├── src/
│   ├── shared/
│   │   ├── db.ts                          # v5.11: Dual Pool Factory (getAppPool + getServicePool + closeAllPools)
│   │   ├── middleware/
│   │   │   └── tenant-context.ts          # v5.10: 純函數（verifyTenantToken, requireRole）
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
│   │       ├── auth.ts
│   │       └── api.ts
│   ├── iot-hub/                          # Module 1 — telemetry-aggregator uses service pool (v5.11)
│   ├── optimization-engine/              # Module 2 — schedule-generator uses service pool (v5.11)
│   ├── dr-dispatcher/                    # Module 3 — command-dispatcher + timeout-checker use service pool (v5.11)
│   ├── market-billing/                   # Module 4 — daily-billing-job uses service pool (v5.11)
│   ├── bff/                              # Module 5 — uses app pool (unchanged)
│   ├── auth/                             # Module 6
│   ├── open-api/                         # Module 7
│   └── admin-control-plane/              # Module 8
```

---

## 6. Database Connection Pool（v5.11: Dual Pool）

### 使用方式

```typescript
// ── BFF handler (app pool + RLS) ───────────────────────────────────────
import { queryWithOrg } from '../../shared/db';
const result = await queryWithOrg('SELECT * FROM assets', [], orgId);

// ── Cron job (service pool + BYPASSRLS) ────────────────────────────────
import { getServicePool } from '../../shared/db';
const pool = getServicePool();
const allAssets = await pool.query('SELECT * FROM assets WHERE is_active = true');
// ↑ No RLS filtering — reads ALL tenants' data
```

### 鐵律：跨模組邊界

> ⚠️ **嚴禁跨模組直接 SQL JOIN**（與 v5.10 相同）

### 鐵律：Pool 選擇 (v5.11 新增)

> ⚠️ **User-facing request handlers MUST use app pool (via `queryWithOrg`).**
> ⚠️ **Cron jobs MUST use service pool.** 使用 app pool 的 cron job 在 RLS 啟用的表上會返回空結果。

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.3 | 2026-02-27 | 移除 unidades，新增 capacity_kwh，對齊 HEMS 單戶場景 |
| v5.4 | 2026-02-27 | 新增 Database Connection Pool 章節 |
| v5.5 | 2026-02-28 | TradeRecord、DashboardKPI 雙層結構 |
| v5.10 | 2026-03-05 | 新增 Shared Middleware (verifyTenantToken, requireRole) |
| **v5.11** | **2026-03-05** | **Dual Pool Factory: (1) `getAppPool()` — solfacil_app, RLS enforced, for BFF; (2) `getServicePool()` — solfacil_service, BYPASSRLS, for cron jobs; (3) `closeAllPools()` — graceful shutdown + test teardown; (4) `getPool()` + `closePool()` deprecated but kept for backward compat; (5) `queryWithOrg()` unchanged, uses app pool; (6) local-server.ts dual pool startup pattern** |

---

## 模組依賴關係

| 依賴方向 | 說明 |
|---------|------|
| **被依賴** | 所有模組引用本 Shared Layer 的型別定義和 Pool Factory |
| **被依賴 (v5.10)** | M4、M8 import `shared/middleware/tenant-context` |
| **被依賴 (v5.11)** | M2/M3/M4/M1 cron jobs import `getServicePool()`；M5 BFF imports `getAppPool()` via `queryWithOrg()` |
| **依賴** | [00_MASTER_ARCHITECTURE](./00_MASTER_ARCHITECTURE_v5.11.md)（上層文件） |
