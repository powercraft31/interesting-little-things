# Module 8: Admin Control Plane — Global Control Plane (全局控制面)

> **模組版本**: v6.7
> **Git HEAD**: `b94adf3`
> **上層文件**: [00_MASTER_ARCHITECTURE_v6.7.md](./00_MASTER_ARCHITECTURE_v6.7.md)
> **最後更新**: 2026-04-02
> **說明**: 全局控制面 — Parser Rules CRUD、Data Dictionary 管理、VPP 策略管理、RBAC 約束、Dependency Lock 安全機制、**v6.7: 完整 handler 盤點與 API 更新**

---

## Changes since v5.10 (v5.10 以來的變更)

| Area | v5.10 | v6.7 |
|------|-------|------|
| Data Dictionary storage | DynamoDB (GET + POST) | DynamoDB (GET + POST + **DELETE**) |
| Data Dictionary handlers | `get-data-dictionary.ts`, `create-data-dictionary.ts` | `get-data-dictionary.ts`, **`create-dictionary-field.ts`** (renamed), **`delete-dictionary-field.ts`** (new) |
| Data Dictionary model | Inline types | Extracted to `models/DataDictionaryEntry.ts` |
| Dependency Lock safeguard | N/A | **New**: protected fields cannot be deleted (6 core fields) |
| `CreateVppStrategyRequest` | N/A | Added to `shared/types/api.ts` (type defined, handler pending) |
| Feature Flags handlers | Listed in tree | **Removed** from handler directory (no source files present) |
| Test files | `__tests__/parser-rules.test.ts`, `__tests__/vpp-strategies.test.ts` | **Removed** from this directory (no test files present) |
| Architecture boundary | All handlers import from `shared/middleware` | Maintained; all 4 RLS handlers still import from `../../shared/middleware/tenant-context` |

---

## 1. Architectural Law: Control Plane vs. Data Plane (全局法則)

M8 is a **Control Plane** module. It manages configuration, metadata, and policy that other Data Plane modules consume at runtime.

**Hard rule**: M8 must NEVER import from `bff/` or any Data Plane module. All shared dependencies flow through `src/shared/`.

```
src/admin-control-plane/
  └── handlers/*.ts
        ├── imports from ../../shared/middleware/tenant-context  ✅
        ├── imports from ../../shared/types/auth                ✅
        ├── imports from ../../shared/types/api                 ✅
        ├── imports from ../models/DataDictionaryEntry           ✅
        └── imports from ../../bff/**                           ❌ FORBIDDEN
```

---

## 2. 核心職責與設計哲學

M8 owns three operational domains:

1. **Parser Rules** — Device telemetry parsing configuration (manufacturer-specific mapping rules and unit conversions)
2. **Data Dictionary** — Global field registry defining what telemetry fields exist, their domains, and value types
3. **VPP Strategies** — Battery SoC policies, profit margins, and active scheduling windows

Design principles:
- **Multi-tenancy via RLS**: Parser Rules and VPP Strategies use PostgreSQL Row-Level Security with `SET LOCAL app.current_org_id`
- **Tenant-agnostic dictionary**: Data Dictionary is a platform-wide resource stored in DynamoDB (no per-org isolation)
- **Defence in depth**: Application-layer validation runs before database constraints fire
- **Immutable response types**: All shared API types use `readonly` fields

---

## 3. RBAC Requirements (角色訪問控制)

| Endpoint | Minimum Role | Enforcement |
|----------|-------------|-------------|
| `GET /admin/parsers` | `ORG_MANAGER` | `requireRole(tenant, [Role.ORG_MANAGER])` |
| `POST /admin/parsers` | `ORG_MANAGER` | `requireRole(tenant, [Role.ORG_MANAGER])` |
| `GET /admin/strategies` | `ORG_OPERATOR` | `requireRole(tenant, [Role.ORG_MANAGER, Role.ORG_OPERATOR])` |
| `PUT /admin/strategies/:id` | `ORG_MANAGER` | `requireRole(tenant, [Role.ORG_MANAGER])` |
| `GET /admin/data-dictionary` | *None* | No auth check (platform-wide read) |
| `POST /admin/data-dictionary` | *None* | No auth check (platform-wide write) |
| `DELETE /admin/data-dictionary/:fieldId` | *None* | No auth check; protected by Dependency Lock |

