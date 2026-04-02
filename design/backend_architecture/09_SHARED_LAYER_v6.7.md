# 09 Shared Layer Architecture

> **Version**: v6.7
> **Parent**: [00_MASTER_ARCHITECTURE_v6.7.md](./00_MASTER_ARCHITECTURE_v6.7.md)
> **Date**: 2026-04-02
> **Git HEAD**: `b94adf3`
> **Scope**: Cross-cutting utilities, connection management, type definitions, middleware, and migrations shared by all backend modules (M1-M8).

---

## Version History

| Version | Date | Key Change |
|---------|------|------------|
| v5.2 | 2026-02-27 | Initial shared layer (db.ts, types/api.ts, types/auth.ts) |
| v5.3 | 2026-02-27 | HEMS single-household control types (AssetRecord) |
| v5.4 | 2026-02-27 | PostgreSQL full replacement of DynamoDB types |
| v5.5 | 2026-02-28 | Two-tier KPI types (DashboardMetrics) |
| v5.10 | 2026-03-05 | RLS scope formalization |
| v5.11 | 2026-03-05 | Dual Pool Factory (solfacil_app + solfacil_service) |
| v5.13 | 2026-03-05 | XuhengRawMessage + ParsedTelemetry + Tarifa Branca |
| v5.14 | 2026-03-06 | Formula overhaul: DP solver, ParsedTelemetry +9 battery fields |
| v5.22 | 2026-03-13 | solfacil-protocol.ts, ParsedTelemetry 34 fields, tenant-context.ts JWT support |
| v5.24 | 2026-03-13 | Tariff helper evaluation: decision to keep tariff SQL inline |
| **v6.6** | **2026-03-31** | **p5-db.ts NEW; types/p5.ts NEW; migrations/001_p5_strategy_triggers.sql NEW (P5 Strategy Triggers full-stack persistence)** |
| **v6.7** | **2026-04-02** | **V2.4 protocol upgrade: NEW `protocol-time.ts` (parseProtocolTimestamp dual-format auto-detect); updated `solfacil-protocol.ts` types for V2.4 alarm/scaling fields. File count 9→10.** |

---

## File Inventory

| File | Purpose | Status |
|------|---------|--------|
| `db.ts` | Dual-pool PostgreSQL connection factory (連線池) with RLS-scoped query helper | Stable |
| `p5-db.ts` | P5 Strategy Triggers persistence helpers (strategy_intents + posture_overrides) | **v6.5 NEW** |
| `tarifa.ts` | Tarifa Branca energy economics calculations (ANEEL 3-tier rate structure) | Stable |
| `middleware/tenant-context.ts` | JWT verification + RBAC role enforcement | Stable |
| `types/auth.ts` | Role enum + TenantContext interface | Stable |
| `types/api.ts` | ApiResponse\<T\>, ok(), fail(), domain entities (Organization, Asset, AssetRecord, DashboardMetrics, VppStrategy, DeviceParserRule, ParserRule) | Stable |
| `types/p5.ts` | Strategy Triggers domain model (intents, overrides, posture, overview) | **v6.5 NEW** |
| `types/solfacil-protocol.ts` | MQTT protocol envelope types (SolfacilMessage, SolfacilDevice, GatewayRecord, GatewayFragments) | Stable |
| `types/telemetry.ts` | Xuheng raw message + ParsedTelemetry (34 fields) | Stable |
| `migrations/001_p5_strategy_triggers.sql` | Idempotent DDL for strategy_intents + posture_overrides tables | **v6.5 NEW** |

---

## 1. db.ts --- Dual Pool Architecture

The database module implements a dual-pool (双连接池) singleton pattern, separating tenant-scoped queries (RLS-enforced) from privileged service operations (RLS-bypass).

### 1.1 Connection Pools

#### `getAppPool()` --- Tenant-Scoped Pool

| Parameter | Value |
|-----------|-------|
| PostgreSQL role | `solfacil_app` (NOBYPASSRLS) |
| Max connections | 20 |
| Idle timeout | 30,000 ms |
| Connection timeout | 5,000 ms |
| Default DSN | `postgresql://solfacil_app:solfacil_vpp_2026@127.0.0.1:5433/solfacil_vpp` |

Used by BFF handlers and any code path that must respect Row Level Security. All queries through this pool require `SET LOCAL app.current_org_id` to activate RLS filtering.

