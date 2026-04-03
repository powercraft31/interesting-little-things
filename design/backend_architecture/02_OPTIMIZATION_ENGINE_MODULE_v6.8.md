# Module 2: Optimization Engine (M2)

> **Module Version**: v6.8
> **Git HEAD**: `b94adf3`
> **Parent Document**: [00_MASTER_ARCHITECTURE_v6.8.md](./00_MASTER_ARCHITECTURE_v6.8.md)
> **Last Updated**: 2026-04-02
> **Description**: Strategy evaluation pipeline, trade schedule generation, and real-time tariff arbitrage optimization
> (**说明**: 策略评估管线、交易排程产生、即时电价套利优化)

---

## 1. Module Overview

M2 is the "brain" of the VPP platform. It contains four TypeScript source files that handle three distinct functions:

1. **Real-time arbitrage** (`run-optimization.ts`) -- evaluates SOC vs tariff period to produce charge/discharge/idle decisions and publishes `DRCommandIssued` events for M3 DR Dispatcher.
   (即时套利：评估电池SOC与电价时段，产生充放电决策并发布事件)

2. **Strategy evaluation pipeline** (`strategy-evaluator.ts`) -- a 6-step pipeline that gathers live evidence from upstream tables, evaluates conditions across three strategy families, quantifies confidence, assigns governance modes, arbitrates conflicts, and persists intents.
   (策略评估管线：六步骤管线，收集即时证据、评估条件、量化置信度、分配治理模式、仲裁冲突、持久化意图)

3. **Posture override resolution** (`posture-resolver.ts`) -- applies active governance overrides to strategy intents in-memory without writing back to DB.
   (姿态覆写解析：在内存中套用治理覆写至策略意图，不回写数据库)

4. **Trade schedule generation** (`schedule-generator.ts`) -- hourly cron that produces 24-hour forward trade schedules including deep-night force-charge, high PLD discharge, and peak shaving slots.
   (交易排程产生：每小时定时任务，产生24小时前瞻排程)

### Source Layout

```
src/optimization-engine/
├── handlers/
│   └── run-optimization.ts        # Lambda: SOC × tariff → charge/discharge/idle → EventBridge
└── services/
    ├── strategy-evaluator.ts      # 6-step strategy evaluation pipeline (v6.5 new)
    ├── posture-resolver.ts        # In-memory posture override applicator (v6.5 new)
    └── schedule-generator.ts      # Hourly cron: 24h forward schedule + peak shaving
```

---

## 2. run-optimization.ts (Lambda Handler)

**Trigger**: Lambda invocation (event-driven)
**Purpose**: Real-time tariff arbitrage decision engine
(即时电价套利决策引擎)

### 2.1 Interface

```typescript
export async function handler(event: OptimizationEvent): Promise<OptimizationResult>
```

- **Input `OptimizationEvent`**: `{ orgId, assetId, soc, currentTariffPeriod }` where `currentTariffPeriod` is `"peak" | "off-peak" | "intermediate"`
- **Output `OptimizationResult`**: `{ success, data: { assetId, orgId, targetMode, soc, tariffPeriod, dispatchId, eventPublished } }`

### 2.2 AppConfig Strategy Fetch

Strategy thresholds are fetched dynamically via AppConfig Lambda Extension Sidecar (`http://localhost:2772`):

| Env Var | Default | Purpose |
|---------|---------|---------|
| `APPCONFIG_BASE_URL` | `http://localhost:2772` | Lambda Extension endpoint (Lambda扩展端点) |
| `APPCONFIG_APP` | `solfacil-vpp-dev` | AppConfig application name (应用名称) |
| `APPCONFIG_ENV` | `dev` | AppConfig environment (环境) |
| `EVENT_BUS_NAME` | `""` | EventBridge bus name (事件总线名称) |

**`VppStrategyConfig` interface**:

```typescript
interface VppStrategyConfig {
  readonly minSoc: number;
  readonly maxSoc: number;
  readonly emergencySoc: number;
  readonly profitMargin: number;
}
```

**`DEFAULT_STRATEGY`** (fallback when AppConfig is unavailable -- AppConfig不可用时降级策略):

| Parameter | Value | Description |
|-----------|-------|-------------|
| `minSoc` | 20 | Minimum SOC before discharge is blocked (放电下限) |
| `maxSoc` | 90 | Maximum SOC before charge is blocked (充电上限) |
| `emergencySoc` | 10 | Emergency reserve floor (紧急储备下限) |
| `profitMargin` | 0.15 | Profit margin threshold (利润门槛) |

AppConfig fetch has a 500ms timeout (`AbortSignal.timeout(500)`); on any error it silently falls back to `DEFAULT_STRATEGY`.

### 2.3 Arbitrage Decision Logic (`resolveTargetMode`)

| Condition | Result |
|-----------|--------|
| `period === "peak" && soc > minSoc` | `"discharge"` (放电) |
| `period === "off-peak" && soc < maxSoc` | `"charge"` (充电) |
| Otherwise | `"idle"` (待机) |

### 2.4 EventBridge Publication

Decision result is published as `DRCommandIssued` event (Source: `solfacil.optimization-engine`) for M3 DR Dispatcher to consume.
(决策结果以 DRCommandIssued 事件发布至 EventBridge，供M3 DR Dispatcher消费)

**Detail fields**: `dispatchId`, `assetId`, `orgId`, `targetMode`, `soc`, `tariffPeriod`, `timestamp`, `traceId`

---

## 3. strategy-evaluator.ts (6-Step Pipeline)

**Invocation**: Called programmatically (not cron-driven directly)
**Purpose**: Multi-family strategy evaluation with confidence quantification, governance assignment, and conflict arbitration
(多族群策略评估，置信度量化、治理模式分配、冲突仲裁)

### 3.1 Public Interface

```typescript
export async function evaluateStrategies(orgId: string): Promise<StrategyIntent[]>
```

Accepts a single `orgId`, returns the organization's current active strategy intents.

### 3.2 Step 1: Gather Evidence (收集证据)

Reads live data from multiple tables using `getServicePool()` (BYPASS RLS):

| Query | Source Table | Purpose |
|-------|-------------|---------|
| Gateway list | `gateways` | `gateway_id`, `contracted_demand_kw` (only `status = 'online'`) |
| Assets + device state | `assets` LEFT JOIN `device_state` | Per-asset telemetry: `battery_soc`, `pv_power`, `battery_power`, `grid_power_kw`, `load_power`, `is_online`, `telemetry_age_minutes`, `capacidade_kw` |
| Tariff schedule | `tariff_schedules` | Current effective tariff: `peak_start`, `peak_end`, `peak_rate`, `offpeak_rate` |
| VPP strategies | `vpp_strategies` | Active strategies: `min_soc`, `max_soc`, `target_mode`, `is_active` |

Each gateway produces a `GatewayEvidence` structure containing its `AssetEvidence[]` array and `GatewayAggregate`:

```typescript
interface GatewayAggregate {
  total_soc_avg: number;      // Average SoC across assets (资产SoC平均值)
  total_grid_kw: number;      // Total grid import power (电网进口总功率)
  total_load_kw: number;      // Total load power (负载总功率)
  total_pv_kw: number;        // Total solar power (太阳能总功率)
  online_asset_ratio: number; // Online asset ratio 0-1 (在线资产比例)
  max_telemetry_age: number;  // Max telemetry staleness in minutes (最大遥测延迟)
}
```

### 3.3 Step 2: Evaluate Conditions (评估条件)

Three strategy families are evaluated (三个策略族群):

**Peak Shaving (需量管理)**

