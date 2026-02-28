# Shared Layer — 公共型別定義與 API 契約

> **模組版本**: v5.4
> **變更**: v5.4 — 新增 Database Connection Pool 章節；PostgreSQL 取代 DynamoDB/Timestream
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.4.md](./00_MASTER_ARCHITECTURE_v5.4.md)
> **最後更新**: 2026-02-27
> **說明**: 公共 TypeScript 型別定義、API 契約、EventSchema、目錄結構、全局資料隔離策略

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
           ├─ DynamoDB item (GSI partition key)
           ├─ Timestream record (dimension)
           ├─ MQTT topic path segment
           ├─ EventBridge event detail
           └─ Lambda handler context (TenantContext)
```

### PostgreSQL RLS Pattern (M4)

```sql
-- Lambda middleware sets: SET app.current_org_id = 'ORG_ENERGIA_001'
CREATE POLICY tenant_isolation ON {table}
  USING (org_id = current_setting('app.current_org_id', true));

-- SOLFACIL_ADMIN bypass: a superuser role with BYPASSRLS privilege
```

### DynamoDB Pattern (M3, M7, M8)

```
GSI: org-{entity}-index
  PK: org_id
  SK: {entity_id}
  Purpose: tenant-scoped queries
```

### Timestream Pattern (M1)

```
Dimensions: org_id (MANDATORY first dimension), asset_id, device_id, region
All queries: WHERE org_id = '{org_id}'
```

### IoT Core MQTT Topic Namespace

```
solfacil/{org_id}/{region}/{asset_id}/telemetry
solfacil/{org_id}/{region}/{asset_id}/command/mode-change
solfacil/{org_id}/{region}/{asset_id}/response/mode-change

IoT Policy:
  Resource: "arn:aws:iot:*:*:topic/solfacil/${iot:Connection.Thing.Attributes[org_id]}/*"

IoT Rule SQL:
  SELECT *, topic(2) AS org_id, topic(3) AS region, topic(4) AS asset_id
  FROM 'solfacil/+/+/+/telemetry'
```

---

## 2. Core TypeScript Interfaces

### 2.1 StandardTelemetry (v5.2 — Dynamic Schema Envelope)

```typescript
// src/iot-hub/contracts/standard-telemetry.ts

// v5.2 — flexible schema envelope (Business Trilogy Data Model)
export interface StandardTelemetry {
  readonly deviceId: string;
  readonly orgId: string;
  readonly timestamp: string;
  readonly traceId: string;            // vpp-{UUID} propagated from M1
  readonly metering: Record<string, number>;    // e.g. { "metering.grid_power_kw": 3.2 }
  readonly status:   Record<string, string | number | boolean>;  // e.g. { "status.battery_soc": 85 }
  readonly config:   Record<string, string | number | boolean>;  // e.g. { "config.charge_limit": 90 }
}
```

Three domain buckets:
- **`metering`** — Numeric measurements (power, energy, voltage, current)
- **`status`** — Device state indicators (SoC, temperature, operation mode)
- **`config`** — Device configuration values (charge limits, discharge thresholds)

### 2.2 VppEvent — EventBridge Event Envelope

```typescript
// src/shared/types/events.ts

/** Base event envelope — ALL events must include org_id */
export interface VppEvent<T> {
  readonly source: string;
  readonly detailType: string;
  readonly detail: T & { readonly org_id: string };
  readonly timestamp: string;
}

interface VppEventDetail {
  readonly org_id: string;  // MANDATORY — never omit
  readonly timestamp: string;
  // ...event-specific fields
}
```

### 2.3 TenantContext — Auth / Middleware

```typescript
// src/shared/middleware/tenant-context.ts

export interface TenantContext {
  readonly userId: string;
  readonly orgId: string;
  readonly role: Role;
  readonly email: string;
  readonly isPlatformAdmin: boolean;
}

export type Role = 'SOLFACIL_ADMIN' | 'ORG_MANAGER' | 'ORG_OPERATOR' | 'ORG_VIEWER';
```

Tenant scoping rule (enforced at middleware, not in handlers):
```
IF user.role == SOLFACIL_ADMIN:
    query_filter = {}                    // Admin sees everything
ELSE:
    query_filter = { org_id: user.orgId } // Strict org filter
