# M1: IoT Hub Module -- DO Telemetry Ingestion

> **Module Version**: v5.16
> **Parent**: [00_MASTER_ARCHITECTURE_v5.15.md](./00_MASTER_ARCHITECTURE_v5.15.md)
> **Last Updated**: 2026-03-07
> **Description**: Parse DO (Digital Output) relay state from Xuheng dido messages, write to telemetry_history
> **Core Theme**: DO telemetry chain for Peak Shaving load shed attribution

---

## Changes from v5.15

| Component | Before (v5.15) | After (v5.16) |
|-----------|---------------|---------------|
| XuhengRawMessage | No dido field | Add `dido?: { do: ReadonlyArray<{id, value}> }` |
| XuhengAdapter | Parses bat/pv/grid/load (13 fields) | Also parses `do0Active`, `do1Active` (+2 fields) |
| ParsedTelemetry | No DO fields (23 fields) | `do0Active: boolean`, `do1Active: boolean` (+2 = 25 fields) |
| telemetry_history INSERT | 11 columns | +2: `do0_active`, `do1_active` (13 columns) |
| telemetry-5min-aggregator | Unchanged | Unchanged (DO state not aggregated to 5-min) |
| telemetry-aggregator | Unchanged | Unchanged |

---

## 1. XuhengRawMessage Type Change

### File: `shared/types/telemetry.ts`

Add `dido` field to the existing `XuhengRawMessage` interface:

```typescript
interface XuhengRawMessage {
  // ... existing fields (v5.14: 13 fields) ...

  // v5.16: Digital Output relay state
  readonly dido?: {
    readonly do: ReadonlyArray<{
      readonly id: string;     // "DO0" | "DO1"
      readonly type: string;   // "DO"
      readonly value: string;  // "0" | "1"
      readonly gpionum?: string; // "/dev/DO1" | "/dev/DO2"
    }>;
  };
}
```

### Notes

- `dido` is optional (`?`) because not every MQTT message contains DO state
- The `do` array contains 0-2 entries (DO0 and/or DO1)
- `value` is a string `"0"` or `"1"`, not a number or boolean
- `gpionum` is informational only (device-specific GPIO mapping)
- DI (Digital Input) entries in the `dido` object are ignored

---

## 2. XuhengAdapter Parse Logic

### File: `iot-hub/services/xuheng-adapter.ts`

Add DO parsing after existing field extraction:

```typescript
// v5.16: Parse DO relay state from dido messages
const doList = raw.data.dido?.do ?? [];
const do0 = doList.find(d => d.id === 'DO0');
const do1 = doList.find(d => d.id === 'DO1');

return {
  ...existing,  // all v5.14 fields unchanged
  do0Active: do0?.value === '1',
  do1Active: do1?.value === '1',
};
```

### Parse Rules

| Input | `do0Active` | `do1Active` | Notes |
|-------|------------|------------|-------|
| `dido.do` has DO0 value="1", DO1 value="0" | `true` | `false` | Normal: DO0 shedding, DO1 idle |
| `dido.do` has DO0 value="0", DO1 value="0" | `false` | `false` | Normal: no load shedding |
| `dido.do` is empty array | `false` | `false` | Edge case: dido present but no DO entries |
| `dido` field missing entirely | `false` | `false` | Non-dido message (battery/PV/grid data only) |

### Lookup Strategy

Use `Array.find(d => d.id === 'DO0')` rather than index-based `do[0]` because:
- The array order is not guaranteed by the device firmware
- The `id` field is the reliable identifier
- Missing entries are handled gracefully (undefined -> `false`)

---

## 3. ParsedTelemetry Interface Change

### File: `shared/types/telemetry.ts`

Add to the existing `ParsedTelemetry` interface:

```typescript
interface ParsedTelemetry {
  // ... existing 23 fields (v5.14) ...

  // v5.16: DO relay state
  readonly do0Active: boolean;  // DO0 relay: true = closed (load shed), false = open
  readonly do1Active: boolean;  // DO1 relay: true = closed (load shed), false = open
}
```

---

## 4. mqtt-subscriber INSERT Change

### File: `iot-hub/services/mqtt-subscriber.ts`

Add `do0_active` and `do1_active` to the `telemetry_history` INSERT statement:

```sql
-- v5.15 (11 columns):
INSERT INTO telemetry_history
  (asset_id, recorded_at, battery_soc, battery_power, pv_power,
   load_power, grid_power_kw, battery_voltage, battery_temperature,
   battery_soh, battery_current)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)

-- v5.16 (13 columns):
INSERT INTO telemetry_history
  (asset_id, recorded_at, battery_soc, battery_power, pv_power,
   load_power, grid_power_kw, battery_voltage, battery_temperature,
   battery_soh, battery_current,
   do0_active, do1_active)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
```

### MessageBuffer Impact

The `MessageBuffer` (2s debounce) passes `ParsedTelemetry` objects to the writer. Since `ParsedTelemetry` now includes `do0Active` and `do1Active`, these flow through the buffer automatically. No changes to `message-buffer.ts` needed.