**Role hierarchy** (from `shared/types/auth.ts`):

```
SOLFACIL_ADMIN > ORG_MANAGER > ORG_OPERATOR > ORG_VIEWER
```

> **Note**: VPP strategy read is the only endpoint that admits `ORG_OPERATOR`. All other RLS-protected endpoints require `ORG_MANAGER` or above.

---

## 4. Database Tables (資料庫表)

### 4.1 PostgreSQL (RLS-protected, 共享 RDS VPC)

#### `device_parser_rules`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | Auto-generated via gen_random_uuid() |
| `org_id` | TEXT | RLS filter column (no FK — independent schema) |
| `manufacturer` | TEXT | Required, e.g. `"Growatt"` |
| `model_version` | TEXT | Default `"*"` (wildcard) |
| `mapping_rule` | JSONB | Field mapping configuration |
| `unit_conversions` | JSONB | `{ field: { factor, offset? } }` |
| `is_active` | BOOLEAN | Default `true` |
| `created_at` | TIMESTAMPTZ | Auto |
| `updated_at` | TIMESTAMPTZ | Auto |

**Constraints**: Unique index `device_parser_rules_org_idx` on `(org_id, manufacturer, model_version)`.

#### `vpp_strategies`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | Auto-generated via gen_random_uuid() |
| `org_id` | TEXT | RLS filter column (no FK — independent schema) |
| `strategy_name` | TEXT | Human-readable label |
| `min_soc` | NUMERIC(5,2) | NOT NULL, CHECK 10–50 |
| `max_soc` | NUMERIC(5,2) | NOT NULL, CHECK 70–100 |
| `emergency_soc` | NUMERIC(5,2) | NOT NULL, CHECK 5–20 |
| `profit_margin` | NUMERIC(5,4) | DEFAULT 0.15, CHECK 0.01–0.5 |
| `active_hours` | JSONB | `{ start: number, end: number }` |
| `active_weekdays` | JSONB | `number[]` (0=Sun, 6=Sat) |
| `is_default` | BOOLEAN | One default per org |
| `is_active` | BOOLEAN | Soft-delete flag |
| `created_at` | TIMESTAMPTZ | Auto |
| `updated_at` | TIMESTAMPTZ | Auto |

**CHECK constraints** (defined in `backend/src/admin-control-plane/schema.sql`):
- `vpp_strategies_soc_order`: `min_soc < max_soc`
- `vpp_strategies_emergency_below_min`: `emergency_soc < min_soc`
- `vpp_strategies_min_soc_range`: `min_soc >= 10 AND min_soc <= 50`
- `vpp_strategies_max_soc_range`: `max_soc >= 70 AND max_soc <= 100`
- `vpp_strategies_emergency_range`: `emergency_soc >= 5 AND emergency_soc <= 20`
- `vpp_strategies_profit_margin_range`: `profit_margin >= 0.01 AND profit_margin <= 0.5`

### 4.2 DynamoDB

#### `vpp-data-dictionary` (configurable via `DICTIONARY_TABLE_NAME`)

| Attribute | Type | Notes |
|-----------|------|-------|
| `fieldId` (PK) | String | Pattern: `^(metering\|status\|config)\.[a-z_]+$` |
| `domain` | String | Enum: `metering`, `status`, `config` |
| `valueType` | String | Enum: `number`, `string`, `boolean` |
| `displayName` | String | Human-readable label |
| `description` | String | Optional |

---

## 5. REST API Endpoints (完整 API 規格)

### 5.1 Parser Rules

#### `GET /admin/parsers`

List all device parser rules for the caller's organization.