#### `getServicePool()` --- Privileged Pool

| Parameter | Value |
|-----------|-------|
| PostgreSQL role | `solfacil_service` (BYPASSRLS) |
| Max connections | 10 |
| Idle timeout | 30,000 ms |
| Connection timeout | 5,000 ms |
| Default DSN | `postgresql://solfacil_service:solfacil_service_2026@127.0.0.1:5433/solfacil_vpp` |

Used by cron jobs, migration runners, and SOLFACIL_ADMIN operations that need cross-tenant visibility.

### 1.2 Environment Variables

| Variable | Precedence | Description |
|----------|------------|-------------|
| `APP_DATABASE_URL` | 1st (app pool) | Explicit app pool DSN |
| `SERVICE_DATABASE_URL` | 1st (service pool) | Explicit service pool DSN |
| `DATABASE_URL` | Fallback (both pools) | Legacy single-DSN fallback |

Resolution order: `APP_DATABASE_URL` > `DATABASE_URL` > hardcoded default (app pool). Same pattern for service pool with `SERVICE_DATABASE_URL`.

### 1.3 Core Functions

#### `queryWithOrg<T>(sql, params, orgId)`

The primary query interface for tenant-aware data access.

- When `orgId` is provided: acquires a client from the **app pool**, opens a transaction, executes `SELECT set_config('app.current_org_id', $1, true)` to set the RLS context (using `SET LOCAL` semantics via `set_config` with `is_local=true`), runs the query, and commits.
- When `orgId` is `null`: acquires a client from the **service pool** (BYPASSRLS), skips the `set_config` call, and executes the query in a transaction. This path is used for SOLFACIL_ADMIN operations.
- On error: rolls back the transaction and re-throws.
- Returns `{ rows: T[] }`.

#### `withTransaction<T>(pool, fn)`

Generic transaction wrapper. Acquires a client, runs `BEGIN`, invokes `fn(client)`, then `COMMIT` on success or `ROLLBACK` on error. The client is always released in the `finally` block.

#### `closeAllPools()`

Graceful shutdown (优雅关闭). Calls `.end()` on both singleton pools in parallel via `Promise.all`. Idempotent: safe to call even if pools were never initialized. Nullifies both pool references before awaiting drain (references set to null, then Promise.all resolves).

### 1.4 Deprecated Aliases

| Deprecated | Replacement | Notes |
|------------|-------------|-------|
| `getPool()` | `getAppPool()` | Pre-v5.11 single-pool API |
| `closePool()` | `closeAllPools()` | Pre-v5.11 single-pool API |

---

## 2. p5-db.ts --- P5 Strategy Triggers Persistence [v6.5 NEW]

Persistence layer for the P5 Strategy Triggers subsystem. All functions use `queryWithOrg` with an explicit `orgId` parameter, ensuring RLS-scoped access through the app pool for tenant operations.

### 2.1 Type Bridges

```typescript
type IntentRow   = StrategyIntent  & Record<string, unknown>;
type OverrideRow = PostureOverride & Record<string, unknown>;
```

These intersection types bridge the gap between the domain interfaces (from `types/p5.ts`) and the `Record<string, unknown>` constraint required by `queryWithOrg`'s generic parameter.

### 2.2 Intent Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `upsertIntent` | `(orgId, intent) => Promise<StrategyIntent>` | INSERT with ON CONFLICT (id) DO UPDATE. Accepts all fields except `id`, `created_at`, `updated_at` (auto-generated). JSONB fields (`evidence_snapshot`, `scope_gateway_ids`, `constraints`, `handoff_snapshot`) are serialized via `JSON.stringify`. Returns the upserted row via `RETURNING *`. |
| `getActiveIntents` | `(orgId) => Promise<StrategyIntent[]>` | Returns non-terminal intents for the org. Excludes statuses in `('expired', 'executed', 'suppressed')`. Sorted by urgency priority (`immediate` > `soon` > `watch`) then `created_at DESC`. |
| `getIntentById` | `(orgId, id) => Promise<StrategyIntent \| null>` | Single-row lookup by org_id + id. Returns `null` if not found. |
| `updateIntentStatus` | `(orgId, id, status, actor, reason?, deferUntil?, deferredBy?) => Promise<StrategyIntent \| null>` | Updates status, actor, decided_at (set to `NOW()`), and optionally `arbitration_note`, `defer_until`, `deferred_by`. Returns the updated row or `null`. |
| `expireStaleIntents` | `(orgId) => Promise<number>` | Bulk-expires non-terminal intents where `expires_at < NOW()`. Sets `status='expired'`, `actor='platform'`. Returns the count of expired rows. |

