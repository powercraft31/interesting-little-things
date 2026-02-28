# Module 5: Frontend BFF (Backend-for-Frontend)

> **模組版本**: v5.5
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.5.md](./00_MASTER_ARCHITECTURE_v5.5.md)
> **最後更新**: 2026-02-28
> **說明**: 聚合後端數據，為前端 Admin UI 提供統一 REST API（Cognito 授權、租戶隔離）

---

## 1. 模組職責

M5 BFF 是前端 Dashboard 的唯一 API 入口。職責：

- 聚合 M1（遙測）、M2（策略）、M3（調度）、M4（計費）的數據為統一 REST 回應
- Cognito JWT 認證 + RBAC 角色鑑權
- `extractTenantContext()` 中間件確保所有查詢都帶 `org_id` 過濾
- 發佈 `DRCommandIssued` 事件觸發 M3 調度

---

## 2. CDK Stack: `BffStack`

| Resource | AWS Service | Purpose |
|----------|-------------|---------|
| API Gateway | API Gateway v2 (HTTP API) | REST endpoints for Dashboard |
| Authorizer | Cognito User Pool (from M6) | JWT-based auth |
| Lambda Handlers | Lambda (Node.js 20) | One handler per route |
| WebSocket (future) | API Gateway WebSocket | Real-time dispatch progress |

### IAM Grants

```
BffStack Lambda functions:
  ├─ rds-data:ExecuteStatement    → solfacil-vpp RDS cluster (read-only)
  ├─ dynamodb:Query               → dispatch_tracker (via org-dispatch-index GSI)
  ├─ timestream:Select            → solfacil_vpp/device_telemetry
  ├─ events:PutEvents             → solfacil-vpp-events bus
  └─ cognito-idp:ListUsers        → user management (ORG_MANAGER only)
```

---

## 3. EventBridge Integration

| Direction | Event | Source/Target |
|-----------|-------|---------------|
| **Publishes** | `DRCommandIssued` | → M3 (dispatch execution) |
| **Consumes** | `DRDispatchCompleted` | ← M3 (future: WebSocket push) |
| **Consumes** | `ProfitCalculated` | ← M4 (future: WebSocket push) |

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
| `POST` | `/dispatch` | ORG_OPERATOR | Verify all `assetIds` belong to `org_id`; step-up auth |
| `POST` | `/dr-test` | ORG_OPERATOR | Scoped to `org_id` assets; step-up auth |
| `GET` | `/dispatch/{id}` | ORG_OPERATOR | Verify dispatch belongs to `org_id` |
| `GET` | `/algorithm/kpis` | ORG_VIEWER | Scoped to `org_id` |
| `GET` | `/tariffs/current` | ORG_VIEWER | Scoped to `org_id` |
| `PUT` | `/tariffs/{id}` | ORG_MANAGER | Verify tariff belongs to `org_id` |
| `GET` | `/organizations` | SOLFACIL_ADMIN | No scoping (admin only) |
| `POST` | `/organizations` | SOLFACIL_ADMIN | No scoping (admin only) |
| `GET` | `/users` | ORG_MANAGER | Scoped to `org_id` |
| `POST` | `/users` | ORG_MANAGER | User created in caller's `org_id` |

---

## 5. Middleware Chain

```
Request Flow:
┌──────────┐    ┌──────────────┐    ┌───────────────┐    ┌──────────────┐
│ API GW   │───►│ Cognito      │───►│ Middy         │───►│ Handler      │
│ receives │    │ Authorizer   │    │ Middleware     │    │ (business    │
│ request  │    │ (JWT verify) │    │ Chain          │    │  logic)      │
└──────────┘    └──────────────┘    └───────────────┘    └──────────────┘
                 validates JWT       1. extractTenant()   receives
                 rejects invalid     2. requireRole()     TenantContext
                 tokens              3. requireRecentAuth() (for write ops)
                                     4. logRequest()
                                     5. errorHandler()
```

### Step-Up Authentication (Sensitive Operations)