- **Auth**: `ORG_MANAGER`
- **RLS**: `SET LOCAL app.current_org_id = $1`
- **Response** `200`:
```json
{
  "data": [DeviceParserRule],
  "total": 5,
  "orgId": "ORG_DEMO_001"
}
```

#### `POST /admin/parsers`

Create a new device parser rule.

- **Auth**: `ORG_MANAGER`
- **Request body** (`CreateDeviceParserRuleRequest`):
```json
{
  "manufacturer": "Growatt",
  "modelVersion": "SPH-6000",
  "mappingRule": { "grid_power": "p_grid" },
  "unitConversions": { "grid_power": { "factor": 0.001 } },
  "isActive": true
}
```
- **Validation**:
  - `manufacturer` required, string
  - `mappingRule` required, non-empty object
  - `unitConversions[*].factor` must be a positive number
- **Response** `201`: `AdminItemResponse<DeviceParserRule>`
- **Error** `409`: Duplicate `(org_id, manufacturer, model_version)` combination

### 5.2 VPP Strategies

#### `GET /admin/strategies`

List all VPP strategies for the caller's organization.

- **Auth**: `ORG_MANAGER` or `ORG_OPERATOR`
- **RLS**: `SET LOCAL app.current_org_id = $1`
- **Response** `200`:
```json
{
  "data": [VppStrategy],
  "total": 3,
  "orgId": "ORG_DEMO_001"
}
```

#### `PUT /admin/strategies/:id`

Partial update of a VPP strategy.

- **Auth**: `ORG_MANAGER`
- **Path param**: `id` (UUID)
- **Request body** (`UpdateVppStrategyRequest`): All fields optional
```json
{
  "strategyName": "Peak Shaving v2",
  "minSoc": 20,
  "maxSoc": 90,
  "emergencySoc": 10,
  "profitMargin": 0.15,
  "activeHours": { "start": 17, "end": 21 },
  "activeWeekdays": [1, 2, 3, 4, 5],
  "isDefault": false,
  "isActive": true
}
```
- **Validation** (application-layer, before DB constraints):
  - `minSoc`: 10-50
  - `maxSoc`: 70-100
  - `emergencySoc`: 5-20
  - `profitMargin`: 0.01-0.5
  - `emergencySoc < minSoc < maxSoc`
- **Response** `200`: `AdminItemResponse<VppStrategy>`
- **Error** `404`: Strategy not found (RLS prevents cross-org enumeration)
- **Error** `400`: Constraint violation with descriptive message

### 5.3 Data Dictionary

#### `GET /admin/data-dictionary`

Scan all data dictionary entries.

- **Auth**: None (platform-wide)
- **Storage**: DynamoDB `ScanCommand`
- **Response** `200`:
```json
{
  "fields": [DataDictionaryEntry]
}
```

#### `POST /admin/data-dictionary`

Create a new data dictionary field.

- **Auth**: None (platform-wide)
- **Request body**:
```json
{
  "fieldId": "metering.solar_power_kw",
  "domain": "metering",
  "valueType": "number",
  "displayName": "Solar Power (kW)",
  "description": "Current solar panel output"
}
```
- **Validation**:
  - `fieldId` must match `^(metering|status|config)\.[a-z_]+$`
  - `domain` must be one of: `metering`, `status`, `config`
  - `valueType` must be one of: `number`, `string`, `boolean`
  - `displayName` required, string
- **Response** `201`: `DataDictionaryEntry`

#### `DELETE /admin/data-dictionary/:fieldId`

Delete a data dictionary field, subject to Dependency Lock.

- **Auth**: None (platform-wide)
- **Path param**: `fieldId`
- **Dependency Lock safeguard**: The following 6 protected fields cannot be deleted:
  - `metering.grid_power_kw`
  - `metering.grid_import_kwh`
  - `metering.grid_export_kwh`
  - `status.battery_soc`
  - `status.battery_voltage`
  - `status.is_online`
- **Response** `204`: No content (success)
- **Error** `404`: Field not found
- **Error** `409`: Field is protected and in active use