### 2.3 Terminal Statuses

```
TERMINAL_STATUSES = ('expired', 'executed', 'suppressed')
```

Intents in a terminal status are excluded from active queries and are not eligible for expiration sweeps.

### 2.4 Override Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `createPostureOverride` | `(orgId, override) => Promise<PostureOverride>` | INSERT into posture_overrides. Accepts all fields except `id`, `created_at`, `cancelled_at`, `cancelled_by`, `active` (defaults to `true`). |
| `getActiveOverrides` | `(orgId) => Promise<PostureOverride[]>` | Returns overrides where `active = true AND expires_at > NOW()`. Sorted by `created_at DESC`. |
| `cancelOverride` | `(orgId, id, actor, reason?) => Promise<PostureOverride \| null>` | Sets `active = false`, `cancelled_at = NOW()`, `cancelled_by = actor`. If a reason is provided, appends `[cancelled: <reason>]` to the existing reason text. Only cancels if currently active. |

---

## 3. tarifa.ts --- Energy Economics

Implements Brazil's Tarifa Branca (White Tariff) 3-tier time-of-use rate structure as defined by ANEEL. All functions are pure (纯函数) with no side effects or database access.

### 3.1 Default Rate Constants

```typescript
TARIFA_BRANCA_DEFAULTS = {
  peak:         { startHour: 18, endHour: 21, rateReaisPerKwh: 0.82 },
  intermediate: { ranges: [{17,18}, {21,22}],  rateReaisPerKwh: 0.55 },
  offpeak:      {                               rateReaisPerKwh: 0.25 },
}
```

| Period (Periodo) | Hours | Rate (R$/kWh) |
|------------------|-------|---------------|
| Ponta (peak) | 18:00--21:00 | 0.82 |
| Intermediaria (intermediate) | 17:00--18:00, 21:00--22:00 | 0.55 |
| Fora-ponta (off-peak) | All other hours | 0.25 |

These serve as fallback defaults. Production environments should read from the `tariff_schedules` database table.

### 3.2 Pure Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `classifyHour` | `(hour: number) => TarifaPeriod` | Maps hour (0--23) to `"ponta"`, `"intermediaria"`, or `"fora_ponta"`. Uses hardcoded ANEEL standard boundaries. |
| `getRateForHour` | `(hour, schedule: TariffSchedule \| null) => number` | Returns the R$/kWh rate for a given hour. Falls back to `TARIFA_BRANCA_DEFAULTS` when schedule is null. When schedule lacks an intermediate rate, falls back to the peak rate. |
| `calculateBaselineCost` | `(hourlyLoads, schedule) => number` | Hypothetical cost with no PV and no battery (全量购电成本). Formula: Sigma(load[h] * rate(h)) for h=0..23. |
| `calculateActualCost` | `(hourlyGridImports, schedule) => number` | Actual grid import cost (实际购电成本). Only grid-imported energy incurs cost; PV + battery discharge are free. |
| `calculateBestTouCost` | `(params: BestTouInput) => BestTouResult` | Post-hoc optimal TOU cost via Dynamic Programming (动态规划). Given perfect knowledge of load and PV for each hour, finds the battery charge/discharge schedule minimizing total grid import cost. SoC step = capacity * 5%, state space \|S\| <= 20. Returns `{ bestCost, endSoc }`. |
| `calculateSelfConsumption` | `(pvGenerationKwh, gridExportKwh) => number \| null` | Self-consumption ratio (自消费率): `(pvGen - gridExport) / pvGen * 100`. Returns null if pvGen <= 0. |
| `calculateSelfSufficiency` | `(totalLoadKwh, totalGridImportKwh) => number \| null` | Self-sufficiency ratio (自给率): `(load - gridImport) / load * 100`. Returns null if load <= 0. |

### 3.3 Types

