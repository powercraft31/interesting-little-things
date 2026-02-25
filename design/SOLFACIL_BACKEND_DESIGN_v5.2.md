# SOLFACIL VPP — Backend Architecture Design: Runtime Schema Evolution & Global Data Dictionary

> **Version:** 5.2.0 | **Date:** 2026-02-25
> **Author:** Cloud Architecture Team
> **Status:** Draft
> **Supersedes:** `SOLFACIL_BACKEND_DESIGN_v5.1.md`

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
   - 1.1 [Physical View vs Business View](#11-physical-view-vs-business-view)
   - 1.2 [Business Trilogy Data Model](#12-business-trilogy-data-model)
   - 1.3 [Commercial Value](#13-commercial-value)
2. [M1 IoT Hub — Flexible Schema](#2-m1-iot-hub--flexible-schema)
   - 2.1 [v5.1 Problem](#21-v51-problem)
   - 2.2 [New StandardTelemetry Interface](#22-new-standardtelemetry-interface)
   - 2.3 [AppConfig Parser Rule Format](#23-appconfig-parser-rule-format)
   - 2.4 [M1 Translation Executor](#24-m1-translation-executor)
   - 2.5 [Three-Tier Fallback](#25-three-tier-fallback)
3. [M8 Admin Engine — Data Dictionary Service](#3-m8-admin-engine--data-dictionary-service)
   - 3.1 [Dual Responsibility](#31-dual-responsibility)
   - 3.2 [TypeScript Types](#32-typescript-types)
   - 3.3 [Atomic Dual-Write](#33-atomic-dual-write)
   - 3.4 [EventBridge Cascade](#34-eventbridge-cascade)
4. [Control Plane UI — M1 Parser Editor Redesign](#4-control-plane-ui--m1-parser-editor-redesign)
   - 4.1 [Design Principle](#41-design-principle)
   - 4.2 [Three-Panel Layout](#42-three-panel-layout)
   - 4.3 [Operator Workflow: Adding status.chiller_temp](#43-operator-workflow-adding-statuschiller_temp)
   - 4.4 [Live Preview](#44-live-preview)
5. [The Magic Workflow — Cross-Module Live Federation](#5-the-magic-workflow--cross-module-live-federation)
   - 5.1 [Scenario](#51-scenario)
   - 5.2 [Timeline (T+0s to T+90s)](#52-timeline-t0s-to-t90s)
   - 5.3 [Impact Summary](#53-impact-summary)
   - 5.4 [Back to the Three Questions](#54-back-to-the-three-questions)
- [Appendix A: Migration Path from v5.1](#appendix-a-migration-path-from-v51)
- [Appendix B: Updated AppConfig Profile Table](#appendix-b-updated-appconfig-profile-table)

---

## 1. Executive Summary

v5.2 is an additive upgrade to v5.1. The core infrastructure — AWS Lambda, EventBridge, AppConfig + Lambda Extension Sidecar, DynamoDB, and modules M2 through M7 — is unchanged. This document describes targeted enhancements to M1 (IoT Hub) and M8 (Admin Engine) only.

---

### 1.1 Physical View vs Business View

Every gateway connected to the SOLFACIL VPP platform speaks vendor-specific MQTT. The same logical concept — battery state of charge — appears under different raw field names depending on the device manufacturer:

| Vendor | Raw MQTT Field | Meaning |
|--------|---------------|---------|
| GoodWe ARM745 | `batList[0].bat_soc` | Battery state of charge |
| Sofar HYD | `batt_soc_value` | Battery state of charge |
| Qingdao Ice-Bear | `SOC_now` | Battery state of charge |

Three vendors. Three field names. One business concept: `status.battery_soc`.

The cloud must speak normalized business language. Every downstream module — M2 (optimization), M3 (dispatch), M4 (billing), M5 (dashboard) — consumes a single canonical vocabulary. The translation from physical device fields to business vocabulary is the responsibility of M1.

**v5.1 Problem:** This translation is hardcoded in M1 Lambda code. The `StandardTelemetry` interface defines rigid fields (`power_kw`, `voltage_v`, `current_a`, `soc_pct`). Every new device model or firmware-reported field requires modifying the TypeScript interface, updating the adapter registry, writing a new adapter class, and deploying through the full CI/CD pipeline.

**v5.2 Solution:** Translation rules are data stored in AWS AppConfig, editable at runtime through the M8 Admin UI with zero code changes. The `StandardTelemetry` interface becomes schema-driven: its business fields are dynamically keyed per the active Data Dictionary, not hardcoded in source code.

---

### 1.2 Business Trilogy Data Model

Every telemetry data point arriving from a gateway is classified into exactly one of three canonical domains:

| Domain | Purpose | Consumer | Example Keys |
|--------|---------|----------|-------------|
| **metering** | Time-series numeric values for billing and optimization | M2, M4 | `grid_power_w`, `pv_yield_kwh`, `load_power_w` |
| **status** | Discrete device state for monitoring and alerting | M3, dashboard | `battery_soc`, `inverter_state`, `chiller_temp` |
| **config** | Bi-directional operational parameters (cloud to gateway) | Gateway control | `charge_stop_soc`, `work_mode`, `discharge_power_w` |

This trilogy is the organizing principle for all telemetry data in v5.2. A field belongs to exactly one domain. The domain classification determines storage strategy (Timestream measure group for metering, DynamoDB attribute for status, Device Shadow for config), downstream routing, and UI presentation.

---

### 1.3 Commercial Value

| Dimension | v5.1 | v5.2 |
|-----------|------|------|
| Adding a new hardware field | Edit TypeScript, PR review, CI/CD deploy | Edit AppConfig in M8 Admin UI |
| Time to live | 2-5 business days | Under 60 seconds |
| Engineering required | Yes — backend developer | No — field service engineer |
| Change mechanism | Code deployment | AppConfig data update |
| Risk of regression | Nonzero — code change touches shared interfaces | Zero — data-only change, executor is immutable |
| Vendor onboarding velocity | One adapter class per vendor | One JSON profile per vendor |

---

## 2. M1 IoT Hub — Flexible Schema

### 2.1 v5.1 Problem

The v5.1 `StandardTelemetry` interface hardcodes every business field:

```typescript
// v5.1 — DEPRECATED approach
interface StandardTelemetry_v51 {
  readonly orgId: string;
  readonly deviceId: string;
  readonly timestamp: string;
  readonly source: 'mqtt' | 'webhook';
  readonly metrics: {
    readonly power_kw: number;     // hardcoded
    readonly voltage_v: number;    // hardcoded
    readonly current_a: number;    // hardcoded
    readonly soc_pct?: number;     // hardcoded
  };
  readonly rawPayload?: Record<string, unknown>;
  // Adding a new field here requires:
  //   1. Modify this interface
  //   2. Update every adapter (HuaweiAdapter, SungrowAdapter, ...)
  //   3. Update every downstream consumer (M2, M3, M4, M5)
  //   4. Write tests, open PR, wait for CI/CD
  //   5. Deploy to production
}
```

Every new hardware field — a chiller temperature sensor, a PV string voltage, a battery cycle count — requires modifying this interface and propagating the change to all downstream consumers.

---

### 2.2 New StandardTelemetry Interface

```typescript
// src/types/StandardTelemetry.ts

/**
 * Canonical telemetry envelope — v5.2
 *
 * All domain fields are dynamically keyed per the active Data Dictionary.
 * No hardcoded business field names exist in this type.
 *
 * Routing metadata (deviceId, tenantId, timestamp, traceId, schemaVersion)
 * is always present and structurally fixed.
 *
 * Business data (metering, status, config) is schema-driven:
 * the keys that appear in each record are determined entirely by
 * the AppConfig parser rules active at the time of translation.
 */
export interface StandardTelemetry {
  /** Normalized gateway clientId (e.g. "QING-445c3c6416d2") */
  deviceId: string;

  /** Multi-tenant isolation key */
  tenantId: string;

  /** ISO-8601 UTC timestamp of the measurement */
  timestamp: string;

  /** Global VPP trace ID: vpp-{uuid} */
  traceId: string;

  /** Data Dictionary version that produced this record */
  schemaVersion: string;

  /**
   * Time-series numeric values for billing and optimization.
   * Keys are canonical field names defined in the Data Dictionary.
   * All values are numeric.
   * Example: { grid_power_w: 1240.5, pv_yield_kwh: 3.82, load_power_w: 890.0 }
   */
  metering: Record<string, number>;

  /**
   * Discrete device state for monitoring and alerting.
   * Keys are canonical field names defined in the Data Dictionary.
   * Values may be string, number, or boolean.
   * Example: { battery_soc: 72.4, inverter_state: "normal", bat_work_status: "charging" }
   */
  status: Record<string, string | number | boolean>;

  /**
   * Bi-directional operational parameters (cloud-to-gateway).
   * Keys are canonical field names defined in the Data Dictionary.
   * Values may be string, number, or boolean.
   * Example: { charge_stop_soc: 95, work_mode: "tou", discharge_power_w: 3000 }
   */
  config: Record<string, string | number | boolean>;
}
```

The structural envelope (`deviceId`, `tenantId`, `timestamp`, `traceId`, `schemaVersion`) is permanent and typed. The business payload (`metering`, `status`, `config`) is open-ended. Field names within each domain are governed by the Data Dictionary, not by TypeScript source code.

---

### 2.3 AppConfig Parser Rule Format

Parser rules are stored in the AppConfig profile `vpp-m1-parser-rules`. Each device profile defines how to extract values from raw MQTT JSON and classify them into the Business Trilogy:

```json
{
  "schemaVersion": "2026-02-25T10:00:00Z",
  "deviceProfiles": {
    "goodwe_arm745": {
      "metering": [
        { "target": "grid_power_w",   "source": "gridList[0].grid_power",   "type": "float", "unit": "W"   },
        { "target": "pv_yield_kwh",   "source": "pvList[0].daily_yield",    "type": "float", "unit": "kWh" },
        { "target": "load_power_w",   "source": "loadList[0].load_power",   "type": "float", "unit": "W"   }
      ],
      "status": [
        { "target": "battery_soc",    "source": "batList[0].bat_soc",       "type": "float"  },
        { "target": "inverter_state", "source": "pvList[0].work_mode",      "type": "string" },
        { "target": "bat_work_status","source": "batList[0].bat_workStatus", "type": "string" }
      ],
      "config": [
        { "target": "charge_stop_soc",   "source": "icebat.chargingStopSoc",  "type": "integer" },
        { "target": "work_mode",         "source": "icebat.workMode",          "type": "string"  },
        { "target": "discharge_power_w", "source": "icebat.dischargingPower",  "type": "integer" }
      ]
    },
    "sofar_hyd": {
      "metering": [
        { "target": "grid_power_w",  "source": "grid.activePower",     "type": "float", "unit": "W"   },
        { "target": "pv_yield_kwh",  "source": "pv.dailyGeneration",   "type": "float", "unit": "kWh" }
      ],
      "status": [
        { "target": "battery_soc",   "source": "batt_soc_value",       "type": "float" }
      ],
      "config": []
    }
  }
}
```

Each mapping rule specifies:

| Field | Purpose |
|-------|---------|
| `target` | Canonical business field name (e.g. `battery_soc`) |
| `source` | JSON path into the raw gateway payload (e.g. `batList[0].bat_soc`) |
| `type` | Value coercion: `float`, `integer`, `string`, `boolean` |
| `unit` | (Optional) Unit annotation for metering fields |

The parser rules document is the complete specification of how a device model's raw MQTT JSON maps to the Business Trilogy. Adding a new field to the platform means adding one line to this JSON.

---

### 2.4 M1 Translation Executor

The translation function is the core of M1's flexible schema. It contains zero field-specific logic. It does not know what `battery_soc` means. It does not know that GoodWe nests battery data under `batList`. All knowledge of field semantics and source paths lives in the AppConfig parser rules.

```typescript
// src/m1/translator.ts

import { AppConfigCache } from './appconfig-cache';
import { resolveJsonPath } from './json-path-resolver';
import { coerce } from './type-coercion';
import { extractClientId } from './client-id-extractor';
import { UnknownDeviceProfileError } from './errors';
import type { StandardTelemetry } from '../types/StandardTelemetry';

/**
 * Translates a raw gateway MQTT payload into a StandardTelemetry record.
 *
 * INVARIANT: This function is a permanent, stable executor.
 * It will never be modified to add, remove, or rename a business field.
 * All field knowledge is delegated to the AppConfig parser rules.
 */
export function translateGatewayPayload(
  rawPayload: Record<string, unknown>,
  deviceProfile: string,
  tenantId: string,
  traceId: string
): StandardTelemetry {
  const rules = AppConfigCache.getParserRules();
  const profile = rules.deviceProfiles[deviceProfile];
  if (!profile) throw new UnknownDeviceProfileError(deviceProfile);

  const metering: Record<string, number> = {};
  const status:   Record<string, string | number | boolean> = {};
  const config:   Record<string, string | number | boolean> = {};

  for (const rule of profile.metering) {
    const raw = resolveJsonPath(rawPayload, rule.source);
    if (raw !== undefined) metering[rule.target] = coerce(raw, rule.type) as number;
  }
  for (const rule of profile.status) {
    const raw = resolveJsonPath(rawPayload, rule.source);
    if (raw !== undefined) status[rule.target] = coerce(raw, rule.type) as string | number | boolean;
  }
  for (const rule of profile.config) {
    const raw = resolveJsonPath(rawPayload, rule.source);
    if (raw !== undefined) config[rule.target] = coerce(raw, rule.type) as string | number | boolean;
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

**Invariant:** `translateGatewayPayload` is a permanent, stable executor. It will never be modified to add a new field. The function's behavior is entirely data-driven: change the parser rules, change the output. The executor itself is immutable.

---

### 2.5 Three-Tier Fallback

Consistent with the v5.1 AppConfig + Lambda Extension sidecar pattern, M1 uses a three-tier fallback for parser rule resolution:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Parser Rule Resolution                           │
│                                                                     │
│  Tier 1: Lambda Extension sidecar live read                        │
│          http://localhost:2772/applications/solfacil-vpp/...        │
│          Latency: < 1ms                                            │
│          Source: AppConfig latest deployed version                  │
│                     │                                               │
│                     │ (Extension unavailable or cold start)         │
│                     ▼                                               │
│  Tier 2: In-memory cached rules from last successful fetch         │
│          Latency: < 0.1ms                                          │
│          Source: Previous Tier 1 result held in Lambda memory       │
│                     │                                               │
│                     │ (First-ever cold start, no cache)             │
│                     ▼                                               │
│  Tier 3: Bundled baseline schema                                   │
│          Covers standard GoodWe + Sofar field mappings             │
│          Emits: schemaVersion = "fallback-baseline"                │
│          Side-effect: Publishes SNS alert to ops channel           │
│          Guarantees: M1 never fails due to missing config          │
└─────────────────────────────────────────────────────────────────────┘
```

When Tier 3 activates, the `schemaVersion` field in every emitted `StandardTelemetry` record reads `"fallback-baseline"`. Downstream modules can detect this and flag records accordingly. The SNS alert ensures the operations team investigates promptly.

---

## 3. M8 Admin Engine — Data Dictionary Service

### 3.1 Dual Responsibility

In v5.2, M8 manages two artifacts in AppConfig. Both artifacts share a `schemaVersion` timestamp that advances atomically on every deployment:

| Artifact | AppConfig Profile | Consumer | Purpose |
|----------|-------------------|----------|---------|
| Parser Rules | `vpp-m1-parser-rules` | M1 | How to extract values from raw MQTT JSON |
| Data Dictionary | `vpp-m8-data-dictionary` | M2, M3, M4, M5, UI | What fields exist, their types and semantics |

The Parser Rules tell M1 *how to translate*. The Data Dictionary tells every other module *what vocabulary exists*. Both must evolve in lockstep.

---

### 3.2 TypeScript Types

```typescript
// src/m8/types/DataDictionarySchema.ts

/**
 * Describes a single field in the global data vocabulary.
 *
 * Every field that can appear in a StandardTelemetry record
 * has a corresponding FieldDefinition in the Data Dictionary.
 */
export interface FieldDefinition {
  /** Dot-notation key: "status.chiller_temp", "metering.grid_power_w" */
  fieldKey: string;

  /** Human-readable label: "Chiller Temperature", "Grid Power" */
  label: string;

  /** Business Trilogy domain classification */
  domain: 'metering' | 'status' | 'config';

  /** Expected value type in StandardTelemetry */
  valueType: 'float' | 'integer' | 'string' | 'boolean';

  /** SI unit annotation (optional): "°C", "W", "kWh", "%" */
  unit?: string;

  /** Prose description for UI tooltips and documentation */
  description: string;

  /** ISO-8601 timestamp of the last modification */
  updatedAt: string;

  /** Identity of the operator who last modified this field */
  updatedBy: string;
}

/**
 * The complete data vocabulary for a tenant.
 *
 * Every module that needs to know "what fields exist" reads this document.
 * M2 uses it to populate strategy rule builder dropdowns.
 * M3 uses it to validate DR health-gate pre-conditions.
 * M4 uses it to define billing rule conditions.
 * M5 uses it to render dashboard data cards.
 */
export interface GlobalDataDictionary {
  /** Version timestamp — must match the corresponding Parser Rules version */
  schemaVersion: string;

  /** Tenant scope */
  tenantId: string;

  /** All known fields across all device profiles */
  fields: FieldDefinition[];
}
```

---

### 3.3 Atomic Dual-Write

When an operator adds a new field mapping through the M8 Admin UI, two AppConfig artifacts must be updated atomically. The `deployFieldMapping` method ensures both artifacts share the same `schemaVersion`:

```typescript
// src/m8/services/DataDictionaryService.ts

import type { FieldDefinition, GlobalDataDictionary } from '../types/DataDictionarySchema';
import type { FieldMappingRequest, DeployResult } from '../types/requests';
import { appendMappingRule } from '../helpers/rule-builder';
import { appendFieldDefinition } from '../helpers/dictionary-builder';
import { generateTraceId } from '../../shared/trace';

export class DataDictionaryService {
  constructor(
    private readonly appConfig: AppConfigClient,
    private readonly eventBridge: EventBridgeClient,
  ) {}

  /**
   * Deploys a new field mapping to both Parser Rules and Data Dictionary.
   *
   * This method performs an atomic dual-write: both AppConfig profiles
   * are updated with the same schemaVersion timestamp. Downstream modules
   * receive a single SchemaEvolved event and invalidate their caches.
   */
  async deployFieldMapping(
    tenantId: string,
    deviceProfile: string,
    newMapping: FieldMappingRequest,
    operator: string
  ): Promise<DeployResult> {
    const newSchemaVersion = new Date().toISOString();

    // Fetch both current artifacts
    const [currentRules, currentDictionary] = await Promise.all([
      this.appConfig.getParserRules(tenantId, deviceProfile),
      this.appConfig.getDataDictionary(tenantId),
    ]);

    // Build updated artifacts
    const updatedRules = appendMappingRule(currentRules, deviceProfile, newMapping);
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

    // Atomic dual-write — both share the same schemaVersion
    await Promise.all([
      this.appConfig.putParserRules(tenantId, deviceProfile,
        { ...updatedRules, schemaVersion: newSchemaVersion }),
      this.appConfig.putDataDictionary(tenantId,
        { ...updatedDictionary, schemaVersion: newSchemaVersion }),
    ]);

    // Publish SchemaEvolved event for downstream cache invalidation
    await this.eventBridge.publish({
      source: 'vpp.m8',
      detailType: 'SchemaEvolved',
      detail: {
        traceId: generateTraceId(),
        tenantId,
        deviceProfile,
        newField: newFieldDef.fieldKey,
        schemaVersion: newSchemaVersion,
      },
    });

    return { success: true, schemaVersion: newSchemaVersion };
  }
}
```

The `SchemaEvolved` event is a new addition to the Event Catalog. It signals that the data vocabulary has changed. Downstream modules use this event to invalidate their Lambda Extension caches and pick up the new schema on their next invocation.

---

### 3.4 EventBridge Cascade

When M8 deploys a new field mapping, the following invalidation cascade propagates through the system:

```
┌──────────────┐
│  M8 Admin    │
│  Engine      │
│              │  deployFieldMapping()
└──────┬───────┘
       │
       │  1. Atomic dual-write
       ▼
┌──────────────────────────────────────────────────────────┐
│  AWS AppConfig                                            │
│                                                           │
│  Profile: vpp-m1-parser-rules   ← updated                │
│           schemaVersion: "2026-02-25T14:30:00.000Z"       │
│                                                           │
│  Profile: vpp-m8-data-dictionary ← updated                │
│           schemaVersion: "2026-02-25T14:30:00.000Z"       │
│                (matching version)                         │
└──────────────────────────┬───────────────────────────────┘
                           │
       ┌───────────────────┼──────────────────────┐
       │                   │                      │
       │  2. EventBridge: SchemaEvolved           │
       ▼                   ▼                      ▼
┌────────────┐  ┌──────────────┐  ┌────────────────────┐
│  M1 IoT    │  │  M2 Strategy │  │  M3/M4/M5          │
│  Hub       │  │  Builder     │  │  Lambda Extensions  │
│            │  │              │  │                      │
│  Extension │  │  Extension   │  │  Extension sidecar   │
│  sidecar   │  │  sidecar     │  │  detects version     │
│  detects   │  │  reloads     │  │  change on next      │
│  version   │  │  Data Dict   │  │  invocation (≤ 1s)   │
│  change    │  │  field list  │  │                      │
│  (≤ 1s)    │  │  updates     │  │  New field available │
│            │  │  dropdown    │  │  in rules, billing,  │
│  Next MQTT │  │              │  │  and dashboard       │
│  message   │  └──────────────┘  └────────────────────┘
│  produces  │
│  new field │
└────────────┘
```

The entire cascade completes within seconds. No Lambda redeployment. No CI/CD pipeline. No code change.

---

## 4. Control Plane UI — M1 Parser Editor Redesign

### 4.1 Design Principle

A new hardware field must be mappable by a field service engineer, not a software engineer.

The Parser Editor UI is designed for operators who understand device protocols (they know what `batList[0].bat_soc` means) but do not write TypeScript. The interface makes the translation from physical field names to business vocabulary a visual, point-and-click operation.

---

### 4.2 Three-Panel Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Device Profile: [goodwe_arm745 ▾]                  [Deploy ▶] v2026-02-25 │
├──────────────────────────────┬──────────────────────────────────────────────┤
│                              │  ┌─────────┬──────────┬──────────┐          │
│  MQTT Payload Tree           │  │METERING │ STATUS   │ CONFIG   │          │
│  (live snapshot)             │  └─────────┴──────────┴──────────┘          │
│                              │                                              │
│  ▼ pvList[0]                 │  STATUS tab active:                          │
│    ├─ grid_power: 1240.5     │  ┌──────────────────────────────────────┐   │
│    ├─ daily_yield: 3.82      │  │ battery_soc     ← batList[0].bat_soc│   │
│    └─ work_mode: "normal"    │  │ inverter_state  ← pvList[0].work_..│   │
│  ▼ batList[0]                │  │ bat_work_status ← batList[0].bat_..│   │
│    ├─ bat_soc: 72.4  ───────────│─────────────────────────↑              │   │
│    ├─ bat_workStatus: "chrg" │  │                                      │   │
│    └─ bat_power: -2100       │  │                     [+ Add]          │   │
│  ▼ icebat                    │  └──────────────────────────────────────┘   │
│    ├─ chargingStopSoc: 95    │                                              │
│    ├─ workMode: "tou"        │                                              │
│    └─ dischargingPower: 3000 │                                              │
│  ▼ liquidCooling             │                                              │
│    └─ temperature: 38.2 ─ ─ ─ ─ (drag to STATUS tab to bind)              │
│                              │                                              │
├──────────────────────────────┴──────────────────────────────────────────────┤
│  Live Preview (read-only)                                                   │
│  {                                                                          │
│    "deviceId": "QING-445c3c6416d2",                                        │
│    "tenantId": "ORG_ENERGIA_001",                                           │
│    "schemaVersion": "2026-02-25T14:30:00.000Z",                             │
│    "metering": { "grid_power_w": 1240.5, "pv_yield_kwh": 3.82 },           │
│    "status":   { "battery_soc": 72.4, "inverter_state": "normal" },         │
│    "config":   { "charge_stop_soc": 95, "work_mode": "tou" }               │
│  }                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Left panel:** MQTT Payload Tree — a live snapshot from the selected gateway showing real field names and their current values. This is the physical view: raw vendor protocol data.

**Right panel:** Three tabs (METERING, STATUS, CONFIG) — each lists current field mappings with their source paths. Each tab has an [+ Add] button to create a new binding.

**Top bar:** Device profile selector dropdown and a Deploy button with the current schema version badge.

---

### 4.3 Operator Workflow: Adding `status.chiller_temp`

A new BESS site in Sao Paulo reports `liquidCooling.temperature` — a field that has never been mapped in the platform. A field service engineer needs to make it visible:

**Step 1.** Click `liquidCooling.temperature: 38.2` in the MQTT Payload Tree. The node highlights blue.

**Step 2.** Click [+ Add] in the STATUS tab. A binding dialog opens with the source path pre-filled: `liquidCooling.temperature`.

**Step 3.** Fill the remaining fields:
- Field Key: `chiller_temp`
- Label: "Chiller Temperature"
- Value Type: `float`
- Unit: `°C`
- Description: "Liquid cooling system temperature"

**Step 4.** Click [Bind & Add]. The new field appears in the STATUS panel with a `[pending deploy]` badge. It is staged but not yet live.

**Step 5.** Click [Deploy]. A 4-step progress indicator appears:
1. Parser Rules updated in AppConfig ... done
2. Data Dictionary updated in AppConfig ... done
3. SchemaEvolved event published to EventBridge ... done
4. Downstream caches invalidated ... done

**Step 6.** The field is live. The next MQTT message from the gateway produces `status.chiller_temp: 38.2` in the StandardTelemetry output. The dashboard, strategy builder, and billing rule editor all see the new field.

---

### 4.4 Live Preview

Below the three mapping tabs, a read-only JSON panel shows the `StandardTelemetry` record that M1 *would* produce right now for the current gateway payload given the current (including pending) mappings.

- Committed fields appear in the standard text color.
- Pending fields (staged but not yet deployed) appear highlighted in a distinct color, so the operator can preview the effect before clicking Deploy.
- The `schemaVersion` in the preview updates to `"(pending)"` when uncommitted mappings exist.

This preview eliminates guesswork. The operator sees the exact output before committing the change.

---

## 5. The Magic Workflow — Cross-Module Live Federation

### 5.1 Scenario

A field engineer commissions a new pilot site in Sao Paulo. The BESS system at this site reports `liquidCooling.temperature` — a telemetry field that has never been seen before in the SOLFACIL platform.

Goals:
- Visible in the fleet dashboard immediately
- Available as a condition in the M2 Strategy Rule Builder
- Available as an M3 DR health-gate pre-condition
- Available in M4 Billing Rule Editor

All four goals must be achieved with zero code changes, zero pull requests, and zero deployments.

---

### 5.2 Timeline (T+0s to T+90s)

| Time | Action |
|------|--------|
| **T+0s** | Field engineer opens M1 Parser Editor. The live MQTT Payload Tree shows `liquidCooling.temperature: 38.2` in the left panel. |
| **T+15s** | Three clicks to bind: select the tree node, click [+ Add] in STATUS tab, fill `chiller_temp` / "Chiller Temperature" / `float` / `°C`, click [Bind & Add]. |
| **T+30s** | Click [Deploy]. M8 `DataDictionaryService.deployFieldMapping()` executes the atomic dual-write. |
| **T+31s** | M1 Lambda Extension detects AppConfig version change. The next MQTT message from the gateway produces a `StandardTelemetry` record containing `status.chiller_temp: 38.2`. |
| **T+32s** | M2 Strategy Builder field selector shows `status.chiller_temp` in its dropdown. No code deploy. No schema migration. The Data Dictionary drives the field list. |
| **T+35s** | M4 Billing Rule Editor shows `status.chiller_temp` as an available condition for billing rule expressions. |
| **T+40s** | M3 DR Dispatcher can use `status.chiller_temp` as a health-gate pre-condition (e.g., reject dispatch if chiller temperature exceeds 45°C). |
| **T+90s** | Fleet dashboard auto-renders a "Chiller Temperature" data card for the Sao Paulo site. The card label and unit are read from the Data Dictionary `FieldDefinition`. |

---

### 5.3 Impact Summary

```
Lines of code changed:   0
Pull requests opened:    0
Deployments triggered:   0
Time to live:            90 seconds
```

---

### 5.4 Back to the Three Questions

**1. "Will your system help us make money?"**

Faster hardware onboarding equals faster activation of optimization revenue per site. Every day of delay between device installation and platform integration is a day of unbilled energy savings. v5.2 reduces this delay from 2-5 business days (code change, review, deploy) to 90 seconds (three clicks and a deploy). For a fleet of 50,000 devices with an average daily savings of R$ 12 per device, each day of acceleration across 100 new site activations per month represents significant incremental revenue.

**2. "Can we trust this system?"**

Atomic writes with matching `schemaVersion` prevent schema divergence between Parser Rules and Data Dictionary. Every `FieldDefinition` carries `updatedBy` and `updatedAt` for full audit trail. AppConfig maintains version history natively — rollback is a single API call reverting both profiles to the previous version. The AppConfig JSON Schema Validator (Shift-Left Validation from v5.1) rejects malformed parser rules at deployment time, before they reach any Lambda.

**3. "Can we tell this story to investors?"**

"Adding a new data dimension to our entire platform — from raw device telemetry through optimization, dispatch, billing, and dashboard — takes 90 seconds and zero engineering effort. Our competitors need a sprint cycle."

---

## Appendix A: Migration Path from v5.1

| Phase | Action | Risk | Duration |
|-------|--------|------|----------|
| **Phase 1** | Deploy M8 Data Dictionary service endpoints. Add `DataDictionaryService`, `FieldDefinition` types, and the `vpp-m8-data-dictionary` AppConfig profile. Purely additive — no existing module behavior changes. | Zero risk. Additive deployment. M1-M7 continue operating on v5.1 logic. | 1 sprint |
| **Phase 2** | Deploy updated M1 with flexible `translateGatewayPayload` executor behind an AppConfig feature flag (`m1_flexible_schema_enabled`). When the flag is `false`, M1 uses the existing v5.1 adapter pattern. When `true`, M1 uses the new data-driven executor. Both paths produce valid `StandardTelemetry`. | Low risk. Feature-flagged. Rollback is a flag toggle. | 1 sprint |
| **Phase 3** | Migrate all existing hardcoded M1 field mappings into AppConfig parser rules. Remove v5.1 adapter classes (`HuaweiAdapter`, `SungrowAdapter`, `AdapterRegistry`). Enable the feature flag in production. Verify all 117/117 existing tests pass against the new executor. | Low risk. Existing field mappings are translated 1:1 into JSON rules. Behavior is identical. | 2 sprints |

Total migration: 4 sprints. Zero downtime. Zero risk to existing 117/117 passing tests. Each phase is independently deployable and independently reversible.

---

## Appendix B: Updated AppConfig Profile Table

| # | Profile Name | Owner | Consumer | Description |
|---|-------------|-------|----------|-------------|
| 1 | `vpp-m1-parser-rules` | M8 | M1 | Device-specific field mappings and type coercion rules. Maps raw MQTT JSON paths to Business Trilogy canonical keys. |
| 2 | `vpp-m2-strategies` | M8 | M2 | Per-org arbitrage strategy thresholds: `min_soc`, `max_soc`, `emergency_soc`, `profit_margin`, `active_hours`. |
| 3 | `vpp-m3-dispatch-policies` | M8 | M3 | Per-org dispatch operational parameters: `max_retry_count`, `retry_backoff_seconds`, `max_concurrent_dispatches`, `timeout_minutes`. |
| 4 | `vpp-m4-billing-rules` | M8 | M4 | Per-org billing parameters: `tariff_penalty_multiplier`, `tariff_effective_period`, `operating_cost_per_kwh`. |
| 5 | `vpp-m5-feature-flags` | M8 | M5 | Global feature toggles: `flag_name`, `is_enabled`, `target_org_ids`, validity windows. |
| 6 | `vpp-m6-rbac-policies` | M8 | M6 | Role-resource-action permission matrix for dynamic RBAC. |
| 7 | `vpp-m7-api-quotas` | M8 | M7 | Per-partner API rate limits: `calls_per_minute`, `calls_per_day`, `burst_limit`. |
| 8 | `vpp-m7-webhook-policies` | M8 | M7 | Per-org webhook delivery parameters: `max_retry_count`, `backoff_strategy`, `initial_delay_ms`, `max_delay_ms`. |
| 9 | `vpp-m8-data-dictionary` | M8 | M2, M3, M4, M5, UI | **NEW in v5.2.** Global field vocabulary: field keys, labels, domains, value types, units, descriptions. Drives all downstream field selectors and dashboard rendering. |

---

*This document describes targeted enhancements to M1 and M8 only. For the complete system architecture including M2-M7, refer to SOLFACIL_BACKEND_DESIGN_v5.1.md which remains the authoritative reference for all unchanged modules.*
