# Module 8: Admin Control Plane — Global Control Plane (全局控制面)

> **模組版本**: v5.2
> **上層文件**: [00_MASTER_ARCHITECTURE_v5.2.md](./00_MASTER_ARCHITECTURE_v5.2.md)
> **最後更新**: 2026-02-27
> **說明**: 全局控制面 — Data Dictionary、配置 CRUD、AppConfig CDK、Canary 部署、Control Plane UI、VPP 策略

---

## 1. Architectural Law: Control Plane vs. Data Plane (全局法則)

> **ADR Status:** ACCEPTED | **Decision Date:** 2026-02-21

### The Supreme Principle

**Control Plane (控制面) — Module 8**
- System's **Single Source of Truth for Configuration**
- Responsibilities: dynamic configuration, business rules, thresholds, permission matrices, feature flags, API quotas
- **All business rule changes MUST and CAN ONLY originate from M8**
- **v5.2:** Owns the **Global Data Dictionary** — canonical registry of every telemetry field
- Publishes `ConfigUpdated` and `SchemaEvolved` events via EventBridge

**Data Plane (數據面) — Modules 1-7**
- **Iron Law (鐵律): Any mutable business rule or threshold MUST NOT be hardcoded in M1-M7**
- Configuration loaded dynamically from M8 via AppConfig at Lambda cold start or upon events
- Data Plane modules are consumers of configuration, never producers

**Code that violates this law SHALL NOT be merged into the main branch.**

---

## 2. 核心職責與設計哲學

- **Configuration-Driven（配置驅動）：** M8 是 VPP 系統的「大腦設定面板」
- **No-Code Operations（無代碼營運）：** 非技術人員可透過 UI 管理設備對接規則與策略
- **Global Data Dictionary（v5.2）：** 每個遙測欄位的規範註冊中心

---

## 3. Grand Fusion Matrix — 8-Module Configuration Dependency

| Module | Configuration Type | AppConfig Profile | Read Timing |
|--------|-------------------|-------------------|-------------|
| **M1** IoT Hub | Device parser rules | `vpp-m1-parser-rules` | Cold start + `ConfigUpdated{M1}` |
| **M2** Algorithm Engine | Strategy thresholds | `vpp-strategies` | Before each schedule trigger |
| **M3** DR Dispatcher | Dispatch policies | `dispatch-policies` | Cold start + `ConfigUpdated{M3}` |
| **M4** Market & Billing | Billing rules | `billing-rules` | Every billing calculation |
| **M5** Frontend BFF | Feature flags | `feature-flags` | Every API request |
| **M6** Identity & Tenant | RBAC policies | `rbac-policies` | Token issuance + JWT validation |
| **M7** Open API | API quotas + webhook backoff | `api-quotas` | Every API request |

---

## 4. Configuration Distribution — AWS AppConfig + Lambda Extension

### Architecture: M8 → AppConfig → Lambda Extension → M1-M7

1. **運營人員修改配置** → M8 Lambda 執行 dual-write（DynamoDB + AppConfig StartDeployment）
2. **AppConfig Canary Deployment** → 10% → 觀察 → 100%，CloudWatch Alarm 觸發自動回滾
3. **Lambda Extension (Sidecar)** → 每 45 秒拉取最新配置，localhost:2772 讀取（< 1ms）
4. **M1-M7 業務代碼** → `http://localhost:2772/applications/solfacil-vpp/environments/prod/configurations/{profile}`

### AppConfig 資源規劃（CDK AdminControlPlaneStack）

**Application:** `solfacil-vpp`

**Configuration Profiles (8 個):**

| Profile | Module | Content |
|---------|--------|---------|
| `parser-rules` | M1 | 各廠商 field_mapping + unit_conversions (v4.x) |
| `vpp-m1-parser-rules` | M1 | v5.2 JSON-driven field mapping rules (Business Trilogy) |
| `vpp-strategies` | M2 | min_soc, max_soc, emergency_soc, profit_margin |
| `dispatch-policies` | M3 | max_retry_count, timeout_minutes |
| `billing-rules` | M4 | tariff_penalty_multiplier, operating_cost_per_kwh |
| `feature-flags` | M5 | flag_name → is_enabled, target_org_ids |
| `rbac-policies` | M6 | role → resource → actions 矩陣 |
| `api-quotas` | M7 | partner_id → calls_per_minute, burst_limit |