| Threshold | Value | Behavior |
|-----------|-------|----------|
| `PEAK_GRID_IMMEDIATE` | 0.9 (90%) | `grid_kw / contracted_demand_kw > 90%` -> `urgency = "immediate"` |
| `PEAK_GRID_SOON` | 0.8 (80%) | `> 80%` -> `urgency = "soon"` |
| `<= 80%` | -- | Not triggered (不触发) |
| `contracted_demand_kw = NULL` | -- | Gateway skipped (跳过该网关) |

**Tariff Arbitrage (电价套利)**

| Scenario | Condition | Trigger |
|----------|-----------|---------|
| Off-peak charge (离峰充电) | Off-peak period + `avg_soc < 70%` (`TARIFF_CHARGE_SOC`) | `urgency = "soon"` |
| Peak discharge (尖峰放电) | Peak approaching (within 1h) + `avg_soc > 60%` (`TARIFF_DISCHARGE_SOC`) | `urgency = "immediate"` |
| Peak discharge | Peak active + `avg_soc > 60%` | `urgency = "soon"` |

Tariff periods are read dynamically from `tariff_schedules` table (`peak_start`, `peak_end`), not hardcoded. If `tariff_schedules` has no records, the entire family is skipped.
(电价时段从 tariff_schedules 表动态读取，非硬编码。若无记录则跳过整个族群)

**Reserve Protection (储备保护)**

| Threshold | Value | Behavior |
|-----------|-------|----------|
| `RESERVE_EMERGENCY_SOC` | 15% | `avg_soc < 15%` -> `urgency = "immediate"` |
| `RESERVE_WARNING_SOC` | 30% | `avg_soc < 30%` -> `urgency = "soon"` |
| `>= 30%` | -- | Not triggered |

> **Note**: `curtailment_mitigation`, `resilience_preparation`, `external_dr` are not yet evaluated in v6.5; reserved for future implementation.
> (注意：curtailment_mitigation等三个族群在v6.5中尚未实作条件评估)

### 3.4 Step 3: Qualify (置信度量化)

Each triggered condition undergoes confidence adjustment:

| Condition | Confidence Effect |
|-----------|-------------------|
| Telemetry age > 15 min (`STALE_TELEMETRY_MINUTES`) | `confidence = min(confidence, 0.4)` |
| Online asset ratio < 50% (`LOW_ONLINE_RATIO`) | `confidence = min(confidence, 0.3)` |
| Baseline confidence (online >= 50%) | Peak Shaving: 0.85, Tariff Arbitrage: 0.8, Reserve Protection: 0.9 |
| Baseline confidence (online < 50%) | All: 0.4 |

### 3.5 Step 4: Governance Mode Assignment (治理模式分配)

**Family baseline governance map** (族群基线治理模式):

| Family | Baseline Governance |
|--------|---------------------|
| `reserve_protection` | `auto_governed` (自动执行) |
| `peak_shaving` | `approval_required` (需人工核准) |
| `tariff_arbitrage` | `approval_required` |
| `curtailment_mitigation` | `observe` (仅观察) |
| `resilience_preparation` | `observe` |
| `external_dr` | `observe` |

**Demotion rules** (降级规则 -- 增加监管):

- Telemetry age > 15 min -> `observe`
- Confidence < 0.5 -> `observe`
- Scope collision (different actionable families overlap on same gateway) -> `escalate`
- No suggested playbook -> `observe`

**Promotion rules** (升级规则 -- 自动执行方向):

- `reserve_protection` + `urgency = "immediate"` + `avg_soc < 15%` -> maintain `auto_governed`

### 3.6 Step 5: Arbitrate (仲裁)

Handles multi-intent conflicts within overlapping gateway scopes:

| Conflict Type | Resolution |
|---------------|------------|
| Same family, same scope | Both escalated to `escalate` (双方升级) |
| Different families, overlapping scope | Higher-priority family wins; lower is `deferred` |
| Same priority | Higher urgency wins; lower is `deferred` |