```typescript
export function requireRecentAuth(
  maxAgeSeconds: number = 900 // 15 minutes
): middy.MiddlewareObj<APIGatewayProxyEventV2> {
  return {
    before: async (request) => {
      const claims = request.event.requestContext?.authorizer?.jwt?.claims;
      const authTime = Number(claims?.auth_time ?? 0);
      const now = Math.floor(Date.now() / 1000);
      if (now - authTime > maxAgeSeconds) {
        return {
          statusCode: 401,
          body: JSON.stringify({
            error: 'step_up_required',
            message: 'This operation requires recent authentication. Please re-authenticate.',
          }),
        };
      }
    },
  };
}
```

---

## 6. Data Aggregation Logic

### GET /assets — Asset List (v5.3)

Response JSON 範例：

```json
{
  "assets": [
    {
      "assetId": "ASSET_SP_001",
      "orgId": "ORG_ENERGIA_001",
      "region": "SP",
      "capacidade": 5.0,
      "capacity_kwh": 13.5,
      "operationalStatus": "operando",
      "metering": {
        "pv_power": 3.2,
        "battery_power": -1.5,
        "grid_power_kw": 0.8,
        "load_power": 2.5,
        "grid_import_kwh": 4.2,
        "grid_export_kwh": 1.8,
        "pv_daily_energy": 12.4,
        "bat_charged_today": 5.6,
        "bat_discharged_today": 4.1
      },
      "status": {
        "battery_soc": 72,
        "bat_soh": 98,
        "bat_work_status": "discharging",
        "battery_voltage": 51.2,
        "bat_cycle_count": 245,
        "inverter_temp": 38.5,
        "is_online": true,
        "grid_frequency": 60.01
      },
      "config": {
        "target_mode": "peak_valley_arbitrage",
        "min_soc": 20,
        "max_charge_rate": 3.3,
        "charge_window_start": "23:00",
        "charge_window_end": "05:00",
        "discharge_window_start": "17:00"
      }
    }
  ]
}
```

> **[v5.3 Mock 數據說明]** 在 IoT Gateway 尚未完整串接前，BFF Lambda
> 將回傳符合能量守恆條件的 Hardcode Mock 數據（pv + bat = load + grid），
> 以確保前端 Diamond Energy Flow 圖顯示合理。
> 真實遙測接入後，此 Mock 段落應移除並替換為 M1 Asset Shadow 查詢。

### GET /dashboard — KPI Aggregation

M5 aggregates data from multiple modules into a single dashboard response:

- **M1 (Timestream)**: Latest SoC, power readings, device online status
- **M2 (SSM/AppConfig)**: Current optimization alpha, forecast MAPE
- **M3 (DynamoDB)**: Recent dispatch results, success rate
- **M4 (PostgreSQL)**: Revenue trends, profit calculations

Response JSON 範例（v5.3）：

```json
{
  "orgId": "ORG_ENERGIA_001",
  "totalAssets": 4,
  "onlineAssets": 3,
  "avgSoc": 72.5,
  "totalPowerKw": 18.4,
  "dailyRevenueReais": 127.50,
  "monthlyRevenueReais": 3825.00,
  "vppDispatchAccuracy": 95.1,
  "drResponseLatency": 1.94
}
```

### POST /dr-test — Dispatch Trigger

1. Validates payload
2. Queries assets `WHERE org_id = '{caller.orgId}'`
3. Creates `dispatch_id` (ULID)
4. Publishes `DRCommandIssued` to EventBridge
5. Returns `{ dispatch_id, status: "ACCEPTED" }`

---

## § BFF 淨化行動 (v5.5)

### 背景
v5.3 的 BFF 實作中，部分端點仍使用 hardcode 陣列作為資料來源。v5.5 全面改為 SQL 讀取。

### get-trades.ts — 改為查 trade_schedules

**舊（禁止）：**
```typescript
// ❌ hardcode 假資料
const trades = [{ id: 'T001', action: 'charge', price: 89.50 }, ...]
```

**新（必須）：**
```typescript
// ✅ 從 DB 讀取 M2 排程輸出
const result = await pool.query(`
  SELECT ts.id, ts.asset_id, ts.planned_time, ts.action,
         ts.expected_volume_kwh, ts.target_pld_price
  FROM trade_schedules ts
  WHERE ts.org_id = $1
    AND ts.planned_time >= NOW()
  ORDER BY ts.planned_time ASC
  LIMIT 50