---

## 5. DO Data Frequency

### Key Behavior

DO state is **NOT** present in every MQTT message. The Xuheng gateway sends:
- **Battery/PV/Grid/Load data**: every ~5 seconds (always present)
- **dido data**: only in dedicated dido messages (~every 30 seconds, or on state change)

### Consequences for Downstream

| Scenario | `do0_active` in telemetry_history | Handling by M4 |
|----------|----------------------------------|----------------|
| dido message received | `true` or `false` | Direct read |
| Non-dido message (bat/pv/grid data) | `NULL` | `COALESCE(do0_active, false)` |
| Device offline (no messages) | No row inserted | Missing data fallback (confidence = 'low') |

### M4 COALESCE Rule

```sql
-- M4 PS savings calculation MUST use COALESCE for DO columns:
COALESCE(th.do0_active, false) AS do0_active,
COALESCE(th.do1_active, false) AS do1_active
```

This treats NULL (non-dido message) as "relay open" (no load shed), which is the conservative/correct default -- if the device didn't report a state change, the relay is presumed to be in its idle state.

---

## 6. What Stays Unchanged

| Component | v5.15 Status | v5.16 Status |
|-----------|-------------|-------------|
| mqtt-subscriber.ts (message classification) | v5.13 | Unchanged |
| XuhengAdapter.ts (13 existing fields) | v5.14 | Unchanged (2 fields added) |
| message-buffer.ts (2s debounce) | v5.14 | Unchanged (passes new fields) |
| device-asset-cache.ts | v5.13 | Unchanged |
| telemetry-5min-aggregator.ts | v5.15 | Unchanged |
| telemetry-aggregator.ts (hourly) | v5.15 | Unchanged |
| state-updater.ts | v5.14 | Unchanged |
| ems-health-updater.ts | v5.13 | Unchanged |

---

## 7. Code Change List

| File | Action | Description |
|------|--------|-------------|
| `shared/types/telemetry.ts` | **MODIFY** | Add `dido` to `XuhengRawMessage`; add `do0Active`, `do1Active` to `ParsedTelemetry` |
| `iot-hub/services/xuheng-adapter.ts` | **MODIFY** | Parse `data.dido.do[]` for DO0/DO1 relay state |
| `iot-hub/services/mqtt-subscriber.ts` | **MODIFY** | Add `do0_active`, `do1_active` to telemetry_history INSERT (11 -> 13 columns) |

---

## 8. Test Strategy

| Test Suite | Scope | v5.16 Changes |
|-----------|-------|---------------|
| `xuheng-adapter.test.ts` | **MODIFY** | Test DO parsing: dido present, dido missing, empty array, DO0 only, DO1 only, both active |
| `mqtt-subscriber.test.ts` | **MODIFY** | Test INSERT with do0_active/do1_active columns; verify NULL when dido absent |
| `telemetry-5min-aggregator.test.ts` | Unchanged | DO state not aggregated to 5-min (no changes) |
| `telemetry-aggregator.test.ts` | Unchanged | DO state not rolled up hourly (no changes) |

### Key Test Scenarios

```typescript
// Test: DO0 active, DO1 inactive
// Input: { dido: { do: [{ id: "DO0", value: "1" }, { id: "DO1", value: "0" }] } }
// Expected: do0Active = true, do1Active = false

// Test: No dido field in message
// Input: { data: { bat: {...}, pv: {...} } }  // no dido
// Expected: do0Active = false, do1Active = false

// Test: DO lookup by id, not index
// Input: { dido: { do: [{ id: "DO1", value: "1" }, { id: "DO0", value: "0" }] } }
// Expected: do0Active = false (DO0 value="0"), do1Active = true (DO1 value="1")

// Test: telemetry_history INSERT with DO columns
// Given: ParsedTelemetry with do0Active=true, do1Active=false
// Expected: INSERT includes $12=true, $13=false
```

---

## Document History

| Version | Date | Summary |
|---------|------|---------|
| v5.2 | 2026-02-27 | Initial: IoT Hub Lambda + IoT Core |
| v5.3 | 2026-02-27 | HEMS single-home |
| v5.8 | 2026-03-02 | Data Contract -- telemetry_history -> asset_hourly_metrics |
| v5.11 | 2026-03-05 | Dual Pool -- Service Pool for subscriber + aggregator |
| v5.13 | 2026-03-05 | Block 1: mqtt-subscriber + XuhengAdapter + aggregator +6 cols + ems_health |
| v5.14 | 2026-03-06 | Block 1: XuhengAdapter +9 bat.properties; aggregator +3 AVG rollup cols |
| v5.15 | 2026-03-07 | New telemetry-5min-aggregator.ts; hourly source changed; factor fix |
| **v5.16** | **2026-03-07** | **DO telemetry: XuhengRawMessage +dido field; XuhengAdapter parses DO0/DO1 relay state; ParsedTelemetry +do0Active +do1Active; mqtt-subscriber INSERT 11->13 columns; M4 COALESCE(do, false) rule documented** |