```

### 2.4 TelemetryAdapter — Anti-Corruption Layer

```typescript
// src/iot-hub/adapters/telemetry-adapter.ts

export interface TelemetryAdapter {
  readonly vendorId: string;
  normalize(orgId: string, rawPayload: Record<string, unknown>): StandardTelemetry;
}
```

### 2.5 DataDictionaryEntry (v5.2)

```typescript
// src/admin-control/types/data-dictionary.ts

export interface DataDictionaryEntry {
  fieldId: string;           // e.g. "status.chiller_temp"
  domain: 'metering' | 'status' | 'config';
  displayName: string;
  unit?: string;
  valueType: 'number' | 'string' | 'boolean';
  sourcePath: string;        // MQTT path this maps from
  transform: string;
  createdBy: string;
  createdAt: string;
  orgId: string;
}
```

### 2.6 FieldDependency (v5.2)

```typescript
// src/admin-control/types/field-dependency.ts

export interface FieldDependency {
  moduleId: 'M2' | 'M3' | 'M4' | 'M5' | 'M7';
  configType: string;
  configId: string;
  configName: string;
  usageContext: string;
}
```

### 2.7 AssetRecord (v5.3 — HEMS 單戶場景)

```typescript
// src/shared/types/asset.ts

export interface AssetRecord {
  readonly assetId: string;
  readonly orgId: string;
  readonly region: string;
  readonly capacidade_kw: number;        // kW 裝機容量（逆變器額定功率）
  readonly capacity_kwh: number;          // 電池系統裝機容量 (kWh)，取代原 unidades，對齊 HEMS 單戶場景
  readonly operationalStatus: string;     // 運行狀態 'operando' | 'carregando' | 'offline'
  readonly metering: {
    pv_power: number;           // kW
    battery_power: number;      // kW，正=充電，負=放電
    grid_power_kw: number;      // kW，正=買電，負=賣電
    load_power: number;         // kW
    grid_import_kwh: number;    // kWh 今日
    grid_export_kwh: number;    // kWh 今日
    pv_daily_energy: number;    // kWh 今日
    bat_charged_today: number;
    bat_discharged_today: number;
  };
  readonly status: {
    battery_soc: number;        // %
    bat_soh: number;            // %
    bat_work_status: 'charging' | 'discharging' | 'idle';
    battery_voltage: number;    // V
    bat_cycle_count: number;
    inverter_temp: number;      // °C
    is_online: boolean;
    grid_frequency: number;     // Hz
  };
  readonly config: {
    target_mode: string;
    min_soc: number;            // %
    max_charge_rate: number;    // kW
    charge_window_start: string;
    charge_window_end: string;
    discharge_window_start: string;
  };
}
```

> **[v5.3 變更說明]** `unidades` 欄位已移除。該欄位源自 VPP 聚合器設計（代表管理的用戶數量），
> 與 HEMS 單戶家庭場景相矛盾。以 `capacity_kwh`（電池系統裝機容量）取代，直接對應物理設備屬性。
> `metering` / `status` / `config` 三層嵌套結構與 StandardTelemetry Business Trilogy 保持一致。

### 2.8 DashboardMetrics (v5.3)

```typescript
// src/shared/types/dashboard.ts