### JSON Schema Validators (Shift-Left Validation)

每個 Profile 綁定 JSON Schema 驗證器。配置錯誤在發佈第 0 秒被攔截。

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "patternProperties": {
    "^ORG_[A-Z0-9_]+$": {
      "type": "object",
      "required": ["min_soc", "max_soc", "emergency_soc", "profit_margin"],
      "properties": {
        "min_soc": { "type": "number", "minimum": 10, "maximum": 50 },
        "max_soc": { "type": "number", "minimum": 70, "maximum": 100 },
        "emergency_soc": { "type": "number", "minimum": 5, "maximum": 20 },
        "profit_margin": { "type": "number", "minimum": 0.01, "maximum": 0.5 }
      }
    }
  }
}
```

**各 Profile 核心約束：**
- `parser-rules`: field_mapping 必須是 object，factor 必須是正數
- `vpp-strategies`: min_soc < max_soc, emergency_soc < min_soc
- `dispatch-policies`: max_retry_count ≤ 5, timeout_minutes 5-60
- `billing-rules`: operating_cost_per_kwh 必須是正數
- `feature-flags`: is_enabled 必須是 boolean
- `api-quotas`: burst_limit ≤ calls_per_minute × 2

### Deployment Strategy

- **Production:** Canary 10% → 10 分鐘觀察 → 90% 全量（共 20 分鐘）
- **Rollback Trigger:** CloudWatch Alarm（Lambda Error Rate > 1%）
- **Development:** Linear 100%（立即全量）

---

## 5. Global Data Dictionary Service (v5.2)

### DynamoDB Table: `vpp-data-dictionary`

```
Table: vpp-data-dictionary
PK: orgId (String)           — Partition key (tenant isolation)
SK: fieldId (String)         — Sort key (e.g., "status.chiller_temp")
Attributes:
  domain        (String)     — 'metering' | 'status' | 'config'
  displayName   (String)     — Human-readable label
  unit          (String)     — SI unit (e.g., "kW", "%", "°C")
  valueType     (String)     — 'number' | 'string' | 'boolean'
  sourcePath    (String)     — MQTT JSONPath source
  transform     (String)     — Transformation rule
  createdBy     (String)     — userId
  createdAt     (String)     — ISO 8601

GSI: domain-index
  PK: domain
  SK: fieldId
  Purpose: "List all metering fields across all orgs"
```

### Atomic Dual-Write: AppConfig + DynamoDB

```typescript
async function publishNewField(entry: DataDictionaryEntry, parserRule: ParserRule): Promise<void> {
  // 1. Write to DynamoDB (persistent record)
  await dynamoDB.put({ TableName: 'vpp-data-dictionary', Item: entry });

  // 2. Update AppConfig (M1 will hot-reload within 90s)
  const currentRules = await getAppConfigRules();
  const updatedRules = [...currentRules, parserRule];
  await appConfig.createHostedConfigurationVersion({
    ApplicationId: VPP_APP_ID,
    ConfigurationProfileId: M1_PARSER_RULES_PROFILE_ID,
    Content: JSON.stringify({ version: '5.2', rules: updatedRules }),
    ContentType: 'application/json'
  });

  // 3. Publish SchemaEvolved event
  await eventBridge.putEvents({
    Entries: [{
      Source: 'vpp.m8.admin',
      DetailType: 'SchemaEvolved',
      Detail: JSON.stringify({
        fieldId: entry.fieldId, domain: entry.domain, action: 'ADD',
        traceId: `vpp-${uuidv4()}`
      })
    }]
  });
}
```

### FieldDependency — Dependency Lock (防刪鎖死 Guardrails)

Before any field deletion, M8 scans downstream modules for references:

```typescript
async function checkFieldDependencies(fieldId: string): Promise<FieldDependency[]> {
  const tables = [
    { table: 'vpp-m2-strategies', module: 'M2' },
    { table: 'vpp-m3-dispatch-rules', module: 'M3' },
    { table: 'vpp-m4-billing-formulas', module: 'M4' },
    { table: 'vpp-m5-widgets', module: 'M5' }
  ];
  const deps: FieldDependency[] = [];
  for (const { table, module } of tables) {
    const records = await dynamoDB.scan({
      TableName: table,
      FilterExpression: 'contains(fieldRefs, :fid)',
      ExpressionAttributeValues: { ':fid': fieldId }
    });
    deps.push(...(records.Items ?? []).map(item => ({
      moduleId: module as FieldDependency['moduleId'],
      configType: item.configType,
      configId: item.configId,
      configName: item.configName,
      usageContext: item.usageContext ?? 'referenced field'
    })));
  }
  return deps;
}