`, [orgId]);
```
單位標示：`target_pld_price` 輸出時標示為 `R$/MWh`

### get-revenue-trend.ts — 改為查 revenue_daily

**新（必須）：**
```typescript
// ✅ 近 7 天雙軌收益趨勢
const result = await pool.query(`
  SELECT date,
         vpp_arbitrage_profit_reais,
         client_savings_reais,
         actual_self_consumption_pct
  FROM revenue_daily
  WHERE org_id = $1
    AND date >= CURRENT_DATE - INTERVAL '7 days'
  ORDER BY date ASC
`, [orgId]);
```

### get-dashboard.ts — Revenue Breakdown 和 KPI 改為雙層結構

**Revenue Breakdown（圓環圖）：**
```typescript
// ✅ 兩個分段：B端套利 + C端省電
const revenue = await pool.query(`
  SELECT
    COALESCE(SUM(vpp_arbitrage_profit_reais), 0) AS vpp_arbitrage_profit,
    COALESCE(SUM(client_savings_reais), 0) AS client_savings
  FROM revenue_daily
  WHERE org_id = $1 AND date = CURRENT_DATE
`, [orgId]);
```

**Algorithm KPI（大腦健康度）：**
```typescript
// ✅ 查 algorithm_metrics，只取 self_consumption_pct
const metrics = await pool.query(`
  SELECT self_consumption_pct
  FROM algorithm_metrics
  WHERE org_id = $1 AND date = CURRENT_DATE
`, [orgId]);
```

---

## 7. org_id Integration

- Cognito Authorizer validates JWT and passes claims to Lambda
- `extractTenantContext()` middleware extracts `org_id` and `role` from JWT claims
- All queries are filtered by `org_id` (or unfiltered for SOLFACIL_ADMIN)
- Resource ownership checks for single-resource endpoints (return 404, not 403)

---

## 8. AppConfig 讀取

M5 reads feature flags from AppConfig profile `feature-flags`:
- Cached via Lambda Extension sidecar (< 1ms)
- Used for canary releases, A/B testing, UI toggle decisions
- No manual cache management needed in BFF code

---

## 9. Lambda Handlers

```
src/bff/
├── handlers/
│   ├── get-dashboard.ts          # GET /dashboard — aggregated KPI data (v5.5: dual-layer)
│   ├── get-assets.ts             # GET /assets — list all assets
│   ├── get-asset-detail.ts       # GET /assets/:id — single asset + analytics
│   ├── get-trades.ts             # GET /trades — today's trade schedule (v5.5: from trade_schedules)
│   ├── post-dispatch.ts          # POST /dispatch — trigger batch mode change
│   ├── post-dr-test.ts           # POST /dr-test — trigger DR test
│   ├── get-dispatch-status.ts    # GET /dispatch/:id — poll dispatch progress
│   └── get-revenue-trend.ts      # GET /revenue/trend — 7-day revenue chart (v5.5: dual-track)
├── middleware/
│   ├── tenant-context.ts         # JWT → TenantContext extraction
│   ├── cors.ts                   # CORS headers
│   └── rate-limit.ts             # API throttling
└── __tests__/
    ├── get-dashboard.test.ts
    └── post-dispatch.test.ts
```

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | 初始版本 |
| v5.3 | 2026-02-27 | HEMS 單戶場景對齊，capacity_kwh |
| v5.5 | 2026-02-28 | BFF 淨化行動：移除 hardcode，改為 SQL 讀取 trade_schedules / revenue_daily / algorithm_metrics |

---

## 模組依賴關係

| 方向 | 模組 | 說明 |
|------|------|------|
| **依賴** | M1 (IoT Hub) | Timestream 查詢遙測數據 |
| **依賴** | M2 (Optimization Engine) | 讀取策略 KPI |
| **依賴** | M3 (DR Dispatcher) | 發佈 DRCommandIssued、查詢調度結果 |
| **依賴** | M4 (Market & Billing) | PostgreSQL 查詢收益/電價 |
| **依賴** | M6 (Identity) | Cognito Authorizer、JWT 驗證 |
| **依賴** | M8 (Admin Control) | AppConfig feature-flags 讀取 |
| **被依賴** | Frontend Dashboard | 唯一 API 消費者 |