---

## 6. Handler File Inventory (Lambda Handlers)

```
src/admin-control-plane/
├── handlers/
│   ├── get-parser-rules.ts          # GET  /admin/parsers           — RLS + ORG_MANAGER
│   ├── create-parser-rule.ts        # POST /admin/parsers           — RLS + ORG_MANAGER
│   ├── get-vpp-strategies.ts        # GET  /admin/strategies        — RLS + ORG_MANAGER | ORG_OPERATOR
│   ├── update-vpp-strategy.ts       # PUT  /admin/strategies/:id    — RLS + ORG_MANAGER
│   ├── get-data-dictionary.ts       # GET  /admin/data-dictionary   — DynamoDB, no auth
│   ├── create-dictionary-field.ts   # POST /admin/data-dictionary   — DynamoDB, no auth
│   └── delete-dictionary-field.ts   # DELETE /admin/data-dictionary/:fieldId — DynamoDB, Dependency Lock
├── models/
│   └── DataDictionaryEntry.ts       # Core business model for dictionary fields
└── schema.sql                       # Module DDL: device_parser_rules + vpp_strategies (UUID PK, 6 CHECK constraints, RLS)
```

### Handler pattern (RLS-protected endpoints)

All 4 PostgreSQL handlers follow this pattern:

```typescript
// 1. Extract & verify JWT
const token = event.headers?.["authorization"] ?? event.headers?.["Authorization"] ?? "";
const tenant = verifyTenantToken(token);
requireRole(tenant, ALLOWED_ROLES);

// 2. Acquire connection, activate RLS
const client = await pool.connect();
await client.query("BEGIN");
await client.query("SET LOCAL app.current_org_id = $1", [tenant.orgId]);

// 3. Execute query
const result = await client.query(/* ... */);

// 4. Commit & release
await client.query("COMMIT");
client.release();
```

### Handler pattern (DynamoDB endpoints)

The 3 Data Dictionary handlers use `DynamoDBDocumentClient` with `ScanCommand`, `PutCommand`, `GetCommand`, and `DeleteCommand`. No tenant isolation is applied -- these are platform-wide resources.

---

## 7. Data Dictionary Model (資料字典模型)

```typescript
// src/admin-control-plane/models/DataDictionaryEntry.ts
export interface DataDictionaryEntry {
  fieldId: string;                              // PK, e.g. "metering.grid_power_kw"
  domain: 'metering' | 'status' | 'config';    // Partition domain
  valueType: 'number' | 'string' | 'boolean';  // Runtime type
  displayName: string;                          // UI label
  description?: string;                         // Optional docs
}
```

**Architectural law**: NO `sourcePath`, NO `transform` fields. The dictionary defines *what* fields exist, not *how* they are sourced. Parser rules (in `device_parser_rules`) handle the mapping from raw telemetry to dictionary fields.

---

## 8. Shared Type Definitions (共享類型)

All M8 types are defined in `src/shared/types/api.ts`:

| Type | Purpose |
|------|---------|
| `DeviceParserRule` | Response model for parser rules |
| `CreateDeviceParserRuleRequest` | POST payload for parser rules |
| `VppStrategy` | Response model for VPP strategies |
| `UpdateVppStrategyRequest` | PUT payload for VPP strategy updates |
| `CreateVppStrategyRequest` | POST payload for VPP strategy creation (type defined, handler pending) |
| `AdminListResponse<T>` | Envelope for list endpoints: `{ data: T[], total, orgId }` |
| `AdminItemResponse<T>` | Envelope for item endpoints: `{ data: T, orgId }` |

Auth types in `src/shared/types/auth.ts`:

| Type | Purpose |
|------|---------|
| `Role` | Enum: `SOLFACIL_ADMIN`, `ORG_MANAGER`, `ORG_OPERATOR`, `ORG_VIEWER` |
| `TenantContext` | `{ userId, orgId, role }` — extracted from JWT |

---