export interface DashboardMetrics {
  readonly orgId: string;
  readonly totalAssets: number;
  readonly onlineAssets: number;
  readonly avgSoc: number;                 // % 平均電池 SoC
  readonly totalPowerKw: number;           // kW 聚合功率
  readonly dailyRevenueReais: number;      // R$ 今日收益
  readonly monthlyRevenueReais: number;    // R$ 月度收益
  readonly vppDispatchAccuracy?: number;   // % VPP 調度精準率
  readonly drResponseLatency?: number;     // s DR 響應延遲
}
```

---

## 3. AppConfig Parser Rules — `vpp-m1-parser-rules` Profile

```json
{
  "version": "5.2",
  "rules": [
    {
      "domain": "metering",
      "targetField": "metering.grid_power_kw",
      "sourcePath": "grid.activePower",
      "valueType": "number",
      "transform": "divide:1000",
      "unit": "kW"
    },
    {
      "domain": "status",
      "targetField": "status.battery_soc",
      "sourcePath": "batList[0].bat_soc",
      "valueType": "number",
      "transform": "identity",
      "unit": "%"
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `domain` | `'metering' \| 'status' \| 'config'` | Business Trilogy bucket |
| `targetField` | `string` | Canonical field name (e.g., `metering.grid_power_kw`) |
| `sourcePath` | `string` | JSONPath-like expression from raw MQTT payload |
| `transform` | `string` | `identity`, `divide:N`, `multiply:N`, `round:N` |
| `unit` | `string` | SI unit for observability |
| `valueType` | `'number' \| 'string' \| 'boolean'` | Drives M1 type casting via `castValue()` |

---

## 4. Utility Functions

### castValue — Type-Safe Casting

```typescript
function castValue(raw: unknown, valueType: 'number' | 'string' | 'boolean'): number | string | boolean {
  switch (valueType) {
    case 'number':
      const n = Number(raw);
      if (isNaN(n)) throw new TypeError(`Cannot cast "${raw}" to number`);
      return n;
    case 'boolean':
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true' || raw === 1) return true;
      if (raw === 'false' || raw === 0) return false;
      throw new TypeError(`Cannot cast "${raw}" to boolean`);
    case 'string':
      return String(raw);
  }
}
```

### getNestedValue — JSONPath Accessor

Used by M1 Translation Executor to extract values from nested MQTT payloads via dot-notation and array index paths.

---

## 5. EventBridge Event Schemas

### Mandatory Envelope

Every event **must** include `org_id` in its detail payload.

### DRDispatchCompleted — Edge Case Payloads

| Scenario | `aggregate.status` | Description |
|----------|-------------------|-------------|
| All devices respond | `SUCCESS` | Normal path |
| Some devices respond, some timeout | `PARTIAL_SUCCESS` | Mixed results |
| All devices timeout | `FAILED` | Complete failure |

```json
{
  "source": "solfacil.dr-dispatcher",
  "detail-type": "DRDispatchCompleted",
  "detail": {
    "org_id": "ORG_ENERGIA_001",
    "dispatch_id": "01HWXYZ...",
    "command_type": "DR_TEST",
    "resolution": "TIMEOUT",
    "results": [
      { "asset_id": "ASSET_SP_001", "status": "SUCCESS", "latency": 1.73, "accuracy": 96.4 },
      { "asset_id": "ASSET_MG_003", "status": "FAILED", "error_reason": "TIMEOUT" }
    ],
    "aggregate": {
      "success_count": 2, "failed_count": 2, "timeout_count": 2,
      "avg_latency": 1.94, "total_power": 9.64, "avg_accuracy": 95.1,
      "status": "PARTIAL_SUCCESS"
    }
  }
}
```

### SchemaEvolved (v5.2)

```json
{
  "source": "vpp.m8.admin",
  "detail-type": "SchemaEvolved",
  "detail": {
    "fieldId": "status.chiller_temp",
    "domain": "status",
    "action": "ADD",
    "displayName": "Chiller Temperature",
    "unit": "°C",
    "valueType": "number",
    "orgId": "ORG_ENERGIA_001",
    "traceId": "vpp-a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "timestamp": "2026-02-25T14:30:00.000Z"
  }
}
```

---

## 6. Backend Directory Structure

```
backend/
├── README.md
├── package.json                          # Monorepo root (npm workspaces)
├── tsconfig.base.json
├── cdk.json
├── jest.config.ts
│
├── bin/
│   └── app.ts                            # CDK App: instantiates all 8 stacks
│
├── lib/                                  # CDK Stack definitions
│   ├── shared/
│   │   ├── event-bus.ts
│   │   ├── event-schemas.ts
│   │   └── constants.ts
│   ├── shared-stack.ts                   # Phase 0: SharedStack
│   ├── auth-stack.ts                     # Phase 1: M6
│   ├── iot-hub-stack.ts                  # Phase 2: M1
│   ├── algorithm-stack.ts               # Phase 2: M2
│   ├── dr-dispatcher-stack.ts           # Phase 3: M3
│   ├── market-billing-stack.ts          # Phase 3: M4
│   ├── bff-stack.ts                     # Phase 4: M5
│   └── open-api-stack.ts               # Phase 5: M7
│
├── src/                                  # Lambda handler source code
│   ├── shared/
│   │   ├── db/
│   │   │   └── pool.ts                  # v5.4 PostgreSQL Connection Pool
│   │   ├── event-bridge-client.ts
│   │   ├── logger.ts
│   │   ├── middleware.ts
│   │   ├── errors.ts
│   │   └── types/
│   │       ├── asset.ts
│   │       ├── tariff.ts
│   │       ├── telemetry.ts
│   │       ├── events.ts
│   │       └── auth.ts
│   ├── iot-hub/                          # Module 1
│   ├── optimization-engine/              # Module 2
│   ├── dr-dispatcher/                    # Module 3
│   ├── market-billing/                   # Module 4
│   ├── bff/                              # Module 5
│   ├── auth/                             # Module 6
│   └── open-api/                         # Module 7
│
├── db/                                   # v5.4 Database Migrations
│   └── migrations/
│       ├── 001_init.sql
│       └── ...
│
├── test/                                 # CDK infrastructure tests
└── scripts/
    ├── seed-tariffs.ts
    ├── seed-users.ts
    ├── simulate-telemetry.ts
    └── deploy.sh
```

---

## 7. Observability Standards

### Key Metrics

| Metric | Source | Alert Threshold |
|--------|--------|----------------|
| DR dispatch response latency P95 | M3 | > 5s |
| DR dispatch accuracy % | M3 | < 90% |
| Optimization Alpha trend | M2 | < 70% |
| Forecast MAPE trend | M2 | > 15% |
| MQTT delivery success rate | M1 | < 99% |
| SSO federation errors (5 min) | M6 | > 5 errors |
| API throttle rate (5 min) | M7 | > 100 rejections |
| WAF blocked requests (5 min) | M7 | > 50 blocks |
| Webhook DLQ depth | M7 | > 0 messages |

### Audit Log Format

```json
{
  "timestamp": "2026-02-20T14:30:00Z",
  "action": "DISPATCH_MODE_CHANGE",
  "actor": {
    "userId": "sub-uuid",
    "email": "operador@energiacorp.com.br",
    "orgId": "ORG_ENERGIA_001",
    "role": "ORG_OPERATOR"
  },
  "resource": { "type": "dispatch", "id": "01HWXYZ..." },
  "details": { "assetIds": ["ASSET_SP_001"], "targetMode": "peak_valley_arbitrage" }
}
```

---

## 8. Database Connection Pool（v5.4 新增）

### 設計原則

PostgreSQL 連線池為全系統共用基礎設施，統一置於 `src/shared/db/`，
各業務模組直接 import，不得各自建立獨立連線。

### 連線池規格

- **實作庫**：`node-postgres`（pg）+ `pg-pool`
- **最大連線數**：20（Pilot 階段；生產環境依 Aurora 規格調整）
- **Idle 超時**：30 秒
- **連線超時**：5 秒

### 使用方式

```typescript
// src/shared/db/pool.ts
import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// 各模組使用方式
import { pool } from '../../shared/db/pool';
const result = await pool.query('SELECT * FROM assets WHERE org_id = $1', [orgId]);
```

### 鐵律：跨模組邊界

> ⚠️ **嚴禁跨模組直接 SQL JOIN**
>
> 每個業務模組只能查詢自己擁有的表（見 §10_DATABASE_SCHEMA 所有權清單）。
> 跨模組數據必須透過對方模組暴露的 Service function 或 API 呼叫取得。
>
> ❌ 錯誤：M4 Billing 直接 `JOIN telemetry_history`（屬於 M1）
> ✅ 正確：M4 呼叫 M1 的 `getAssetEnergyForDate(assetId, date)` 方法取得數據

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.3 | 2026-02-27 | 移除 unidades，新增 capacity_kwh，對齊 HEMS 單戶場景 |
| v5.4 | 2026-02-27 | 新增 Database Connection Pool 章節；PostgreSQL 取代 DynamoDB/Timestream |

---

## 模組依賴關係

| 依賴方向 | 說明 |
|---------|------|
| **被依賴** | 所有模組文件引用本 Shared Layer 的型別定義 |
| **依賴** | [00_MASTER_ARCHITECTURE](./00_MASTER_ARCHITECTURE_v5.4.md)（上層文件） |