**Family priority** (1 = highest) (族群优先顺序):

1. `reserve_protection`
2. `peak_shaving`
3. `tariff_arbitrage`
4. `curtailment_mitigation`
5. `resilience_preparation`
6. `external_dr`

Protective strategies always dominate economic strategies.
(保护性策略优先于经济性策略)

### 3.7 Step 6: Persist (持久化)

1. Expire all stale intents: `expireStaleIntents(orgId)` -- updates `expires_at < NOW()` non-terminal intents to `status = 'expired'`
2. Upsert each intent via `upsertIntent()` -- writes to `strategy_intents` table (RLS-scoped via `queryWithOrg`)
3. **Intent TTL: 2 hours** (`expires_at = NOW() + 2h`)

### 3.8 All Thresholds Summary

```typescript
const STALE_TELEMETRY_MINUTES = 15;    // Telemetry freshness threshold (遥测新鲜度阈值)
const LOW_CONFIDENCE_THRESHOLD = 0.5;  // Governance demotion threshold (治理降级阈值)
const LOW_ONLINE_RATIO = 0.5;          // Online asset ratio threshold (在线比例阈值)
const PEAK_GRID_IMMEDIATE = 0.9;       // PS urgent: grid >= 90% (需量紧急)
const PEAK_GRID_SOON = 0.8;            // PS warning: grid >= 80% (需量预警)
const RESERVE_EMERGENCY_SOC = 15;      // Reserve emergency SoC% (储备紧急)
const RESERVE_WARNING_SOC = 30;        // Reserve warning SoC% (储备警告)
const TARIFF_CHARGE_SOC = 70;          // Off-peak charge SoC threshold (离峰充电阈值)
const TARIFF_DISCHARGE_SOC = 60;       // Peak discharge SoC threshold (尖峰放电阈值)
const PEAK_APPROACH_HOURS = 1;         // Hours before peak that triggers "immediate" (尖峰预警小时数)
```

---

## 4. posture-resolver.ts (In-Memory Override Applicator)

**Purpose**: Accepts strategy intents and active overrides, applies override rules in-memory. Does NOT write back to DB -- DB writes happen through explicit operator actions.
(接收策略意图与活动覆写，在内存中套用覆写规则。不回写DB)

### 4.1 Public Interface

```typescript
export async function resolvePosture(
  orgId: string,
  intents: StrategyIntent[],
): Promise<StrategyIntent[]>
```

### 4.2 Override Types and Effects (覆写类型与效果)

| Override Type (`override_type`) | Target | Effect |
|--------------------------------|--------|--------|
| `force_protective` | Non-protective intents (not `reserve_protection`) | `governance_mode -> "observe"`, append arbitration_note |
| `suppress_economic` | Economic intents (`peak_shaving`, `tariff_arbitrage`) | `status -> "suppressed"`, append arbitration_note |
| `force_approval_gate` | `auto_governed` intents only | `governance_mode -> "approval_required"`, append arbitration_note |
| `manual_escalation_note` | All intents | Append manual escalation note to `arbitration_note` only |
| `suppress_alerts` | All intents | **No effect** (alert suppression does not change posture or intent state) |

### 4.3 Scope Matching (范围匹配)

Override's `scope_gateway_ids` is compared against intent's `scope_gateway_ids`:
- Override scope is empty -> applies to all intents (空范围套用至所有意图)
- Override scope is non-empty -> applies only to intents with overlapping gateway IDs

### 4.4 Data Source

Active overrides are fetched from `posture_overrides` table via `getActiveOverrides(orgId)`:

```sql
SELECT * FROM posture_overrides
WHERE org_id = $1
  AND active = true
  AND expires_at > NOW()
ORDER BY created_at DESC
```

---

## 5. schedule-generator.ts (Hourly Cron)

**Trigger**: `cron.schedule("0 * * * *")` + immediate execution on system startup
**Purpose**: Generate 24-hour forward trade schedules for all active assets
(产生所有活动资产的24小时前瞻交易排程)