| Type | Description |
|------|-------------|
| `TarifaPeriod` | `"ponta" \| "intermediaria" \| "fora_ponta"` |
| `TariffSchedule` | `{ peakRate, offpeakRate, intermediateRate: number \| null }` |
| `HourlyEnergyRow` | `{ hour, chargeKwh, dischargeKwh }` |
| `BestTouInput` | DP solver input: hourlyData, schedule, capacity, socInitial, socMinPct, maxChargeRateKw, maxDischargeRateKw |
| `BestTouResult` | `{ bestCost: number, endSoc: number }` |

---

## 4. Middleware --- tenant-context.ts

Framework-agnostic tenant authentication and authorization. This file has **zero HTTP/cloud framework dependencies** (no aws-lambda, no express). BFF modules consume it through their own HTTP adapter layer.

### 4.1 `verifyTenantToken(token: string): TenantContext`

Decodes and validates a tenant identity token. Supports two formats:

1. **Raw JSON** (for tests and internal forwarding): Parses `{"userId":"...","orgId":"...","role":"..."}` directly. Validates that all three fields are present and that the role is a member of the `Role` enum.

2. **JWT with HS256 signature** (production path, since v5.23): Strips optional `Bearer ` prefix, calls `jwt.verify(rawToken, jwtSecret)`. The JWT secret is read from `process.env.JWT_SECRET` with a default of `"solfacil-dev-secret"` for local development.

**Error behavior**: Throws `{ statusCode: 401, message: "..." }` on any validation failure (missing token, malformed JSON, invalid JWT signature, expired token, missing claims, invalid role).

### 4.2 `requireRole(ctx: TenantContext, allowedRoles: Role[]): void`

Enforces RBAC (role-based access control).

- `SOLFACIL_ADMIN` bypasses all role checks (super-admin escape hatch).
- For all other roles, checks membership in `allowedRoles`.
- Throws `{ statusCode: 403, message: "Forbidden" }` on failure.

### 4.3 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | `"solfacil-dev-secret"` | HMAC secret for HS256 JWT verification |

---

## 5. Types

### 5.1 types/auth.ts

```typescript
enum Role {
  SOLFACIL_ADMIN = "SOLFACIL_ADMIN",
  ORG_MANAGER    = "ORG_MANAGER",
  ORG_OPERATOR   = "ORG_OPERATOR",
  ORG_VIEWER     = "ORG_VIEWER",
}

interface TenantContext {
  readonly userId: string;
  readonly orgId:  string;
  readonly role:   Role;
}
```

Four-level role hierarchy. `SOLFACIL_ADMIN` is the platform super-admin with full cross-tenant access.

### 5.2 types/api.ts

**Response envelope:**

| Export | Description |
|--------|-------------|
| `ApiResponse<T>` | `{ success, data: T \| null, error: string \| null, timestamp }` |
| `ok<T>(data)` | Factory producing a success response |
| `fail(message)` | Factory producing an error response |

**Domain entities:**

| Entity | Key Fields |
|--------|------------|
| `Organization` | orgId, name, planTier, metadata (JSONB) |
| `Asset` | assetId, orgId, deviceType, ratedPowerKw, status, metadata (JSONB) |
| `AssetRecord` | HEMS single-household record with 3-layer nesting: metering (9 fields), status (8 fields), config (6 fields). Capacity expressed in both kW (inverter) and kWh (battery). |
| `DashboardMetrics` | Org-level KPIs: totalAssets, onlineAssets, avgSoc, totalPowerKw, dailyRevenueReais, monthlyRevenueReais. Optional v5.5 two-tier fields: vppArbitrageProfit (B-side wholesale), clientSavings (C-side retail), selfConsumption. |
| `VppStrategy` | Strategy configuration: minSoc, maxSoc, emergencySoc, profitMargin, activeHours, activeWeekdays |
| `DeviceParserRule` | M8 Admin device parser: manufacturer, modelVersion, mappingRule, unitConversions |
| `ParserRule` | M1 Dynamic Parser Engine: mappings keyed by fieldId with domain/sourcePath/valueType. Optional `iterator` for splitting one MQTT message into N telemetry records. |

**Request/response types for M8 Admin:** `CreateDeviceParserRuleRequest`, `UpdateVppStrategyRequest`, `CreateVppStrategyRequest`, `AdminListResponse<T>`, `AdminItemResponse<T>`.

### 5.3 types/p5.ts [v6.5 NEW]

Strategy Triggers domain model. Defines the complete type system for the P5 subsystem.

**Union type enums:**