async function deleteField(fieldId: string, requestedBy: string): Promise<void> {
  const deps = await checkFieldDependencies(fieldId);
  if (deps.length > 0) {
    throw new DependencyLockError({
      message: `Cannot delete field "${fieldId}" — ${deps.length} dependency(s) found`,
      blockedBy: deps.map(d => `${d.moduleId} / ${d.configName} (${d.usageContext})`),
      resolution: 'Remove all references before deleting.'
    });
  }
  await Promise.all([
    dynamoDB.delete({ TableName: 'vpp-data-dictionary', Key: { fieldId } }),
    removeRuleFromAppConfig(fieldId),
    eventBridge.putEvents({ Entries: [{ Source: 'vpp.m8.admin', DetailType: 'SchemaFieldRemoved',
      Detail: JSON.stringify({ fieldId, removedBy: requestedBy }) }] })
  ]);
}
```

### SchemaEvolved Event Consumers

| Module | Reaction |
|--------|----------|
| M1 (IoT Hub) | No action — AppConfig Extension auto-reloads |
| M2 (Algorithm Engine) | Invalidates field-selector cache |
| M3 (DR Dispatcher) | No action (does not consume fields directly) |
| M4 (Market & Billing) | Updates field selector dropdown |
| M5 (Frontend BFF) | Invalidates dashboard field cache |
| M7 (Open API) | Updates API schema documentation |

---

## 6. M8 Core Data Tables

### 6.1 device_parser_rules

```sql
CREATE TABLE device_parser_rules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          TEXT NOT NULL REFERENCES organizations(org_id),
    rule_name       TEXT NOT NULL,
    manufacturer    TEXT NOT NULL,
    version         TEXT NOT NULL DEFAULT '1.0',
    field_mapping   JSONB NOT NULL DEFAULT '{}',
    unit_conversions JSONB NOT NULL DEFAULT '{}',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_by      TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_org_rule_name UNIQUE (org_id, rule_name)
);
ALTER TABLE device_parser_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_parser_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_parser_rules ON device_parser_rules
    USING (org_id = current_setting('app.current_org_id'));