### 5.1 Schedule Generation Logic

1. **PLD price proxy**: Queries hourly average PLD from `pld_horario` (`AVG(pld_hora) GROUP BY hora`). Falls back to `DEFAULT_PLD = 150` if no data.
   (PLD价格代理：查询每小时平均PLD，无数据时降级使用150)

2. **Asset query**: All active assets with SoC guardrails and contracted demand:
   ```sql
   SELECT a.*, COALESCE(d.battery_soc, 50), COALESCE(vs.min_soc, 20),
          COALESCE(vs.max_soc, 95), g.contracted_demand_kw
   FROM assets a
   LEFT JOIN device_state d ... LEFT JOIN vpp_strategies vs ... LEFT JOIN gateways g ...
   WHERE a.is_active = true
   ```

3. **Schedule rules** (for each asset, each of 24 forward hours):
   - **Deep night force-charge** (深夜强制充电): `hora 0-4` -> `charge`
   - **High PLD discharge** (高电价放电): `pld >= 300` -> `discharge`
   - **Default**: `charge`
   - **SoC guardrails**: `charge` blocked if `battery_soc >= max_soc`; `discharge` blocked if `battery_soc <= min_soc` -> `idle`
   - `idle` slots are NOT inserted into `trade_schedules`

4. **POWER_UTILIZATION**: `capacidade_kw * 0.8` (80% of rated power) used for `expected_volume_kwh`
   (额定功率的80%用于预期容量)

5. **Stale schedule cleanup**: Before generating, deletes `status = 'scheduled'` rows for this asset within the next 24 hours.

### 5.2 Peak Shaving Slot Generation

For assets with `contracted_demand_kw IS NOT NULL`:

- Peak hours: `[18, 19, 20, 21]` BRT (hardcoded) -> converted to UTC via `hour + 3`
  (尖峰时段硬编码为BRT 18:00-22:00)
- Each peak hour gets one `discharge` schedule with `target_mode = 'peak_shaving'`
- `expected_volume_kwh = capacidade_kw * 0.8`
- `target_pld_price = 0` (PS does not involve PLD pricing)
- `ON CONFLICT DO NOTHING` prevents duplicate insertion

> **Note**: Current implementation does NOT perform demand-risk assessment (no 85% threshold check). Any asset with `contracted_demand_kw` unconditionally generates PS slots for all peak hours.
> (注意：当前实作不进行需量风险评估，有契约容量的资产无条件产生PS排程)

---

## 6. DB Tables (数据库表)

### 6.1 Tables Read (读取)

| Table | Read By | Purpose |
|-------|---------|---------|
| `assets` | schedule-generator, strategy-evaluator | Asset list, `capacidade_kw`, `allow_export`, `operation_mode` |
| `device_state` | schedule-generator, strategy-evaluator | Battery SoC, PV/Grid/Load power, online status, telemetry timestamp |
| `vpp_strategies` | schedule-generator, strategy-evaluator | SoC guardrails (`min_soc`, `max_soc`), `target_mode` |
| `gateways` | schedule-generator, strategy-evaluator | `contracted_demand_kw`, `gateway_id`, `status` |
| `pld_horario` | schedule-generator | Hourly PLD price history (每小时PLD电价历史) |
| `tariff_schedules` | strategy-evaluator | `peak_start`, `peak_end`, `peak_rate`, `offpeak_rate`, `effective_from`, `effective_to` |
| `posture_overrides` | posture-resolver | Active governance overrides (活动治理覆写) |

### 6.2 Tables Written (写入)

| Table | Written By | Purpose |
|-------|------------|---------|
| `trade_schedules` | schedule-generator | SC/TOU/PS schedule output (排程输出) |
| `strategy_intents` | strategy-evaluator | Strategy intent persistence (策略意图持久化) |