| Type | Values |
|------|--------|
| `StrategyFamily` | `peak_shaving`, `tariff_arbitrage`, `reserve_protection`, `curtailment_mitigation`, `resilience_preparation`, `external_dr` |
| `IntentStatus` | `active`, `approved`, `deferred`, `suppressed`, `escalated`, `expired`, `executed` |
| `GovernanceMode` | `observe`, `approval_required`, `auto_governed`, `escalate` |
| `Urgency` | `immediate`, `soon`, `watch` |
| `OverrideType` | `force_protective`, `suppress_economic`, `force_approval_gate`, `manual_escalation_note`, `suppress_alerts` |
| `Posture` | `calm`, `approval_gated`, `protective`, `escalation` |
| `CalmReason` | `no_conditions_detected`, `telemetry_stale`, `override_suppressing`, `protection_dominant`, `all_deferred` |

**DB row types:**

| Interface | Description |
|-----------|-------------|
| `StrategyIntent` | 22-field row mapping for `strategy_intents` table. JSONB columns: evidence_snapshot, scope_gateway_ids, constraints, handoff_snapshot. Nullable timestamp fields: decided_at, expires_at, defer_until. |
| `PostureOverride` | 12-field row mapping for `posture_overrides` table. Tracks active/cancelled state with scope_gateway_ids (JSONB). |

**API response shapes:**

| Interface | Description |
|-----------|-------------|
| `IntentCard` | Summary card for intent list views: id, family, title, urgency, governance_mode, status, reason_summary, scope_summary, time_pressure, recovery_condition, created_at |
| `IntentDetail` | Full detail view extending IntentCard with evidence_snapshot, constraints, next_path, arbitration_note, handoff_snapshot, available_actions, history |
| `NextPath` | Decision tree: if_approved, if_deferred, if_no_action, suggested_playbook |
| `IntentEvent` | Audit trail entry: status, actor, timestamp, reason |
| `HeroPosture` | Top-level posture indicator: posture, dominant_driver, governance_mode, governance_summary, override_active, conflict_active, operator_action_needed |
| `CalmExplanation` | Explains why posture is calm: reason, detail, contributing_factors |
| `PostureSummary` | Override summary: active_overrides count, dominant_override_type, scope_description |
| `ProtectorSummary` | Active protection intent summary with current_soc and threshold |
| `HandoffSummary` | Escalated intent reference for handoff display |
| `DeferContext` | Deferred intent metadata: case_fingerprint, deferred_intent_id, defer_until, deferred_by, deferred_at |
| `P5Overview` | Top-level overview aggregating hero posture, calm explanation, intent lists (need_decision_now, platform_acting, watch_next), defer context, and operating context |

### 5.4 types/solfacil-protocol.ts

MQTT protocol types for the Solfacil IoT gateway communication layer.

| Type | Description |
|------|-------------|
| `SolfacilMessage` | Protocol envelope: DS, ackFlag, clientId, deviceName, productKey, messageId, timeStamp (epoch ms as string), data |
| `SolfacilDevice` | Sub-device entry in deviceList payload. Fields: bindStatus, connectStatus, deviceBrand, deviceSn, fatherSn, name, nodeType (`major`/`minor`), productType (`meter`/`inverter`/`ems`), vendor, plus optional fields (modelId, portName, etc.) |
| `SolfacilListItem` | Telemetry list item (batList, gridList, pvList). Contains `properties: Record<string, string>` for dynamic field access. |
| `GatewayRecord` | Database row for gateways table: gateway_id, org_id, MQTT connection fields, status, last_seen_at |
| `GatewayFragments` | Accumulated fragments for one gateway's telemetry cycle. Optional fields per fragment type: ems, dido (digital I/O with DO/DI arrays), meters, core. |
| `FragmentType` | `"ems" \| "dido" \| "meter" \| "core"` |
| `AssetType` | `"SMART_METER" \| "INVERTER_BATTERY" \| "EMS"` |
| `mapProductType(productType)` | Maps protocol `productType` string to domain `AssetType` enum |

### 5.5 types/telemetry.ts

**`XuhengRawMessage`** --- Raw Xuheng EMS MSG#4 as received from MQTT topic `xuheng/+/+/data`. Contains nested arrays (batList, pvList, gridList, loadList, flloadList, emsList) plus optional dido (digital I/O) block. All values are strings at the protocol level.

**`ParsedTelemetry`** --- Canonical telemetry record after parsing. All values numeric in SI units. 34 fields total:

| Group | Fields | Count |
|-------|--------|-------|
| Identity | clientId, deviceSn, recordedAt | 3 |
| Battery core | batterySoc, batteryPowerKw, dailyChargeKwh, dailyDischargeKwh | 4 |
| PV | pvPowerKw, pvDailyEnergyKwh | 2 |
| Grid | gridPowerKw, gridDailyBuyKwh, gridDailySellKwh | 3 |
| Load | loadPowerKw, flloadPowerKw | 2 |
| Battery deep (v5.14) | batterySoh, batteryVoltage, batteryCurrent, batteryTemperature, maxChargeVoltage, maxChargeCurrent, maxDischargeCurrent, totalChargeKwh, totalDischargeKwh | 9 |
| Digital I/O (v5.16) | do0Active, do1Active | 2 |
| Hot-path (v5.18, optional) | inverterTemp, pvTotalEnergyKwh, pv1Voltage, pv1Current, pv1Power, pv2Voltage, pv2Current, pv2Power | 8 |
| Extra (v5.18, optional) | telemetryExtra (JSONB per-phase diagnostics) | 1 |
| **Total** | | **34** |

**`XuhengMessageType`** --- Discriminator: `0 | 1 | 2 | 3 | 4`.

---

## 6. Migration System

### 6.1 Approach: Idempotent DDL (幂等迁移)

All migration files use `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, and conditional policy creation via `DO $$ ... IF NOT EXISTS ... $$` blocks. This means migrations are safe to re-run without error and without data loss.

### 6.2 migrations/001_p5_strategy_triggers.sql

Creates the P5 Strategy Triggers schema in four sections:

**Section 1 --- `strategy_intents` table:**
- `id`: BIGSERIAL PRIMARY KEY
- `org_id`: VARCHAR(50), FK to `organizations(org_id)`
- `family`: VARCHAR(50) with CHECK constraint (6 valid families)
- `status`: VARCHAR(30) with CHECK constraint (7 valid statuses)
- `governance_mode`: VARCHAR(30) with CHECK constraint (4 valid modes)
- `urgency`: VARCHAR(20) with CHECK constraint (3 valid levels)
- Text fields: title, reason_summary, scope_summary, suggested_playbook, arbitration_note, actor
- JSONB fields: evidence_snapshot (NOT NULL), scope_gateway_ids (default `'[]'`), constraints, handoff_snapshot
- Timestamp fields: decided_at, created_at (NOT NULL, default NOW()), updated_at (NOT NULL, default NOW()), expires_at
- v0.1b additions: `defer_until` TIMESTAMPTZ, `deferred_by` TEXT (added via `ADD COLUMN IF NOT EXISTS`)
- Indexes: `idx_strategy_intents_org` (org_id), `idx_strategy_intents_status` (status)

**Section 2 --- `posture_overrides` table:**
- `id`: BIGSERIAL PRIMARY KEY
- `org_id`: VARCHAR(50), FK to `organizations(org_id)`
- `override_type`: VARCHAR(50) with CHECK constraint (4 valid types: force_protective, suppress_economic, force_approval_gate, manual_escalation_note)
- Text fields: reason (NOT NULL), actor (NOT NULL)
- `active`: BOOLEAN, default true
- JSONB: scope_gateway_ids (default `'[]'`)
- Timestamps: starts_at (default NOW()), expires_at (NOT NULL), cancelled_at, created_at (default NOW())
- `cancelled_by`: VARCHAR(100)
- Index: `idx_posture_overrides_org_active` (org_id, active)

**Section 3 --- Row Level Security:**
- Both tables have RLS enabled via `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
- Policies use conditional creation (`IF NOT EXISTS` in `pg_policies` check)
- Policy logic: allow access when `app.current_org_id = 'SOLFACIL'` (admin bypass) OR `org_id = app.current_org_id` (tenant isolation)
- `set_config('app.current_org_id', ..., true)` is set per-transaction by `queryWithOrg` in `db.ts`

**Section 4 --- Schema evolution (v0.1b):**
- `ALTER TABLE strategy_intents ADD COLUMN IF NOT EXISTS defer_until TIMESTAMPTZ DEFAULT NULL`
- `ALTER TABLE strategy_intents ADD COLUMN IF NOT EXISTS deferred_by TEXT DEFAULT NULL`

---

## 7. Dependency Graph