```

### 6.2 vpp_strategies

```sql
CREATE TABLE vpp_strategies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          TEXT NOT NULL REFERENCES organizations(org_id),
    strategy_name   TEXT NOT NULL,
    description     TEXT,
    min_soc         NUMERIC(5,2) NOT NULL DEFAULT 20.0,
    max_soc         NUMERIC(5,2) NOT NULL DEFAULT 90.0,
    profit_margin   NUMERIC(8,4) NOT NULL DEFAULT 0.0,
    active_hours    JSONB NOT NULL DEFAULT '{"start": "00:00", "end": "23:59"}',
    active_weekdays JSONB NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
    emergency_soc   NUMERIC(5,2) NOT NULL DEFAULT 10.0,
    is_active       BOOLEAN NOT NULL DEFAULT FALSE,
    is_default      BOOLEAN NOT NULL DEFAULT FALSE,
    created_by      TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_org_strategy_name UNIQUE (org_id, strategy_name),
    CONSTRAINT chk_soc_range CHECK (min_soc < max_soc AND emergency_soc < min_soc),
    CONSTRAINT chk_profit_positive CHECK (profit_margin >= 0)
);
ALTER TABLE vpp_strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE vpp_strategies FORCE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX idx_strategies_default ON vpp_strategies(org_id) WHERE is_default = TRUE;
```

### 6.3 dispatch_policies

```sql
CREATE TABLE dispatch_policies (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                      TEXT NOT NULL REFERENCES organizations(org_id),
    max_retry_count             INT NOT NULL DEFAULT 3,
    retry_backoff_seconds       INT NOT NULL DEFAULT 60,
    max_concurrent_dispatches   INT NOT NULL DEFAULT 10,
    timeout_minutes             INT NOT NULL DEFAULT 15,
    created_by                  TEXT NOT NULL,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_dispatch_policy_org UNIQUE (org_id),
    CONSTRAINT chk_retry_positive CHECK (max_retry_count > 0),
    CONSTRAINT chk_timeout_positive CHECK (timeout_minutes > 0)
);
ALTER TABLE dispatch_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_policies FORCE ROW LEVEL SECURITY;
```

### 6.4 billing_rules

```sql
CREATE TABLE billing_rules (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                      TEXT NOT NULL REFERENCES organizations(org_id),
    tariff_penalty_multiplier   NUMERIC(4,2) NOT NULL DEFAULT 1.5,
    tariff_effective_period     TEXT NOT NULL DEFAULT 'monthly',
    operating_cost_per_kwh      NUMERIC(8,4) NOT NULL,
    created_by                  TEXT NOT NULL,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_billing_rules_org UNIQUE (org_id),
    CONSTRAINT chk_penalty_positive CHECK (tariff_penalty_multiplier > 0),
    CONSTRAINT chk_cost_positive CHECK (operating_cost_per_kwh >= 0),
    CONSTRAINT chk_effective_period CHECK (tariff_effective_period IN ('monthly', 'quarterly', 'annually'))
);
ALTER TABLE billing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_rules FORCE ROW LEVEL SECURITY;
```

### 6.5 feature_flags

```sql
CREATE TABLE feature_flags (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flag_name       TEXT NOT NULL,
    is_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
    target_org_ids  JSONB DEFAULT 'null'::jsonb,
    valid_from      TIMESTAMPTZ,
    valid_until     TIMESTAMPTZ,
    description     TEXT,
    created_by      TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_feature_flag_name UNIQUE (flag_name),
    CONSTRAINT chk_valid_window CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from < valid_until)
);
-- No RLS: managed exclusively by SOLFACIL_ADMIN
```

### 6.6 api_quotas

```sql
CREATE TABLE api_quotas (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id      TEXT NOT NULL,
    org_id          TEXT NOT NULL REFERENCES organizations(org_id),
    calls_per_minute INT NOT NULL DEFAULT 60,
    calls_per_day   INT NOT NULL DEFAULT 10000,
    burst_limit     INT NOT NULL DEFAULT 100,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_by      TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_api_quota_partner UNIQUE (partner_id),
    CONSTRAINT chk_rpm_positive CHECK (calls_per_minute > 0)
);
ALTER TABLE api_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_quotas FORCE ROW LEVEL SECURITY;
```

---

## 7. M8 REST API Endpoints

> All endpoints require authentication. Minimum role: `ORG_MANAGER`. Delete: `SOLFACIL_ADMIN`.

### Device Parser Rules API

| Method | Endpoint | Min Role |
|--------|----------|----------|
| `GET` | `/admin/parsers` | ORG_MANAGER |
| `POST` | `/admin/parsers` | ORG_MANAGER |
| `GET` | `/admin/parsers/:id` | ORG_MANAGER |
| `PUT` | `/admin/parsers/:id` | ORG_MANAGER |
| `PATCH` | `/admin/parsers/:id/activate` | ORG_MANAGER |
| `DELETE` | `/admin/parsers/:id` | SOLFACIL_ADMIN |

### VPP Strategy API

| Method | Endpoint | Min Role |
|--------|----------|----------|
| `GET` | `/admin/strategies` | ORG_MANAGER |
| `POST` | `/admin/strategies` | ORG_MANAGER |
| `PUT` | `/admin/strategies/:id` | ORG_MANAGER |
| `POST` | `/admin/strategies/:id/activate` | ORG_MANAGER |
| `DELETE` | `/admin/strategies/:id` | SOLFACIL_ADMIN |

### Dispatch Policies API

| Method | Endpoint | Min Role |
|--------|----------|----------|
| `GET` | `/admin/dispatch-policies` | ORG_MANAGER |
| `PUT` | `/admin/dispatch-policies` | ORG_MANAGER |

### Billing Rules API

| Method | Endpoint | Min Role |
|--------|----------|----------|
| `GET` | `/admin/billing-rules` | ORG_MANAGER |
| `PUT` | `/admin/billing-rules` | ORG_MANAGER |

### Feature Flags API

| Method | Endpoint | Min Role |
|--------|----------|----------|
| `GET` | `/admin/feature-flags` | SOLFACIL_ADMIN |
| `POST` | `/admin/feature-flags` | SOLFACIL_ADMIN |
| `PUT` | `/admin/feature-flags/:id` | SOLFACIL_ADMIN |
| `PATCH` | `/admin/feature-flags/:id/toggle` | SOLFACIL_ADMIN |
| `DELETE` | `/admin/feature-flags/:id` | SOLFACIL_ADMIN |

### API Quotas API

| Method | Endpoint | Min Role |
|--------|----------|----------|
| `GET` | `/admin/api-quotas` | ORG_MANAGER |
| `POST` | `/admin/api-quotas` | ORG_MANAGER |
| `PUT` | `/admin/api-quotas/:id` | ORG_MANAGER |
| `PATCH` | `/admin/api-quotas/:id/toggle` | ORG_MANAGER |
| `DELETE` | `/admin/api-quotas/:id` | SOLFACIL_ADMIN |

### Data Dictionary API (v5.2)

| Method | Endpoint | Min Role |
|--------|----------|----------|
| `GET` | `/admin/data-dictionary` | ORG_MANAGER |
| `POST` | `/admin/data-dictionary` | ORG_MANAGER |
| `GET` | `/admin/data-dictionary/:fieldId` | ORG_MANAGER |
| `PUT` | `/admin/data-dictionary/:fieldId` | ORG_MANAGER |
| `DELETE` | `/admin/data-dictionary/:fieldId` | SOLFACIL_ADMIN |

---

## 8. Control Plane UI — M1 Parser Editor (v5.2)

### Three-Panel Layout

```
┌─────────────────────────┬──────────────────┬─────────────────────────┐
│   LEFT PANEL            │   CENTER         │   RIGHT PANEL           │
│   Live MQTT Tree View   │   Drag-to-Bind   │   Business Trilogy Tabs │
│                         │   Arrows         │                         │
│   ▼ gateway_payload     │                  │   [Metering] [Status] [Config]
│     ▼ grid              │     ─────────►   │                         │
│       activePower: 3200 │                  │   ● metering.grid_power │
│       voltage: 220.5    │     ─────────►   │   ● metering.voltage    │
│     ▼ batList           │                  │                         │
│       ▼ [0]             │     ─────────►   │   ● status.battery_soc  │
│         bat_soc: 85     │                  │   ● status.chiller_temp │
│     ▼ cooling           │                  │     [+ Add Field]       │
│       ▼ chiller         │                  │                         │
│         temp_celsius:42 │                  │   ─── Live Preview ──── │
│                         │                  │   { "status": {         │
│                         │                  │       "battery_soc": 85,│
│                         │                  │       "chiller_temp":42 │
│                         │                  │   }}                    │
│                         │                  │   [Deploy]              │
└─────────────────────────┴──────────────────┴─────────────────────────┘
```

### Operator Workflow — Adding `status.chiller_temp`

1. Gateway sends MQTT payload containing `cooling.chiller.temp_celsius: 42.3`
2. Operator sees it in left panel tree (real-time)
3. Clicks "+ Add Field" in Status tab
4. Enters: Field Name=`status.chiller_temp`, Type=`number`, Unit=`°C`
5. Drags from source to target → auto-populates `sourcePath`
6. System auto-suggests transform (`identity` or `divide:N`)
7. Clicks **Deploy** → triggers atomic dual-write workflow
8. M8 validates → DynamoDB write → AppConfig version → SchemaEvolved event

---

## 9. Runtime Schema Evolution — Magic Workflow (v5.2)

| Time | Event |
|------|-------|
| T+0s | Engineer clicks **Deploy** |
| T+1s | M8 validates entry against JSON Schema |
| T+3s | M8 writes to DynamoDB `vpp-data-dictionary` |
| T+5s | M8 creates new AppConfig version |
| T+6s | M8 publishes `SchemaEvolved` to EventBridge |
| T+15s | Downstream modules receive event |
| T+90s | All Lambda instances hot-reload AppConfig |
| T+90s | M1 translates new field; M2/M4 show new field in selectors |

**Zero code changes. Zero deployments. Zero PR reviews.**

### Business Impact — v5.1 vs v5.2

| | v5.1 | v5.2 |
|---|------|------|
| Process | Developer code → PR → review → deploy | Operator clicks Deploy in UI |
| Duration | 2-5 business days | ~90 seconds |
| Improvement | — | **99.97%** reduction |

---

## 10. CDK Stack

| Resource | Purpose |
|----------|---------|
| `AdminParsersLambda` | CRUD for `device_parser_rules` |
| `AdminStrategiesLambda` | CRUD for `vpp_strategies` |
| `AdminDataDictionaryLambda` | v5.2: CRUD + atomic dual-write |
| DynamoDB `vpp-data-dictionary` | v5.2: Global Data Dictionary table |
| AppConfig Application + 8 Profiles | Configuration distribution |
| API Gateway routes: `/admin/*` | Admin API endpoints |

---

## 11. Migration Path (v5.1 → v5.2)

| # | Module | Change | Breaking? | Effort |
|---|--------|--------|-----------|--------|
| 1 | M1 | Replace flat `StandardTelemetry` with Business Trilogy envelope | Yes | Medium |
| 2 | M1 | Add `translation-executor.ts` | No | Low |
| 3 | M8 | Add `vpp-data-dictionary` DynamoDB table | No | Low |
| 4 | M8 | Add `vpp-m1-parser-rules` AppConfig Profile | No | Low |
| 5 | M8 | Add `publishNewField()` Lambda | No | Medium |
| 6 | M2-M5 | Update field access: `telemetry.metering.*` / `telemetry.status.*` | Yes | Medium |
| 7 | AppConfig | Seed parser rules with existing mappings | No | Low |

### Rollback Plan

1. **AppConfig:** One-click rollback to previous version
2. **M1 Tier 3 fallback:** Auto-emit raw payloads
3. **Code rollback:** Revert to v5.1 flat interface
4. **Data Dictionary:** Leave DynamoDB table in place (no harm)

---

## 模組依賴關係

| 方向 | 模組 | 說明 |
|------|------|------|
| **被依賴** | M1 (IoT Hub) | AppConfig `vpp-m1-parser-rules` |
| **被依賴** | M2 (Optimization Engine) | AppConfig `vpp-strategies` |
| **被依賴** | M3 (DR Dispatcher) | AppConfig `dispatch-policies` |
| **被依賴** | M4 (Market & Billing) | AppConfig `billing-rules` |
| **被依賴** | M5 (BFF) | AppConfig `feature-flags` |
| **被依賴** | M6 (Identity) | AppConfig `rbac-policies` |
| **被依賴** | M7 (Open API) | AppConfig `api-quotas` |
| **依賴** | M4 (Market & Billing) | 共享 RDS PostgreSQL VPC |
