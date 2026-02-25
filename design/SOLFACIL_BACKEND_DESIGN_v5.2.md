# SOLFACIL VPP Backend Architecture — v5.2
## Runtime Schema Evolution & Global Data Dictionary

**Document Version:** 5.2.0  
**Status:** Draft — Pending Architect Review  
**Authors:** Xu Heng Engineering Team  
**Date:** 2026-02-25  
**Supersedes:** SOLFACIL_BACKEND_DESIGN_v5.1.md

---

## Table of Contents

1. [Executive Summary — Architecture Elevation Goals](#1-executive-summary)
2. [M1 IoT Hub — Flexible Schema Reconstruction](#2-m1-iot-hub-flexible-schema)
3. [M8 Admin Engine — Data Dictionary Service](#3-m8-admin-engine-data-dictionary)
4. [Control Plane UI — M1 Parser Editor Redesign](#4-control-plane-ui-parser-editor)
5. [The Magic Workflow — Cross-Module Live Federation](#5-cross-module-magic-workflow)

---

## 1. Executive Summary

### 1.1 The Fundamental Impedance Mismatch

Every deployed energy gateway speaks in the language of **physics**: raw register values, device-specific identifiers, vendor-proprietary field names. A GoodWe inverter reports `bat_soc`; a Sofar speaks `batt_soc_value`; a Deye gateway pushes `SOC_now`. These are three different strings describing the same concept to three different cloud endpoints.

Today, every time a new hardware partner is onboarded — or an existing firmware version introduces a new telemetry field — a backend engineer must open a pull request, write a new parser, deploy a Lambda, and wait for CI/CD. This is the **Physical-to-Business Translation Tax**, and it is paid in developer-hours every single time.

v5.2 eliminates this tax permanently.

### 1.2 The Two Perspectives

| Dimension | Gateway (Physical View) | Cloud (Business View) |
|-----------|------------------------|----------------------|
| Data unit | Raw registers, vendor fields | Normalized business metrics |
| Schema | Firmware-defined, volatile | Product-defined, stable |
| Change trigger | Hardware manufacturer | Business requirement |
| Change frequency | Per firmware release | Per product iteration |
| Example field | `bat_soc`, `batt_soc_value`, `SOC_now` | `status.battery_soc` |

The cloud must never be aware of vendor-specific field names. The gateway must never be aware of business logic. **M1 is the translation boundary.** In v5.1, that boundary was hardcoded. In v5.2, it is dynamically configurable at runtime.

### 1.3 The Business Triology Data Model

v5.2 introduces a canonical three-domain classification for all telemetry data flowing through the platform. Every data point that enters the system must be classified into exactly one of the following domains:

```
┌─────────────────────────────────────────────────────────────────┐
│                    BUSINESS TRIOLOGY MODEL                      │
├──────────────────┬──────────────────┬───────────────────────────┤
│   METERING       │   STATUS         │   CONFIG                  │
├──────────────────┼──────────────────┼───────────────────────────┤
│ Time-series data │ Discrete state   │ Operational parameters    │
│ for billing and  │ snapshots for    │ pushed down to the        │
│ optimization     │ monitoring and   │ gateway for real-time     │
│ algorithms       │ alerting         │ control                   │
├──────────────────┼──────────────────┼───────────────────────────┤
│ grid_power_w     │ battery_soc      │ charge_stop_soc           │
│ pv_yield_kwh     │ inverter_state   │ discharge_power_w         │
│ load_current_a   │ chiller_temp     │ work_mode                 │
│ battery_energy   │ alarm_flags      │ tou_schedule              │
└──────────────────┴──────────────────┴───────────────────────────┘
```

**Why three domains?**

- **Metering** feeds M2 (optimization algorithms), M4 (billing engine), and customer-facing analytics. It is always time-indexed and aggregated.
- **Status** feeds M3 (DR dispatcher health checks), alerting pipelines, and the fleet monitoring dashboard. It represents the current truth about a device.
- **Config** flows in the opposite direction — from the cloud down to the gateway. It is the control surface of the VPP.

### 1.4 The Commercial Value Proposition

> **Adding a new hardware field no longer requires modifying backend code.**

When a Solfacil technician commissions a new site with a liquid-cooled BESS that reports `chiller_temperature_degC`, the workflow is:

**v5.1 (today):** File GitHub issue → engineer writes parser → PR review → Lambda deploy → staging test → production deploy. Minimum lead time: **2–5 business days**.

**v5.2 (target):** Technician opens M8 Admin UI → drags MQTT field to `status.chiller_temp` → clicks Deploy. AppConfig propagates. Lead time: **under 60 seconds**.

This is not an incremental improvement. This is the elimination of an entire class of operational friction.

---

## 2. M1 IoT Hub — Flexible Schema Reconstruction

### 2.1 The Problem with v5.1 Schema

In v5.1, the `StandardTelemetry` type was a flat, hardcoded interface:

```typescript
// v5.1 — DEPRECATED
interface StandardTelemetry_v51 {
  deviceId: string;
  timestamp: string;
  traceId: string;
  pvPowerW: number;           // ← hardcoded field name
  battSoc: number;            // ← hardcoded field name
  gridPowerW: number;         // ← hardcoded field name
  loadPowerW: number;         // ← hardcoded field name
  // ... 40+ more hardcoded fields
}
```

Every new hardware integration required expanding this interface and modifying every downstream module that consumed it. This creates a rigid, brittle dependency chain across M2, M3, M4, and M5.

### 2.2 The v5.2 Flexible Container

v5.2 replaces the flat struct with a **three-domain flexible container**:

```typescript
// src/types/StandardTelemetry.ts — v5.2

/**
 * Canonical telemetry envelope for all device data flowing through M1.
 * The metering, status, and config fields are dynamically keyed
 * according to the active Data Dictionary definition in AppConfig.
 *
 * No hardcoded business field names exist in this interface.
 * All field semantics are defined exclusively in the Global Data Dictionary.
 */
export interface StandardTelemetry {
  // --- Routing Metadata (immutable, always present) ---
  deviceId: string;          // Normalized gateway clientId
  tenantId: string;          // Multi-tenant isolation key
  timestamp: string;         // ISO-8601 UTC
  traceId: string;           // Global VPP trace ID (vpp-{uuid})
  schemaVersion: string;     // Data Dictionary version that produced this record

  // --- Business Triology: the three flexible domains ---
  
  /**
   * Time-series measurements. Values are always numeric.
   * Keys are defined by the active metering schema in AppConfig.
   * Examples: { "grid_power_w": 1240.5, "pv_yield_kwh": 8.3 }
   */
  metering: Record<string, number>;

  /**
   * Discrete state snapshots. Values are string | number | boolean.
   * Keys are defined by the active status schema in AppConfig.
   * Examples: { "battery_soc": 72.4, "inverter_state": "running" }
   */
  status: Record<string, string | number | boolean>;

  /**
   * Operational configuration last acknowledged by the gateway.
   * Keys are defined by the active config schema in AppConfig.
   * This domain is bi-directional: cloud writes, gateway echoes.
   * Examples: { "charge_stop_soc": 95, "work_mode": "tou" }
   */
  config: Record<string, string | number | boolean>;
}
```

### 2.3 The Mapping Rule: AppConfig as the Brain

M1 no longer contains any field mapping logic in code. All translation logic is externalized to AWS AppConfig as a **Parser Rule document**:

```json
// AppConfig Profile: vpp-m1-parser-rules
// Managed exclusively by M8. M1 reads this at startup and on invalidation.
{
  "schemaVersion": "2026-02-25T10:00:00Z",
  "deviceProfiles": {
    "goodwe_arm745": {
      "metering": [
        { "target": "grid_power_w",    "source": "pvList[0].grid_power",   "type": "float", "unit": "W"   },
        { "target": "pv_yield_kwh",    "source": "pvList[0].daily_yield",  "type": "float", "unit": "kWh" },
        { "target": "load_power_w",    "source": "loadList[0].load_power", "type": "float", "unit": "W"   }
      ],
      "status": [
        { "target": "battery_soc",     "source": "batList[0].bat_soc",     "type": "float"  },
        { "target": "inverter_state",  "source": "pvList[0].work_mode",    "type": "string" }
      ],
      "config": [
        { "target": "charge_stop_soc", "source": "icebat.chargingStopSoc", "type": "integer" },
        { "target": "work_mode",       "source": "icebat.workMode",         "type": "string"  }
      ]
    },
    "sofar_hyd": {
      "metering": [
        { "target": "grid_power_w",    "source": "grid.activePower",       "type": "float", "unit": "W"  },
        { "target": "pv_yield_kwh",    "source": "pv.dailyGeneration",     "type": "float", "unit": "kWh"}
      ],
      "status": [
        { "target": "battery_soc",     "source": "batt_soc_value",         "type": "float" }
      ],
      "config": []
    }
  }
}
```

### 2.4 M1 as Pure Translation Executor

With the mapping rules externalized, M1's core logic shrinks to a deterministic, stateless executor:

```typescript
// src/m1/translator.ts — v5.2

import { AppConfigCache } from '../shared/appconfig-cache';
import { StandardTelemetry } from '../types/StandardTelemetry';
import { resolveJsonPath } from '../utils/jsonpath';

/**
 * M1 Translation Executor.
 * 
 * This function contains ZERO field-specific knowledge.
 * It blindly applies whatever mapping rules AppConfig provides.
 * Adding a new field = updating AppConfig. No code change required.
 */
export function translateGatewayPayload(
  rawPayload: Record<string, unknown>,
  deviceProfile: string,
  tenantId: string,
  traceId: string
): StandardTelemetry {
  
  const rules = AppConfigCache.getParserRules();
  const profile = rules.deviceProfiles[deviceProfile];

  if (!profile) {
    throw new UnknownDeviceProfileError(deviceProfile);
  }

  const metering: Record<string, number> = {};
  const status: Record<string, string | number | boolean> = {};
  const config: Record<string, string | number | boolean> = {};

  // Apply metering rules
  for (const rule of profile.metering) {
    const raw = resolveJsonPath(rawPayload, rule.source);
    if (raw !== undefined) {
      metering[rule.target] = coerce(raw, rule.type) as number;
    }
  }

  // Apply status rules
  for (const rule of profile.status) {
    const raw = resolveJsonPath(rawPayload, rule.source);
    if (raw !== undefined) {
      status[rule.target] = coerce(raw, rule.type) as string | number | boolean;
    }
  }

  // Apply config echo rules
  for (const rule of profile.config) {
    const raw = resolveJsonPath(rawPayload, rule.source);
    if (raw !== undefined) {
      config[rule.target] = coerce(raw, rule.type) as string | number | boolean;
    }
  }

  return {
    deviceId:      extractClientId(rawPayload),
    tenantId,
    timestamp:     new Date().toISOString(),
    traceId,
    schemaVersion: rules.schemaVersion,
    metering,
    status,
    config,
  };
}
```

**Key architectural invariant:** The `translateGatewayPayload` function will never be modified to add a new field. It is a permanent, stable executor. All evolution happens in AppConfig data.

### 2.5 Graceful Fallback

Consistent with v5.1's three-tier degradation strategy, M1 v5.2 maintains fallback behavior when AppConfig is unavailable:

```
Tier 1: Live AppConfig read via Lambda Extension sidecar (< 1ms)
Tier 2: In-memory cached rules from last successful fetch
Tier 3: Bundled baseline schema (covers standard GoodWe + Sofar fields)
         → Records emitted with schemaVersion: "fallback-baseline"
         → Alert published to SNS for operator notification
```

---

## 3. M8 Admin Engine — Data Dictionary Service

### 3.1 Beyond Parser Rule Management

In v5.1, M8's responsibility was to manage **parser rules** — the mapping instructions consumed by M1. In v5.2, M8 assumes a second, equally important responsibility: managing the **Global Data Dictionary Schema**.

The distinction is critical:

| Artifact | Consumer | Purpose |
|----------|----------|---------|
| Parser Rule | M1 (execution) | How to extract a value from raw MQTT JSON |
| Dictionary Schema | M2, M3, M4, M5, UI | What fields exist, their types, and their semantics |

When an operator adds a new field mapping in M8, **both artifacts must be atomically updated**. This is M8's Data Dictionary Service contract.

### 3.2 The Global Data Dictionary Schema

```typescript
// src/m8/types/DataDictionarySchema.ts

/**
 * A single field definition in the Global Data Dictionary.
 * This is the canonical description of a business-level data point.
 */
export interface FieldDefinition {
  /** Dot-notation key, e.g. "status.chiller_temp" */
  fieldKey:    string;
  /** Human-readable label for UI display */
  label:       string;
  /** Domain classification */
  domain:      'metering' | 'status' | 'config';
  /** Runtime value type */
  valueType:   'float' | 'integer' | 'string' | 'boolean';
  /** SI unit, if applicable */
  unit?:       string;
  /** Description for operator reference */
  description: string;
  /** ISO-8601 timestamp of last modification */
  updatedAt:   string;
  /** M8 operator who defined this field */
  updatedBy:   string;
}

/**
 * The complete Global Data Dictionary for a tenant.
 * Stored in AppConfig profile: vpp-m8-data-dictionary
 */
export interface GlobalDataDictionary {
  schemaVersion: string;
  tenantId:      string;
  fields:        FieldDefinition[];
}
```

### 3.3 The Atomic Dual-Write Operation

When an operator deploys a new field mapping via M8, the following atomic operation executes:

```typescript
// src/m8/services/DataDictionaryService.ts

export class DataDictionaryService {

  /**
   * Deploy a new field mapping.
   * 
   * This is an ATOMIC operation: both AppConfig profiles are updated
   * in a single logical transaction. If either write fails, the entire
   * operation is rolled back to prevent schema divergence.
   */
  async deployFieldMapping(
    tenantId: string,
    deviceProfile: string,
    newMapping: FieldMappingRequest,
    operator: string
  ): Promise<DeployResult> {

    const traceId = generateTraceId();
    const newSchemaVersion = new Date().toISOString();

    // 1. Fetch current state from AppConfig
    const [currentRules, currentDictionary] = await Promise.all([
      this.appConfig.getParserRules(tenantId, deviceProfile),
      this.appConfig.getDataDictionary(tenantId),
    ]);

    // 2. Build updated parser rule (consumed by M1)
    const updatedRules = appendMappingRule(currentRules, deviceProfile, newMapping);

    // 3. Build updated dictionary schema (consumed by M2/M3/M4/M5/UI)
    const newFieldDef: FieldDefinition = {
      fieldKey:    `${newMapping.domain}.${newMapping.targetKey}`,
      label:       newMapping.label,
      domain:      newMapping.domain,
      valueType:   newMapping.valueType,
      unit:        newMapping.unit,
      description: newMapping.description,
      updatedAt:   newSchemaVersion,
      updatedBy:   operator,
    };
    const updatedDictionary = appendFieldDefinition(currentDictionary, newFieldDef);

    // 4. Atomic dual-write to AppConfig
    // Both profiles share the same schemaVersion for consistency verification
    await Promise.all([
      this.appConfig.putParserRules(tenantId, deviceProfile, {
        ...updatedRules,
        schemaVersion: newSchemaVersion,
      }),
      this.appConfig.putDataDictionary(tenantId, {
        ...updatedDictionary,
        schemaVersion: newSchemaVersion,
      }),
    ]);

    // 5. Publish schema-change event for downstream module cache invalidation
    await this.eventBridge.publish({
      source:       'vpp.m8',
      detailType:   'SchemaEvolved',
      detail: {
        traceId,
        tenantId,
        deviceProfile,
        newField:      newFieldDef.fieldKey,
        schemaVersion: newSchemaVersion,
      },
    });

    return { success: true, traceId, schemaVersion: newSchemaVersion };
  }
}
```

### 3.4 Downstream Cache Invalidation via EventBridge

Upon receiving the `SchemaEvolved` event, each downstream module (M1, M2, M4) invalidates its local AppConfig cache. The Lambda Extension sidecar re-fetches both the parser rules and the data dictionary on the next invocation. The entire propagation completes within **one Lambda execution cycle** — typically under 500ms.

```
M8 deploys field
      │
      ▼
AppConfig updated (Parser Rules + Data Dictionary)
      │
      ▼
EventBridge: SchemaEvolved published
      │
      ├──► M1 cache invalidation → next MQTT message uses new rules
      ├──► M2 cache invalidation → new field available in optimization config
      ├──► M4 cache invalidation → new field available in billing rule builder
      └──► M5 BFF cache invalidation → API response includes new field
```

---

## 4. Control Plane UI — M1 Parser Editor Redesign

### 4.1 Design Philosophy

The M1 Parser Editor in v5.2 is designed around a single principle: **a field should be mappable by a field service engineer, not a software engineer**. The interface must make the mapping operation feel like connecting two wires on a terminal block — spatial, visual, and immediate.

### 4.2 Three-Panel Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  M1 Parser Editor — GoodWe ARM745                           [Deploy ▶]      │
├──────────────────────────┬──────────────────────────────────────────────────┤
│  MQTT PAYLOAD TREE       │  DATA DICTIONARY                                 │
│  (Live from gateway)     │                                                  │
│                          │  ┌─────────────┬──────────────┬────────────────┐ │
│  ▼ root                  │  │  METERING   │  STATUS      │  CONFIG        │ │
│    ▼ pvList[0]           │  ├─────────────┼──────────────┼────────────────┤ │
│      grid_power: 1240.5 ──┼──────────────►grid_power_w  │                │ │
│      daily_yield: 8.3   ──┼──────────────►pv_yield_kwh  │                │ │
│      work_mode: "run"    │  │             │  inverter──◄─┼──── work_mode  │ │
│    ▼ batList[0]          │  │             │  _state      │                │ │
│      bat_soc: 72.4      ──┼─────────────►│  battery_soc │                │ │
│      bat_workStatus:     │  │             │              │                │ │
│        "charging"       ──┼─────────────►│  charge_──   │                │ │
│    ▼ icebat              │  │             │  state       │                │ │
│      chargingStopSoc: 95 │  │             │              │  charge_stop──◄┼─┤
│      workMode: "tou"     │  │             │              │  _soc          │ │
│    ▼ liquidCooling       │  │             │              │                │ │
│      temperature: 38.2   │  │             │  [+ Add]     │  [+ Add]       │ │
│                          │  └─────────────┴──────────────┴────────────────┘ │
└──────────────────────────┴──────────────────────────────────────────────────┘
```

### 4.3 Interaction Flow: Adding a New Field

The complete operator workflow for adding `status.chiller_temp` from a liquid-cooled BESS:

**Step 1 — Select source node**  
The operator clicks `liquidCooling.temperature: 38.2` in the MQTT payload tree. The node highlights in blue, indicating it is ready to be bound.

**Step 2 — Open target panel**  
The operator clicks `[+ Add]` under the **STATUS** panel. A field definition dialog appears:

```
┌────────────────────────────────────────────┐
│  Define New Status Field                   │
├────────────────────────────────────────────┤
│  Field Key:    chiller_temp                │
│  Label:        Chiller Temperature         │
│  Value Type:   ● float  ○ integer  ○ str  │
│  Unit:         °C                          │
│  Description:  Liquid cooling loop temp    │
│                                            │
│  Source binding:                           │
│  liquidCooling.temperature  ✓ (selected)   │
│                                            │
│  [Cancel]              [Bind & Add →]      │
└────────────────────────────────────────────┘
```

**Step 3 — Review and deploy**  
The new mapping appears in the STATUS panel with a `[pending deploy]` badge. The operator reviews all pending changes and clicks **Deploy ▶**.

**Step 4 — Confirmation**  
The UI displays a deployment progress indicator:
```
Deploying schema v2026-02-25T14:23:11Z...
  ✓ Parser Rules updated (M1)
  ✓ Data Dictionary updated (Global)
  ✓ SchemaEvolved event published
  ✓ Downstream cache invalidation acknowledged

Field status.chiller_temp is now live across all modules.
```

### 4.4 Live Preview Panel

Adjacent to the tree view, a **Live Preview** section renders the `StandardTelemetry` JSON that M1 would produce for the current gateway payload, given the active mapping rules. This allows the operator to verify the translation before deploying:

```json
// Live Preview — StandardTelemetry output
{
  "deviceId": "QING-445c3c6416d2",
  "tenantId": "solfacil-pilot-01",
  "timestamp": "2026-02-25T14:23:09.412Z",
  "traceId": "vpp-a4f8c2d1-...",
  "schemaVersion": "2026-02-25T14:23:11Z",
  "metering": {
    "grid_power_w": 1240.5,
    "pv_yield_kwh": 8.3
  },
  "status": {
    "battery_soc": 72.4,
    "inverter_state": "running",
    "chiller_temp": 38.2       // ← new field, pending deploy
  },
  "config": {
    "charge_stop_soc": 95,
    "work_mode": "tou"
  }
}
```

Fields pending deployment are rendered with a distinct color to communicate their uncommitted state clearly.

---

## 5. The Magic Workflow — Cross-Module Live Federation

### 5.1 The Scenario

A Solfacil field engineer commissions a new pilot site in São Paulo. The site is equipped with a liquid-cooled commercial BESS that reports a `chiller_temperature_degC` field that has never been seen in the platform before. The engineer needs this temperature data to be:

1. Visible in the fleet monitoring dashboard
2. Available as a condition in M2's optimization strategy builder (e.g., "pause discharge if chiller_temp > 45°C")
3. Triggerable as a DR event pre-condition in M3

**Total time required in v5.2: under 90 seconds.**

### 5.2 The Workflow, Step by Step

**T+0s — Engineer opens M8 Admin UI, navigates to M1 Parser Editor**

The UI loads a live MQTT payload snapshot from the newly commissioned gateway. The engineer can immediately see `liquidCooling.temperature: 38.2` in the tree.

**T+15s — Engineer binds the field**

Three clicks: select source node → click `[+ Add]` in STATUS panel → fill in `chiller_temp`, type `float`, unit `°C` → `[Bind & Add]`.

**T+30s — Engineer clicks Deploy**

M8 executes the atomic dual-write:
- AppConfig `vpp-m1-parser-rules` → new mapping rule appended
- AppConfig `vpp-m8-data-dictionary` → `status.chiller_temp` FieldDefinition added
- EventBridge `SchemaEvolved` event published with `newField: "status.chiller_temp"`

**T+31s — M1 receives invalidation signal**

The Lambda Extension sidecar detects the AppConfig version change on the next polling interval (≤ 1s). On the next MQTT message from the gateway, M1 reads the updated rules and begins populating `status.chiller_temp` in every outbound `StandardTelemetry` record.

**T+32s — M2 Optimization Engine becomes aware**

M2's strategy configuration UI fetches the latest Global Data Dictionary from AppConfig. The **Field Selector** dropdown in the strategy rule builder — which previously listed only pre-defined fields — now displays:

```
Available Status Fields:
  ● battery_soc (float, %)
  ● inverter_state (string)
  ● chiller_temp (float, °C)   ← appeared without any code deployment
```

The optimization engineer can immediately create a rule: `IF status.chiller_temp > 45 THEN pause_discharge`.

**T+35s — M4 Billing Engine becomes aware**

M4's dynamic billing rule editor similarly queries the Data Dictionary. The `chiller_temp` field is now available as a conditional modifier for demand-response premium pricing rules — all without any engineering intervention.

**T+40s — M3 DR Dispatcher reflects the new field**

M3's pre-condition evaluator reads the live `StandardTelemetry` stream. Since M1 is now emitting `status.chiller_temp`, M3 can use it as a health-gate for dispatch decisions: "Do not dispatch this site if chiller_temp exceeds thermal threshold."

**T+90s — Engineer verifies in fleet dashboard**

The fleet monitoring dashboard, powered by M5 BFF, queries recent telemetry and renders a new data card: **Chiller Temperature** with the live value. No front-end code was changed. The dashboard renders dynamically from the Data Dictionary schema.

### 5.3 The Impact Summary

```
One operator action at T+0s
      │
      ▼
AppConfig (two profiles atomically updated)
      │
      ├──► M1: begins translating the new field from raw MQTT  (T+31s)
      ├──► M2: chiller_temp appears in strategy rule builder   (T+32s)
      ├──► M3: chiller_temp available as DR health-gate        (T+33s)
      ├──► M4: chiller_temp available in billing rule editor   (T+35s)
      ├──► M5: BFF API response includes chiller_temp          (T+36s)
      └──► UI: fleet dashboard renders new data card           (T+90s)

Lines of code changed: 0
Pull requests opened: 0
Deployments triggered: 0
```

### 5.4 Why This Answers Solfacil's Questions

Returning to the three questions that drive this platform:

**"Will your system help us make money?"**  
Yes — because new hardware can be onboarded in under 90 seconds instead of 5 business days. Every day of reduced onboarding time is a day sooner that optimization and VPP dispatch are active at that site, generating measurable savings and revenue.

**"Can we trust this system?"**  
Yes — because schema evolution is controlled, audited, and atomic. There is no "someone deployed a Lambda and broke three modules" scenario. Every schema change is tracked in AppConfig with a version timestamp and operator attribution. Rollback is a single AppConfig version revert.

**"Can we tell this story to investors?"**  
Yes — and the story is compelling: *"We operate a fleet of energy assets where adding a new data dimension to the entire platform takes 90 seconds and zero engineering effort. Our competitors need a sprint cycle."*

---

## Appendix A: Migration Path from v5.1

The v5.2 architecture is **fully backward-compatible** with v5.1 deployed infrastructure. Migration proceeds in three phases:

| Phase | Action | Risk | Duration |
|-------|--------|------|----------|
| 1 | Deploy M8 Data Dictionary API endpoints (additive only) | Zero — new endpoints, no modification | 1 sprint |
| 2 | Deploy updated M1 with flexible schema executor alongside v5.1 parser | Zero — feature-flagged via AppConfig | 1 sprint |
| 3 | Migrate existing hardcoded M1 fields into AppConfig parser rules | Low — validated field-by-field | 2 sprints |

At the end of Phase 3, the hardcoded `StandardTelemetry_v51` interface is deprecated and the codebase no longer contains any field-specific mapping logic.

---

## Appendix B: AppConfig Profile Summary (v5.2)

| Profile Name | Owner | Consumer | Description |
|--------------|-------|----------|-------------|
| `vpp-m1-parser-rules` | M8 (write) | M1 (read) | Per-device-profile field mapping rules |
| `vpp-m8-data-dictionary` | M8 (write) | All modules (read) | Global field definitions and metadata |
| `vpp-m2-strategy` | M8 (write) | M2 (read) | Optimization algorithm parameters |
| `vpp-m3-dr-config` | M8 (write) | M3 (read) | DR dispatch thresholds and SLA |
| `vpp-m4-billing` | M8 (write) | M4 (read) | Tariff tables and billing rules |
| `vpp-m5-bff` | M8 (write) | M5 (read) | API feature flags and rate limits |
| `vpp-m6-identity` | M8 (write) | M6 (read) | RBAC policy and tenant config |
| `vpp-m7-openapi` | M8 (write) | M7 (read) | Partner API access control |

---

*End of SOLFACIL_BACKEND_DESIGN_v5.2.md*  
*For questions, contact the Xu Heng Engineering Team.*