### 6.3 New Tables (v6.5)

| Table | Purpose |
|-------|---------|
| `strategy_intents` | Intent persistence: family, status, governance_mode, urgency, evidence_snapshot (JSON), scope_gateway_ids (JSON array), constraints (JSON), arbitration_note, expires_at |
| `posture_overrides` | Posture overrides: `override_type`, `scope_gateway_ids`, `active`, `starts_at`, `expires_at`, `cancelled_at` |
| `tariff_schedules` | Tariff period definition: `peak_start`, `peak_end`, `peak_rate`, `offpeak_rate`, `effective_from`, `effective_to` |

---

## 7. Integration Points (集成接口)

### 7.1 EventBridge Events Published

| Component | Event Type | Source | Detail Fields |
|-----------|-----------|--------|---------------|
| run-optimization | `DRCommandIssued` | `solfacil.optimization-engine` | `dispatchId`, `assetId`, `orgId`, `targetMode`, `soc`, `tariffPeriod`, `timestamp`, `traceId` |

> Strategy Evaluator and Posture Resolver do NOT publish EventBridge events. Intents are persisted to DB for BFF to read.
> (策略评估器和姿态解析器不发布EventBridge事件。意图通过DB持久化供BFF读取)

### 7.2 Connection Pool Assignment (连线池分配)

| Component | Pool | Reason |
|-----------|------|--------|
| schedule-generator | **Service Pool** | Cross-tenant cron task (跨租户定时任务) |
| run-optimization | **N/A (Lambda)** | Serverless; uses EventBridge + AppConfig only |
| strategy-evaluator | **Service Pool (BYPASS RLS)** + **queryWithOrg (RLS)** | Evidence gathering bypasses RLS; intent writes are RLS-scoped |
| posture-resolver | **queryWithOrg (RLS)** | Override reads are RLS-scoped |

### 7.3 Module Dependencies

| Direction | Module | Description |
|-----------|--------|-------------|
| **Publishes to** | M3 (DR Dispatcher) | `DRCommandIssued` event consumed by M3 |
| **Reads from** | M7 (Open API) | `pld_horario` data written by inbound CCEE webhook |
| **Reads from** | M1 (IoT Hub) | `device_state` telemetry written by MQTT pipeline |
| **Consumed by** | M5 (BFF) | BFF reads `strategy_intents` for P5 overview display |

---

## V2.4 Protocol Impact

**No code changes required.** M2 reads from `device_state` columns (`battery_soc`, `pv_power`, `battery_power`, `grid_power_kw`, `load_power`, `is_online`, `updated_at`) whose names and semantics are unchanged by the V2.4 upgrade. Values stored by M1 are now more accurately scaled (proper ×0.1 voltage, ×0.001 power factor), which transparently improves M2's decision quality without requiring any code modification.

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | Initial: 4 strategy algorithms |
| v5.5 | 2026-02-28 | Cost optimization, SoC constraints |
| v5.6 | 2026-02-28 | AppConfig strategy configuration |
| v5.7 | 2026-02-28 | Dynamic PLD pricing |
| v5.9 | 2026-03-02 | SoC-aware scheduling, schedule generator cron |
| v5.16 | 2026-03-07 | PS schedule generation: read gateways.contracted_demand_kw; insert peak_shaving slots for BRT 18:00-22:00 |
| v5.22 | 2026-03-13 | Documentation fix: add run-optimization.ts handler docs |
| v6.6 | 2026-03-31 | Code-aligned rewrite: strategy-evaluator.ts (6-step pipeline), posture-resolver.ts (5 override types), new DB tables (strategy_intents, posture_overrides, tariff_schedules). Schedule generator and real-time arbitrage handler unchanged. |
| **v6.8** | **2026-04-02** | **Version bump for V2.4 protocol upgrade. No M2 code changes — upstream M1 values now more accurately scaled, transparently improving decision quality.** |