## 9. Architecture Boundary Verification (架構邊界驗證)

All imports verified at v6.6:

| Handler | Import Source | Status |
|---------|--------------|--------|
| `get-parser-rules.ts` | `../../shared/middleware/tenant-context` | OK |
| `create-parser-rule.ts` | `../../shared/middleware/tenant-context` | OK |
| `get-vpp-strategies.ts` | `../../shared/middleware/tenant-context` | OK |
| `update-vpp-strategy.ts` | `../../shared/middleware/tenant-context` | OK |
| `get-data-dictionary.ts` | `../models/DataDictionaryEntry` | OK |
| `create-dictionary-field.ts` | `../models/DataDictionaryEntry` | OK |
| `delete-dictionary-field.ts` | *(no model import, inline check)* | OK |

**Zero BFF imports. Boundary clean.**

---

## 10. Security Considerations (安全考量)

1. **RLS isolation**: PostgreSQL handlers use `SET LOCAL` within explicit transactions -- cross-org data access is impossible even if application logic has bugs
2. **Enumeration prevention**: `update-vpp-strategy.ts` returns `404` for nonexistent IDs (RLS filters out other orgs' records before the handler sees them)
3. **Defence in depth**: SoC validation runs at both the application layer (M2 strategy-evaluator.ts) AND database CHECK constraints (6 constraints in admin-control-plane/schema.sql)
4. **Dependency Lock**: Core telemetry fields that other modules depend on cannot be deleted from the dictionary, preventing cascade failures
5. **No auth on Data Dictionary**: This is by design -- the dictionary is a platform-wide schema registry. Future versions may add `SOLFACIL_ADMIN` gating for write/delete operations

---

## 模組依賴關係

| 方向 | 模組 | 說明 |
|------|------|------|
| **依賴** | Shared Layer | `shared/middleware/tenant-context`, `shared/types/auth`, `shared/types/api` |
| **依賴** | M4 (Market & Billing) | 共享 RDS PostgreSQL VPC |
| **依賴** | DynamoDB | `vpp-data-dictionary` table for Data Dictionary entries |
| **被依賴** | M1 (IoT Hub) | AppConfig `vpp-m1-parser-rules` |
| **被依賴** | M2 (Optimization Engine) | AppConfig `vpp-strategies` |
| **被依賴** | M3 (DR Dispatcher) | AppConfig `dispatch-policies` |
| **被依賴** | M4 (Market & Billing) | AppConfig `billing-rules` |
| **被依賴** | M5 (BFF) | AppConfig `feature-flags` |
| **被依賴** | M6 (Identity) | AppConfig `rbac-policies` |
| **被依賴** | M7 (Open API) | AppConfig `api-quotas` |

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | 初始版本：Data Dictionary、AppConfig、8 module configuration dependency |
| v5.3 | 2026-02-27 | Data Dictionary seed records、HEMS 對齊 |
| v5.10 | 2026-03-05 | 架構邊界修復：4 個 handler 文件 import 路徑從 `../../bff/middleware/tenant-context` 改為 `../../shared/middleware/tenant-context` |
| **v6.6** | **2026-03-31** | **完整 handler 盤點：新增 `delete-dictionary-field.ts` (Dependency Lock)、`create-dictionary-field.ts` (renamed)、`DataDictionaryEntry` model 抽取；Feature Flags handlers 與測試文件已移除；新增 `CreateVppStrategyRequest` 類型；完整 API 規格、RBAC 矩陣、DB schema 文檔化** |
| **v6.7** | **2026-04-02** | **版本升級配合 V2.4 協議對齊。M8 無程式碼變更 — Parser Rules / VPP Strategies / Data Dictionary CRUD 與 MQTT 協議版本無關。** |

---

## V2.4 協議影響

**M8 無需任何程式碼變更。** M8 處理 Parser Rule、VPP Strategy 和 Data Dictionary 的 CRUD 操作，這些均是純 HTTP/SQL 層的配置管理，不涉及 MQTT 協議解析或遍測數值處理。