```
middleware/tenant-context.ts
    └── types/auth.ts          (Role, TenantContext)

db.ts
    └── pg                     (Pool, PoolClient)

p5-db.ts
    ├── db.ts                  (queryWithOrg)
    └── types/p5.ts            (StrategyIntent, PostureOverride, IntentStatus)

tarifa.ts
    └── (no internal deps)     pure functions only

types/api.ts
    └── (no internal deps)

types/p5.ts
    └── (no internal deps)

types/solfacil-protocol.ts
    └── (no internal deps)

types/telemetry.ts
    └── (no internal deps)
```

Key design constraint: `middleware/tenant-context.ts` has zero HTTP/cloud framework imports. It accepts raw strings and returns plain objects. BFF modules (M5), Admin (M8), and Market Billing (M4) each provide their own HTTP adapter to extract the token from request headers and call `verifyTenantToken`.

---

## 8. Cross-Module Usage Map

| Shared Export | Consuming Modules |
|---------------|-------------------|
| `getAppPool()` / `getServicePool()` | M1 IoT Hub, M2 Optimization, M4 Market Billing, M5 BFF, M7 Open API, M8 Admin |
| `queryWithOrg()` | M5 BFF handlers, M8 Admin handlers, p5-db.ts |
| `withTransaction()` | M1 telemetry ingestion, M4 billing jobs |
| `verifyTenantToken()` | M5 BFF auth middleware, M8 Admin auth middleware |
| `requireRole()` | M5 BFF route guards, M8 Admin route guards |
| `ok()` / `fail()` | All BFF and Admin API handlers |
| `classifyHour()` / `getRateForHour()` | M4 daily billing job, M5 energy analytics |
| `calculateBestTouCost()` | M2 Optimization Engine |
| P5 persistence (p5-db.ts) | M5 BFF P5 handlers |
| `ParsedTelemetry` | M1 parser, M2 optimizer, M5 telemetry views |
| `SolfacilMessage` / `GatewayFragments` | M1 MQTT ingestion pipeline |

---

## 9. Code Change Summary (v5.22 -> v6.6)

| File | Action | Version | Description |
|------|--------|---------|-------------|
| `p5-db.ts` | **NEW** | v6.5 | Strategy intent + posture override CRUD |
| `types/p5.ts` | **NEW** | v6.5 | 7 union types, 2 DB row interfaces, 11 API response interfaces |
| `migrations/001_p5_strategy_triggers.sql` | **NEW** | v6.5 | Idempotent DDL: 2 tables, 3 indexes, 2 RLS policies, 2 ALTER additions |
| `db.ts` | unchanged | v5.11 | --- |
| `tarifa.ts` | unchanged | v5.14 | --- |
| `middleware/tenant-context.ts` | unchanged | v5.23 | --- |
| `types/auth.ts` | unchanged | v5.2 | --- |
| `types/api.ts` | unchanged | v5.5 | --- |
| `types/solfacil-protocol.ts` | **UPDATED** | v6.7 | V2.4 type additions: alarm event types, scaling factor constants, lowercase key aliases |
| `types/telemetry.ts` | unchanged | v5.18 | --- |
| `protocol-time.ts` | **NEW** | v6.7 | `parseProtocolTimestamp()`: auto-detects ISO 8601 (V2.4) vs legacy numeric epoch (V1.x), returns `Date`. Used by M1 heartbeat/telemetry/alarm handlers |

---

## V2.4 Protocol Impact

**Two files added/changed in M9 for V2.4:**

1. **`protocol-time.ts` (NEW)** — Exports `parseProtocolTimestamp(raw: string \| number): Date` which auto-detects ISO 8601 strings (V2.4: `"2026-04-02T03:15:00Z"`) vs Unix epoch numbers (V1.x: `1743566100`). All M1 handlers import this instead of doing inline timestamp parsing. This is the single point of V1.x/V2.4 coexistence logic for time handling.

2. **`types/solfacil-protocol.ts` (UPDATED)** — Added V2.4-specific type definitions: `GatewayAlarmEvent` interface, scaling factor constants (`VOLTAGE_SCALE = 0.1`, `POWER_FACTOR_SCALE = 0.001`, `ENERGY_DIVISOR = 10`), lowercase key type aliases for dual-key compatibility in BFF handlers.

File count: 9 → 10 (+1 `protocol-time.ts`).
